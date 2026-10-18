"""The student app's API: everything under `/api/my/`.

THE RULE THAT SHAPES THIS FILE
    These routes are addressed by *account*, never by id. There is no
    `/api/my/…/{student_id}/` anywhere, because an id in the path is an
    invitation to try someone else's. The student is whoever the session
    says, read from `request.user.student`, and every queryset below is
    filtered by that one object — no parameter, header or body field can
    widen it.

    The console routes (`/api/students/{id}/…`) are the opposite shape,
    addressed by id and scoped only to the institute, and are closed to
    students in `permissions.IsConsoleUser`. Row-level security cannot do
    that job: a student and their classmates share an institute, so RLS is
    satisfied on both sides of the fence. See the module docstring there.

WHAT A STUDENT IS SHOWN, AND WHAT IS HELD BACK
    Their own plan, study log, chapter mastery, mock scores, mistake
    analysis, revisions, answers and profile. **Not** `risk_score`, the flags
    a mentor has raised, interventions, or the misconception behind a wrong
    option. Those are written for the mentor, who decides what to say and how;
    handing a student a "critical" band or "you hold misconception X" with no
    conversation around it is a product decision, not a default. Showing less
    first is the choice that can be reversed — adding a field later is
    additive, taking one back is not.

HOW LISTS AND SINGLETONS DEGRADE FOR A NON-STUDENT
    A *list* route returns an empty page to a caller with no linked
    `Student` (a mentor who has opened the student app by mistake): that was
    `my/plan`'s documented behaviour from the start, and the console's
    Student 360 panel depends on it. A *write* or a *singleton* has no
    sensible empty answer, so it is a 403 from `IsStudentAccount`.

WHAT A STUDENT MAY WRITE
    Study sessions and confidence ratings (append-only), ticking plan blocks
    on and off, and marking a revision done (once). Everything else is read.
"""

from __future__ import annotations

import datetime as dt
import logging

from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from apps.derived.models import PlanBlock
from apps.derived.services import features, planner
from apps.events.models import Attempt, ConfidenceRating, RevisionEvent, StudyLog
from apps.ingestion.models import QuestionTopicMap
from apps.syllabus.services import chapters_for_student
from apps.tenancy.models import Student

from . import rollups
from . import serializers as ser
from .pagination import StandardPagination, SubResourcePagination
from .permissions import IsStudentAccount
from .views import WEAK_PARAM, TenantScopedMixin

logger = logging.getLogger(__name__)

#: The `{id}` of a block, revision or question. These routes accept digits
#: only (`lookup_value_regex`), which makes drf-spectacular describe the
#: parameter as a patterned *string* — and a generated client would then ask
#: for `id: string` where every other id in the API is a number.
ID_PARAM = OpenApiParameter("id", OpenApiTypes.INT, OpenApiParameter.PATH)


class OwnDataMixin(TenantScopedMixin):
    """Resolve the one student a request is allowed to be about."""

    def current_student(self) -> Student | None:
        return getattr(self.request.user, "student", None)

    def permissions_for(self, student_only: bool):
        classes = [IsAuthenticated, IsStudentAccount] if student_only else [IsAuthenticated]
        return [cls() for cls in classes]


class ThrottledWritesMixin:
    """Rate-limit creates, and only creates.

    `ScopedRateThrottle` throttles every method of a view that names a scope.
    Reading your own study log forty times is a screen refreshing, not abuse;
    appending to an event table forty times an hour is worth a limit. So the
    scope is attached per action.
    """

    write_scope = "student_write"

    def get_throttles(self):
        self.throttle_scope = self.write_scope if self.action == "create" else None
        return [ScopedRateThrottle()] if self.throttle_scope else []


def refresh_derived_state(student: Student) -> None:
    """Bring this one student's rollups up to date after an event they caused.

    **Best effort, on purpose.** The event just written is the truth;
    `TopicState` and `StudentState` are disposable and rebuilt nightly from
    events. A failure here must not turn a successful, already-committed write
    into an error the student retries — so it is logged and swallowed, and the
    nightly rebuild heals it. (There is no scheduler yet, so until there is,
    `manage.py recompute_features` is that rebuild.)
    """
    try:
        features.recompute(student.institute_id, [student.id])
    except Exception:                                       # pragma: no cover
        logger.exception("could not refresh derived state for student %s", student.id)


@extend_schema(tags=["student-app"])
class MyViewSet(OwnDataMixin, viewsets.GenericViewSet):
    """The signed-in student's own read models.

    The same numbers a mentor sees on Student 360, computed by the same
    functions in `rollups` — only the addressing differs.
    """

    pagination_class = SubResourcePagination

    #: Singletons: no sensible empty answer for a non-student, so a 403.
    STUDENT_ONLY_ACTIONS = frozenset({"profile", "marks_lost"})

    def get_permissions(self):
        return self.permissions_for(self.action in self.STUDENT_ONLY_ACTIONS)

    @extend_schema(responses={200: ser.MyProfileSerializer})
    @action(detail=False)
    def profile(self, request):
        """Who I am: name, batch, mentor, target, and how I am progressing.

        `progress` is the student-safe slice of `StudentState` — no
        `risk_score`. See `MyProgressSerializer` for what is withheld and
        why.
        """
        student = (
            Student.objects.select_related("batch__exam", "mentor", "state")
            .get(pk=self.current_student().pk)
        )
        return Response(ser.MyProfileSerializer(student).data)

    @extend_schema(responses=ser.MyTopicSerializer(many=True))
    @action(detail=False)
    def topics(self, request):
        """The chapters of my syllabus, in teaching order.

        The pick-list for `POST /api/my/study-logs/` and
        `POST /api/my/confidence/`, both of which take a chapter id that
        nothing else in the API could previously produce. Chapters only —
        study time and confidence are recorded at chapter grain.
        """
        student = self.current_student()
        rows = chapters_for_student(student) if student is not None else []
        return self.paginated(rows, ser.MyTopicSerializer)

    @extend_schema(
        parameters=[WEAK_PARAM],
        responses=ser.TopicStateSerializer(many=True),
    )
    @action(detail=False, url_path="topic-states")
    def topic_states(self, request):
        """My per-chapter mastery, weakest first.

        `mastery` is null below the evidence floor — null is "not enough
        attempts to say", never zero.
        """
        student = self.current_student()
        rows = (
            rollups.topic_state_queryset(
                student.institute_id, student.id,
                weak=request.query_params.get("weak") == "true",
            )
            if student is not None else []
        )
        return self.paginated(rows, ser.TopicStateSerializer)

    @extend_schema(responses=ser.MockScoreSerializer(many=True))
    @action(detail=False, url_path="mock-scores")
    def mock_scores(self, request):
        """Per-subject totals for every paper I sat, oldest first.

        The `paper_id` here is what `GET /api/my/marks-lost/?paper=` takes.
        """
        student = self.current_student()
        rows = (
            rollups.mock_score_rows(student.institute_id, student.id)
            if student is not None else []
        )
        return self.paginated(rows, ser.MockScoreSerializer)

    @extend_schema(responses=ser.SubjectBreakdownSerializer(many=True))
    @action(detail=False, url_path="subject-breakdown")
    def subject_breakdown(self, request):
        """Where my study time goes against where my marks go. Three rows, fixed order."""
        student = self.current_student()
        rows = (
            rollups.subject_breakdown_rows(student.institute_id, student.id)
            if student is not None else []
        )
        return self.paginated(rows, ser.SubjectBreakdownSerializer)

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "paper", int, required=True,
                description=(
                    "The `paper_id` of a paper I sat, from "
                    "`GET /api/my/mock-scores/`. Non-numeric or missing is a "
                    "400, not an empty result."
                ),
            ),
            OpenApiParameter(
                "detail", bool, description="Include the per-question cause breakdown."
            ),
        ],
        responses={
            200: ser.MarksLostSerializer,
            400: ser.DetailSerializer,
            404: ser.DetailSerializer,
        },
    )
    @action(detail=False, url_path="marks-lost")
    def marks_lost(self, request):
        """Why I lost marks on one paper, by cause.

        A paper I did not sit is a 404 — including a paper that exists but
        that only other students sat. This route never confirms that.
        """
        student = self.current_student()
        return rollups.marks_lost_response(request, student.institute_id, student.id)


@extend_schema(tags=["student-app"])
class MyAttemptViewSet(OwnDataMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    """Every answer I have given — the way into reviewing my mistakes.

    Each row carries `question_pk`, which `GET /api/my/questions/{id}/` opens
    onto the question, the correct answer and the worked solution. Ordered by
    paper then question label.
    """

    serializer_class = ser.MyAttemptSerializer
    pagination_class = SubResourcePagination

    def get_queryset(self):
        student = self.current_student()
        if student is None:
            return Attempt.objects.none()
        params = self.request.query_params

        paper = params.get("paper")
        if paper:
            if not paper.isdigit():
                raise ValidationError({"paper": "Use the numeric id of a paper."})
            paper = int(paper)
        status_filter = params.get("status")
        if status_filter and status_filter not in dict(Attempt.STATUS):
            raise ValidationError(
                {"status": f"One of: {', '.join(dict(Attempt.STATUS))}."}
            )
        return rollups.attempt_queryset(
            student.institute_id, student.id, paper=paper or None, status=status_filter or None
        )

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "paper", int,
                description="Only answers on this paper (`paper_id` from `mock-scores`).",
            ),
            OpenApiParameter(
                "status", str, enum=[value for value, _ in Attempt.STATUS],
                description=(
                    "Only answers with this outcome — `wrong` is the usual "
                    "review list. `blank` (chose to skip) and `not_reached` "
                    "(ran out of time) are different things."
                ),
            ),
        ],
        responses=ser.MyAttemptSerializer(many=True),
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)


@extend_schema(tags=["student-app"], parameters=[])
class MyQuestionViewSet(OwnDataMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """A question I answered: the stem, what I chose, the right answer, the working.

    **Only questions I have an answer recorded for.** Showing the stem,
    key and solution of a paper I have not sat would hand out the answers to
    a test still to come, so anything else is a 404 — the same 404 as a
    question that does not exist, so the route cannot be used to ask what
    papers an institute holds. Retrieve only, like the console's.
    """

    serializer_class = ser.MyQuestionSerializer
    lookup_value_regex = r"\d+"

    def get_permissions(self):
        return self.permissions_for(True)

    def get_queryset(self):
        student = self.current_student()
        institute_id = student.institute_id if student is not None else None
        return (
            QuestionTopicMap.objects.filter(institute_id=institute_id)
            .select_related("test_paper", "topic__parent__parent")
            .prefetch_related("options")
        )

    @extend_schema(
        parameters=[ID_PARAM],
        responses={
            200: ser.MyQuestionSerializer,
            404: OpenApiResponse(
                response=ser.DetailSerializer,
                description="No such question, or one I have not answered.",
            ),
        }
    )
    def retrieve(self, request, *args, **kwargs):
        student = self.current_student()
        # Looked up by hand rather than `get_object()`: its 404 names the
        # model ("No QuestionTopicMap matches the given query"), which is
        # both an internal detail and a *different* body from the one below.
        # Two bodies would let a caller tell "does not exist" from "exists,
        # not yours" — exactly the oracle this route must not be.
        question = self.get_queryset().filter(pk=kwargs["pk"]).first()
        attempt = (
            rollups.attach_answer(question, student, student.institute_id)
            if question is not None else None
        )
        if attempt is None:
            return Response({"detail": "No such question."}, status=status.HTTP_404_NOT_FOUND)
        return Response(ser.MyQuestionSerializer(question).data)


@extend_schema(tags=["student-app"])
class MyPlanViewSet(OwnDataMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    """Today's plan for the logged-in student.

    Scoped by the account, not by a path parameter: there is no way to
    ask for another student's plan. A caller with no linked `Student`
    gets an empty list rather than a 403, because a mentor opening the
    student PWA is a navigation mistake, not an attack. (A mentor who wants
    a student's plan asks `GET /api/students/{id}/plan/`.)

    Ordered by `start_time` ascending.
    """

    serializer_class = ser.PlanBlockSerializer
    pagination_class = StandardPagination

    #: Numeric ids only. Without it `/api/my/plan/abc/complete/` routes, the
    #: ORM is handed `"abc"`, and a typo in a URL becomes a 500.
    lookup_value_regex = r"\d+"

    #: Actions that address one block by id rather than listing a day.
    BLOCK_ACTIONS = frozenset({"complete", "uncomplete"})

    def get_permissions(self):
        return self.permissions_for(self.action in self.BLOCK_ACTIONS | {"generate"})

    def get_throttles(self):
        # Generating reads a student's whole state and writes a plan; a few
        # a day is the intended use, so it has a budget of its own.
        self.throttle_scope = "plan_generate" if self.action == "generate" else None
        return [ScopedRateThrottle()] if self.throttle_scope else []

    def get_queryset(self):
        student = self.current_student()
        if student is None:
            return PlanBlock.objects.none()
        if self.action in self.BLOCK_ACTIONS:
            # By id across *all* my blocks, not just today's. This used to
            # reuse the day-scoped queryset, so a student viewing yesterday's
            # plan (`?date=`) and ticking a block got a 404 for a block that
            # is plainly theirs and plainly on screen.
            return PlanBlock.objects.filter(student=student, institute_id=student.institute_id)
        return rollups.plan_block_queryset(
            student.institute_id, student.id, rollups.day_param(self.request)
        )

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "date", OpenApiTypes.DATE,
                description=(
                    "The day to plan for, `YYYY-MM-DD`. Defaults to today in "
                    "the server's local timezone. Anything else is a 400."
                ),
            ),
        ],
        responses=ser.PlanBlockSerializer(many=True),
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def _set_completed(self, pk, value: bool) -> Response:
        block = self.get_queryset().select_related("topic__parent__parent").filter(pk=pk).first()
        if block is None:
            return Response({"detail": "No such plan block."}, status=status.HTTP_404_NOT_FOUND)
        if block.completed != value:
            block.completed = value
            block.save(update_fields=["completed"])
        return Response(ser.PlanBlockSerializer(block).data)

    _COMPLETE_RESPONSES = {
        200: ser.PlanBlockSerializer,
        404: OpenApiResponse(
            response=ser.DetailSerializer,
            description="No such block among this student's own.",
        ),
    }

    @extend_schema(request=None, parameters=[ID_PARAM], responses=_COMPLETE_RESPONSES)
    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """Tick a block off. Idempotent: ticking a done block changes nothing."""
        return self._set_completed(pk, True)

    @extend_schema(request=None, parameters=[ID_PARAM], responses=_COMPLETE_RESPONSES)
    @action(detail=True, methods=["post"])
    def uncomplete(self, request, pk=None):
        """Undo a tick. Idempotent. For the mis-tap, which `complete` alone made permanent."""
        return self._set_completed(pk, False)

    @extend_schema(
        request=ser.PlanGenerateRequestSerializer,
        responses={
            200: ser.PlanGenerationSerializer,
            201: ser.PlanGenerationSerializer,
            400: ser.DetailSerializer,
            429: ser.DetailSerializer,
        },
    )
    @action(detail=False, methods=["post"])
    def generate(self, request):
        """Make my plan for a day — three explicit rules, each block saying which.

        **Rules, not a model.** Overdue revisions first, then my weakest
        *taught* chapters, then one chapter taught but never attempted; sized
        to what I actually log on a typical day. Every block's `reason_text`
        names the rule that chose it, so the plan can be argued with. See
        `apps/derived/services/planner.py` for the rules and for why blocks
        carry no start time.

        Idempotent: if a plan already exists it is returned as it stands
        (200). `replace: true` rebuilds it, keeping anything I have ticked.
        An empty `blocks` with 201/200 is a real answer — nothing qualifies
        yet — not an error.
        """
        form = ser.PlanGenerateRequestSerializer(data=request.data)
        form.is_valid(raise_exception=True)

        today = timezone.localdate()
        day = form.validated_data.get("date", today)
        if day < today:
            raise ValidationError({"date": "A plan is for today or a day to come."})
        if day > today + dt.timedelta(days=planner.MAX_DAYS_AHEAD):
            raise ValidationError(
                {"date": f"Plans go at most {planner.MAX_DAYS_AHEAD} days ahead."}
            )

        blocks, generated = planner.generate_for_student(
            self.current_student(), day, replace=form.validated_data["replace"]
        )
        payload = ser.PlanGenerationSerializer(
            {"date": day, "generated": generated, "blocks": blocks}
        ).data
        return Response(payload, status=status.HTTP_201_CREATED if generated else status.HTTP_200_OK)


@extend_schema(tags=["student-app"])
class StudyLogViewSet(ThrottledWritesMixin, OwnDataMixin, mixins.CreateModelMixin,
                      mixins.ListModelMixin, viewsets.GenericViewSet):
    """The logged-in student's own study log — read and append.

    Ordered by `ts` descending, most recent first. Append-only by
    construction: there is no update or delete route, matching the
    append-only rule the admin enforces on `StudyLog` itself.

    The `topic` must be a chapter of the student's own syllabus
    (`GET /api/my/topics/`), `minutes` is 1–720, and `ts` may be in the past
    but not the future. A mentor posting here is a 403; it used to be a 500.
    """

    serializer_class = ser.StudyLogCreateSerializer
    pagination_class = StandardPagination

    def get_permissions(self):
        return self.permissions_for(self.action == "create")

    def get_queryset(self):
        student = self.current_student()
        if student is None:
            return StudyLog.objects.none()
        # No slice: a sliced queryset counts the slice, so a student with
        # 400 logs would be told they had 100 and page 3 would come back
        # empty. Pagination already bounds the response.
        return rollups.study_log_queryset(student.institute_id, student.id)

    def perform_create(self, serializer):
        student = self.current_student()
        serializer.save(student=student, institute_id=student.institute_id)


@extend_schema(tags=["student-app"])
class ConfidenceRatingViewSet(ThrottledWritesMixin, OwnDataMixin, mixins.CreateModelMixin,
                              mixins.ListModelMixin, viewsets.GenericViewSet):
    """How confident I am in a chapter — the write path that did not exist.

    Overconfidence detection compares this against measured mastery, and
    until now `ConfidenceRating` had no way in except the seeder. Append
    only: rating a chapter again adds a row, and the latest by `ts` wins in
    `TopicState.self_rating`, so the history of how someone's confidence
    moved is kept rather than overwritten. `ts` is stamped by the server.

    Ordered by `ts` descending.
    """

    serializer_class = ser.ConfidenceRatingSerializer
    pagination_class = StandardPagination

    def get_permissions(self):
        return self.permissions_for(self.action == "create")

    def get_queryset(self):
        student = self.current_student()
        if student is None:
            return ConfidenceRating.objects.none()
        return rollups.confidence_queryset(student.institute_id, student.id)

    def perform_create(self, serializer):
        student = self.current_student()
        serializer.save(student=student, institute_id=student.institute_id, ts=timezone.now())


@extend_schema(tags=["student-app"])
class RevisionViewSet(OwnDataMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    """My scheduled revisions, soonest first — overdue ones lead.

    Marking one done (`complete`) is the single permitted change to a row in
    the event log, and it is permitted because of its shape: `done_at` goes
    from null to a timestamp **once** and never moves again. That keeps what
    the append-only rule is for — replaying history reproduces exactly what
    happened, because the row says both *that* it was done and *when*. What
    the rule forbids is overwriting facts; a deadline that was open and then
    closed once is not one.
    """

    serializer_class = ser.MyRevisionSerializer
    pagination_class = SubResourcePagination
    lookup_value_regex = r"\d+"

    def get_permissions(self):
        return self.permissions_for(self.action == "complete")

    def get_queryset(self):
        student = self.current_student()
        if student is None:
            return RevisionEvent.objects.none()
        return rollups.revision_queryset(
            student.institute_id, student.id,
            pending=self.request.query_params.get("pending") == "true",
        )

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "pending", bool,
                description=(
                    "`true` returns only revisions not yet done. A presence "
                    "filter like `?open=` on flags: any other value is "
                    "ignored and returns everything."
                ),
            ),
        ],
        responses=ser.MyRevisionSerializer(many=True),
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @extend_schema(
        request=None,
        parameters=[ID_PARAM],
        responses={
            200: ser.MyRevisionSerializer,
            404: OpenApiResponse(
                response=ser.DetailSerializer,
                description="No such revision among this student's own.",
            ),
        },
    )
    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """I did this revision. Write-once and idempotent.

        The first call records when; any later call returns the revision as it
        stands and does not move the timestamp. The conditional `UPDATE … WHERE
        done_at IS NULL` is what makes that true under two simultaneous
        requests, which a read-then-write would not be.

        Also refreshes my derived state (`revision_debt`, `last_revised`,
        `retention`) so the screen reflects it straight away; see
        `refresh_derived_state` for why that cannot fail the request.
        """
        student = self.current_student()
        revision = self.get_queryset().filter(pk=pk).first()
        if revision is None:
            return Response({"detail": "No such revision."}, status=status.HTTP_404_NOT_FOUND)

        recorded = RevisionEvent.objects.filter(pk=revision.pk, done_at__isnull=True).update(
            done_at=timezone.now()
        )
        if recorded:
            refresh_derived_state(student)
        revision.refresh_from_db()
        return Response(ser.MyRevisionSerializer(revision).data)
