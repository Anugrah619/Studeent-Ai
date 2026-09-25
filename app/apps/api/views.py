"""API viewsets.

Every queryset is tenant-scoped. RLS in Postgres is the backstop (P0 day 5),
but scoping here too means a bug shows up as an empty list rather than a
leak, and the intent is visible where developers actually read.
"""

from django.db.models import Count, Q, Sum
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.derived.models import Flag, Intervention, PlanBlock, TopicState
from apps.derived.services import features
from apps.events.models import Attempt, RevisionEvent, StudyLog
from apps.events.services import mock_analysis
from apps.ingestion.models import TestPaper
from apps.tenancy.models import Batch, Mentor, Student

from . import serializers as ser
from .pagination import StandardPagination, SubResourcePagination

SUBJECTS = ["Physics", "Chemistry", "Maths"]

#: `?institute=` is read by `TenantScopedMixin.institute_id()` on **every**
#: tenant-scoped route, so it belongs in the contract on every one of them.
#: It is ignored for mentors and students — their institute comes from the
#: account — and is the only way a superuser, who bypasses both the mixin's
#: default and Postgres RLS, can name a tenant to look at.
INSTITUTE_PARAM = OpenApiParameter(
    "institute",
    int,
    description=(
        "Superusers only: the institute to scope this call to. Ignored for "
        "mentor and student accounts, whose institute comes from the "
        "account itself. A superuser who omits it gets an empty result "
        "rather than every tenant's rows."
    ),
)

#: `risk_score` at or above this lands a student in the console's at-risk
#: set — the `?at_risk=true` filter and the "high" band in
#: `StudentListSerializer.risk_score`'s documented scale. One constant so
#: the filter and the published band cannot drift apart.
AT_RISK_THRESHOLD = 0.55

#: What `?ordering=` accepts on `/api/students/`, mapped to the ORM path
#: behind it.
#:
#: A whitelist rather than DRF's `OrderingFilter`, because three of the
#: columns the triage table sorts on live on the *related* `StudentState`
#: row and one is an annotation, so the public name and the ORM path are
#: not the same string. Handing the raw parameter to `.order_by()` would
#: also let a caller order by any traversable relation, which is a
#: slow-query surface rather than a feature.
STUDENT_ORDERING_FIELDS = {
    "risk_score": "state__risk_score",
    "mock_avg": "state__mock_avg",
    "mock_trend": "state__mock_trend",
    "open_flags": "open_flags",
    "name": "name",
    "roll_no": "roll_no",
}

#: Both directions of every sortable field, so the generated client gets
#: a closed enum instead of a free-text box.
STUDENT_ORDERING_ENUM = sorted(
    [*STUDENT_ORDERING_FIELDS, *(f"-{f}" for f in STUDENT_ORDERING_FIELDS)]
)

#: What the KPI strip shows a caller bound to no institute. Every count is
#: zero rather than absent, so the console renders an empty dashboard
#: instead of failing on a missing key.
_EMPTY_SUMMARY = {
    "batch_id": None, "batch_name": None,
    "total_students": 0, "active_students": 0, "flagged_this_week": 0,
    "critical_flags": 0, "batch_mock_avg": None, "latest_paper_id": None,
    "latest_paper_name": None, "latest_paper_held_on": None,
    "latest_paper_max_marks": None, "latest_paper_students": 0,
    "revision_debt_pct": 0.0, "avg_revision_debt": 0.0,
    "flags_resolved": 0, "recovery_rate_pct": None,
}


def subject_name(topic) -> str:
    node = topic
    while node.parent_id is not None:
        node = node.parent
    return node.name


class TenantScopedMixin:
    """Restrict every queryset to the caller's institute.

    Kept deliberately, alongside Postgres row-level security, and the DB
    agent's handoff argues the case at length. The short version is that
    RLS does not cover two cases this does:

    * **Superusers bypass RLS entirely**, by design — the admin is
      cross-tenant back-office. Without this mixin a superuser's API call
      would quietly return every institute's students.
    * **RLS binding happens in middleware, off `request.user`.** Add JWT
      or token auth and DRF authenticates *inside* the view, by which
      point the middleware has already seen `AnonymousUser` and left the
      connection unscoped. This still works.

    The two are not independent sources of truth: both derive the
    institute from the same user, and `manage.py rls_check` asserts the
    database half.
    """

    def institute_id(self) -> int | None:
        """Always an int or None — never the raw query-param string.

        The previous version returned `mentor.institute_id` (an int) for
        mentors and `query_params.get("institute")` (a str) for
        superusers. `.filter(institute_id=...)` coerces either, so it
        worked, which is exactly why it was worth fixing: the next
        comparison written against this value would have been `==` and
        would have failed silently for one class of caller.
        """
        user = self.request.user
        mentor = getattr(user, "mentor", None)
        if mentor is not None:
            return mentor.institute_id
        student = getattr(user, "student", None)
        if student is not None:
            return student.institute_id
        # Superusers and staff may pass ?institute=<id> for admin tooling.
        raw = self.request.query_params.get("institute")
        try:
            return int(raw) if raw is not None else None
        except (TypeError, ValueError):
            return None

    def scoped(self, qs):
        inst = self.institute_id()
        return qs.filter(institute_id=inst) if inst else qs.none()

    def paginated(self, rows, serializer_cls):
        """Return `{count, next, previous, results}` for an `@action`.

        `list()` gets this from `ListModelMixin`; `@action` methods do
        not, and four of them used to hand back a bare array while
        `openapi.yaml` promised the envelope. This closes that gap for
        querysets and for plain Python lists alike — DRF's paginator
        slices either.
        """
        page = self.paginate_queryset(rows)
        if page is None:                                   # pragma: no cover
            return Response(serializer_cls(rows, many=True).data)
        return self.get_paginated_response(serializer_cls(page, many=True).data)


@extend_schema(tags=["batches"], parameters=[INSTITUTE_PARAM])
class BatchViewSet(TenantScopedMixin, viewsets.ReadOnlyModelViewSet):
    """The institute's batches, each with its live student count.

    Ordered by name (`Batch.Meta.ordering`). This is the source for the
    console's batch filter, which feeds `?batch=` on `/api/students/` and
    on `/api/dashboard/summary/`.
    """

    serializer_class = ser.BatchSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        # Explicit `order_by`, not `Batch.Meta.ordering`: Django drops a
        # model's default ordering from aggregate queries, so the
        # `annotate()` above left this queryset unordered and DRF paged it
        # with `UnorderedObjectListWarning`. Unordered paging is not a
        # warning-level problem — it is page 2 disagreeing with page 1.
        return self.scoped(
            Batch.objects.select_related("exam")
            .annotate(student_count=Count("students"))
            .order_by("name", "id")
        )


@extend_schema(tags=["mentors"], parameters=[INSTITUTE_PARAM])
class MentorViewSet(TenantScopedMixin, viewsets.ReadOnlyModelViewSet):
    """The institute's mentors — who a flag can be routed to.

    Added because `POST /api/flags/{id}/intervene/` takes a mentor id and
    nothing in the contract could produce one
    (`web/src/api/gaps.ts: NO_MENTOR_LIST`). The intervention dialog was
    left with a required field it had no way to populate.

    Read-only and deliberately thin: name, email, and how many students
    each one carries, which is what a director picking a mentor wants to
    see. Creating and reassigning mentors stays in the Django admin,
    where it is an occasional back-office act rather than a console flow.

    Tenant-scoped like everything else. Note that `Mentor` is one of the
    17 tables carrying `institute_id` directly, so Postgres RLS covers it
    too — this list cannot cross a tenant boundary even if the mixin were
    removed.
    """

    serializer_class = ser.MentorSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        return self.scoped(
            Mentor.objects.annotate(
                student_count=Count("students", filter=Q(students__exited_at__isnull=True))
            )
        ).order_by("name")


@extend_schema(tags=["students"], parameters=[INSTITUTE_PARAM])
class StudentViewSet(TenantScopedMixin, viewsets.ReadOnlyModelViewSet):
    """Students and their derived state — the director's triage surface.

    The list route is the triage table; the `@action` routes below are
    Student 360's panels. Every one of them is scoped to the caller's
    institute and every one of them is paginated (see
    `apps/api/pagination.py` for why that is uniform rather than
    convenient).
    """

    permission_classes = [IsAuthenticated]

    #: Sub-resources page at 200, collections at 50. `pagination_class` is
    #: a property rather than a constant because the two have genuinely
    #: different shapes: a student's chapters are bounded by the syllabus,
    #: an institute's students are not. drf-spectacular instantiates the
    #: view before reading this, so the schema picks up the right one per
    #: operation.
    SUB_RESOURCE_ACTIONS = frozenset(
        {"topic_states", "mock_scores", "subject_breakdown", "attempts"}
    )

    @property
    def pagination_class(self):
        action = getattr(self, "action", None)
        return (
            SubResourcePagination
            if action in self.SUB_RESOURCE_ACTIONS
            else StandardPagination
        )

    ORDERING_FIELDS = STUDENT_ORDERING_FIELDS

    #: The triage default: worst risk first, ties broken by name.
    DEFAULT_ORDERING = ("-state__risk_score", "name")

    def get_serializer_class(self):
        return ser.StudentDetailSerializer if self.action == "retrieve" else ser.StudentListSerializer

    def get_queryset(self):
        qs = self.scoped(
            Student.objects.select_related("batch", "mentor", "state")
        ).annotate(open_flags=Count("flags", filter=Q(flags__resolved_at__isnull=True)))

        batch = self.request.query_params.get("batch")
        if batch:
            qs = qs.filter(batch_id=batch)
        if self.request.query_params.get("at_risk") == "true":
            qs = qs.filter(state__risk_score__gte=AT_RISK_THRESHOLD)
        if self.request.query_params.get("active") == "true":
            qs = qs.filter(exited_at__isnull=True)

        search = (self.request.query_params.get("search") or "").strip()
        if search:
            qs = qs.filter(Q(name__icontains=search) | Q(roll_no__icontains=search))

        return qs.order_by(*self._ordering())

    def _ordering(self) -> tuple[str, ...]:
        """Translate `?ordering=` into ORM terms, falling back silently.

        An unknown or malformed field falls back to the triage default
        rather than 400-ing. Sorting is a view preference, not a
        semantic argument: a stale bookmark pointing at a column that has
        since been renamed should show the table, not an error page.
        """
        raw = (self.request.query_params.get("ordering") or "").strip()
        if not raw:
            return self.DEFAULT_ORDERING
        out: list[str] = []
        for term in raw.split(","):
            term = term.strip()
            desc, key = term.startswith("-"), term.lstrip("-")
            field = self.ORDERING_FIELDS.get(key)
            if field:
                out.append(f"-{field}" if desc else field)
        # `name` last so the order is total: without it, every student
        # whose `risk_score` is null would come back in whatever order
        # Postgres felt like, and the page-2 request would disagree with
        # page 1 about who belongs on it.
        if not out:
            return self.DEFAULT_ORDERING
        return (*out, "name") if "name" not in raw else tuple(out)

    @extend_schema(
        parameters=[
            INSTITUTE_PARAM,
            OpenApiParameter("batch", int, description="Only students in this batch."),
            OpenApiParameter(
                "at_risk", bool,
                description=(
                    f"Only students whose `risk_score` is at or above "
                    f"{AT_RISK_THRESHOLD}, the console's at-risk threshold. "
                    "Students with no score yet are excluded — an unscored "
                    "student is unmeasured, not safe."
                ),
            ),
            OpenApiParameter(
                "active", bool,
                description="Only students who have not left (`exited_at` is null).",
            ),
            OpenApiParameter(
                "search", str,
                description=(
                    "Case-insensitive substring match on `name` or `roll_no`. "
                    "Ignored when blank."
                ),
            ),
            OpenApiParameter(
                "ordering", str, enum=STUDENT_ORDERING_ENUM,
                description=(
                    "Sort column, `-` for descending, comma-separated for "
                    "tie-breakers. Unknown fields are ignored. Default: "
                    "`-risk_score,name`. `name` is always appended as a final "
                    "tie-break so paging is stable."
                ),
            ),
        ],
        responses=ser.StudentListSerializer(many=True),
    )
    def list(self, request, *args, **kwargs):
        """The triage table: one row per student, worst risk first."""
        return super().list(request, *args, **kwargs)

    @extend_schema(
        parameters=[
            INSTITUTE_PARAM,
            OpenApiParameter(
                "weak", bool,
                description=(
                    "Only chapters with a measured `mastery` below 0.5. "
                    "Chapters below the evidence floor carry a null mastery "
                    "and are excluded, because 'not enough attempts to say' "
                    "is not the same claim as 'weak'."
                ),
            ),
        ],
        responses=ser.TopicStateSerializer(many=True),
        tags=["students"],
    )
    @action(detail=True, url_path="topic-states")
    def topic_states(self, request, pk=None):
        """This student's per-chapter mastery, weakest first.

        Ordered by `mastery` ascending; Postgres sorts NULLs last on an
        ascending sort, so chapters with too little evidence to score sit
        at the end rather than masquerading as the weakest ones.
        """
        qs = (
            TopicState.objects.filter(student_id=pk, institute_id=self.institute_id())
            .select_related("topic__parent__parent")
            .order_by("mastery", "id")
        )
        if request.query_params.get("weak") == "true":
            qs = qs.filter(mastery__lt=0.5, mastery__isnull=False)
        return self.paginated(qs, ser.TopicStateSerializer)

    @extend_schema(
        parameters=[INSTITUTE_PARAM],
        responses=ser.MockScoreSerializer(many=True),
        tags=["students"],
    )
    @action(detail=True, url_path="mock-scores")
    def mock_scores(self, request, pk=None):
        """Per-subject totals for every paper this student sat.

        **Ordered by `held_on` ascending** — oldest paper first. The view
        always did this; the contract did not say so
        (`web/src/api/gaps.ts: MOCK_SCORES_ORDER`), which left the trend
        chart re-sorting defensively on arrival. It is a guarantee now:
        the payload is chart-ready in the order given, left to right.
        """
        rows = (
            Attempt.objects.filter(student_id=pk, institute_id=self.institute_id(),
                                   test_paper__isnull=False)
            .select_related("test_paper", "topic__parent__parent")
            .values("test_paper_id", "test_paper__name", "test_paper__held_on",
                    "topic__parent__parent__name")
            .annotate(marks=Sum("marks"))
        )
        papers: dict[int, dict] = {}
        for r in rows:
            p = papers.setdefault(r["test_paper_id"], {
                "paper_id": r["test_paper_id"],
                "paper_name": r["test_paper__name"],
                "held_on": r["test_paper__held_on"],
                "physics": 0.0, "chemistry": 0.0, "maths": 0.0, "total": 0.0,
            })
            subject = (r["topic__parent__parent__name"] or "").lower()
            if subject in ("physics", "chemistry", "maths"):
                p[subject] = round(r["marks"] or 0, 1)
            p["total"] = round(p["physics"] + p["chemistry"] + p["maths"], 1)
        out = sorted(papers.values(), key=lambda x: x["held_on"])
        return self.paginated(out, ser.MockScoreSerializer)

    @extend_schema(
        parameters=[INSTITUTE_PARAM],
        responses=ser.SubjectBreakdownSerializer(many=True),
        tags=["students"],
    )
    @action(detail=True, url_path="subject-breakdown")
    def subject_breakdown(self, request, pk=None):
        """Study-time share vs marks-lost share. The neglect chart.

        Always exactly three rows, in the fixed order Physics, Chemistry,
        Maths — a subject with no data comes back as zeroes rather than
        being omitted, so the chart's three bars never renumber
        themselves between students.

        `marks_lost_share_pct` is now a share of **marks**, computed by
        `features.marks_lost_by_topic`. It previously counted lost
        *questions*, which priced a wrong answer and a skipped one
        identically despite the negative marking, and so understated
        exactly the subject a student was guessing through. Same field,
        same units claimed, finally the units delivered — and the same
        function the `subject_imbalance` detector reads, so the flag and
        this chart can no longer disagree.
        """
        inst = self.institute_id()
        if inst is None:
            return self.paginated([], ser.SubjectBreakdownSerializer)
        student_id = int(pk)

        subjects = features.subject_map(inst)
        lost_by = features.marks_lost_by_subject(
            features.marks_lost_by_topic(inst, [student_id]), subjects
        ).get(student_id, {})
        time_by = features.study_minutes_by_subject(inst, [student_id], subjects).get(
            student_id, {}
        )

        att_by, cor_by = {}, {}
        for r in (
            Attempt.objects.filter(student_id=student_id, institute_id=inst)
            .values("topic_id")
            .annotate(
                attempted=Count("id", filter=Q(status__in=[Attempt.CORRECT, Attempt.WRONG])),
                correct=Count("id", filter=Q(status=Attempt.CORRECT)),
            )
        ):
            name = subjects.get(r["topic_id"])
            if name:
                att_by[name] = att_by.get(name, 0) + r["attempted"]
                cor_by[name] = cor_by.get(name, 0) + r["correct"]

        t_tot = sum(time_by.values()) or 1
        l_tot = sum(lost_by.values()) or 1
        out = [
            {
                "subject": s,
                "time_share_pct": round(time_by.get(s, 0) / t_tot * 100, 1),
                "marks_lost_share_pct": round(lost_by.get(s, 0) / l_tot * 100, 1),
                "accuracy_pct": round(cor_by.get(s, 0) / att_by[s] * 100, 1) if att_by.get(s) else None,
            }
            for s in SUBJECTS
        ]
        return self.paginated(out, ser.SubjectBreakdownSerializer)

    @extend_schema(
        parameters=[
            INSTITUTE_PARAM,
            OpenApiParameter(
                "paper", int, required=True,
                description="The `TestPaper.id` to attribute. Non-numeric or "
                            "missing values are a 400, not an empty result.",
            ),
            OpenApiParameter(
                "detail", bool,
                description="Include the per-question cause breakdown.",
            ),
        ],
        responses={
            200: ser.MarksLostSerializer,
            400: ser.DetailSerializer,
            404: ser.DetailSerializer,
        },
        tags=["students"],
    )
    @action(detail=True, url_path="marks-lost")
    def marks_lost(self, request, pk=None):
        """Partition lost marks by cause for one paper.

        The attribution itself lives in
        `apps.events.services.mock_analysis` — it is an engine, not a
        view, and it is called by the planner and the narration layer too.
        """
        inst = self.institute_id()
        raw = request.query_params.get("paper")
        try:
            paper_id = int(raw)
        except (TypeError, ValueError):
            return Response(
                {"detail": "A numeric ?paper=<id> is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if inst is None:
            return Response({"detail": "No institute in scope."},
                            status=status.HTTP_404_NOT_FOUND)

        data = mock_analysis.analyse_mock(
            institute_id=inst,
            student_id=int(pk),
            paper_id=paper_id,
            include_questions=request.query_params.get("detail") == "true",
        )
        if data is None:
            return Response(
                {"detail": "No attempts recorded for that student on that paper."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(ser.MarksLostSerializer(data).data)

    @extend_schema(
        parameters=[
            INSTITUTE_PARAM,
            OpenApiParameter("paper", int, description="Restrict to one paper."),
            OpenApiParameter("force", bool, description="Bypass the cache and re-reason."),
        ],
        responses={
            200: ser.DiagnosisSerializer,
            422: OpenApiResponse(description="Nothing to diagnose — see detail"),
            503: OpenApiResponse(description="Reasoning layer unavailable"),
        },
        tags=["reasoning"],
    )
    @action(detail=True, url_path="diagnosis")
    def diagnosis(self, request, pk=None):
        """What this student actually misunderstands — the product's core claim.

        Deterministic code counts which distractors were chosen and what each
        cost. The model does the part that is genuinely judgement: whether
        this is a systematic misconception or scattered carelessness, and
        what the *correct* answers reveal about where the error starts.

        Fails loudly rather than degrading to generic advice. A model told
        only "got Q17 wrong, topic Rotational Motion" returns "revise
        Rotational Motion" — worse than an honest error, because it looks
        like an answer.
        """
        from apps.reasoning.services import diagnose as dx
        from apps.reasoning.services.gemini import (
            GeminiUnavailable,
            NoCredentialsAndNoCache,
        )

        student = self.get_object()
        paper = None
        paper_id = request.query_params.get("paper")
        if paper_id:
            paper = TestPaper.objects.filter(
                pk=paper_id, institute_id=self.institute_id()
            ).first()
            if paper is None:
                return Response({"detail": "No such paper."},
                                status=status.HTTP_404_NOT_FOUND)

        try:
            output, trace = dx.diagnose(
                student, paper,
                force=request.query_params.get("force") == "true",
            )
        except ValueError as exc:
            # Not enough tagged evidence. A real state, not a crash.
            return Response({"detail": str(exc)},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        except (GeminiUnavailable, NoCredentialsAndNoCache) as exc:
            return Response({"detail": str(exc)},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)

        return Response(ser.DiagnosisSerializer({
            **output,
            "trace_id": trace.id,
            "from_cache": trace.latency_ms is None,
            "human_verdict": trace.human_verdict,
        }).data)

    @extend_schema(
        request=ser.DiagnosisVerdictSerializer,
        responses={200: ser.DiagnosisSerializer},
        tags=["reasoning"],
    )
    @action(detail=True, methods=["post"], url_path="diagnosis/verdict")
    def diagnosis_verdict(self, request, pk=None):
        """Record whether the mentor agreed — this is how training data is made.

        Model output alone is a guess. The same output with a teacher's
        judgement attached is a labelled example, and a corpus of those is
        what we eventually fine-tune our own model on.
        """
        from apps.reasoning.models import ReasoningTrace

        payload = ser.DiagnosisVerdictSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        mentor = getattr(request.user, "mentor", None)
        if mentor is None:
            return Response({"detail": "Only mentors can review a diagnosis."},
                            status=status.HTTP_403_FORBIDDEN)

        trace = (
            ReasoningTrace.objects
            .filter(student_id=pk, institute_id=self.institute_id(),
                    task=ReasoningTrace.DIAGNOSE, output__isnull=False)
            .order_by("-created_at").first()
        )
        if trace is None:
            return Response({"detail": "No diagnosis to review yet."},
                            status=status.HTTP_404_NOT_FOUND)

        trace.human_verdict = payload.validated_data["verdict"]
        trace.human_note = payload.validated_data.get("note", "")
        trace.reviewed_by = mentor
        trace.save(update_fields=["human_verdict", "human_note", "reviewed_by"])

        return Response(ser.DiagnosisSerializer({
            **trace.output,
            "trace_id": trace.id,
            "from_cache": True,
            "human_verdict": trace.human_verdict,
        }).data)

    @extend_schema(
        parameters=[
            INSTITUTE_PARAM,
            OpenApiParameter(
                "paper", int,
                description=(
                    "Only attempts recorded against this `TestPaper.id`. "
                    "Omit it and you get practice attempts too — which on "
                    "the seeded data is ~490 rows per student, so page "
                    "through the envelope rather than assuming one page."
                ),
            ),
        ],
        responses=ser.AttemptSerializer(many=True),
        tags=["students"],
    )
    @action(detail=True)
    def attempts(self, request, pk=None):
        """Raw attempts for one student, ordered by `question_id`.

        This used to slice at 400 rows and say nothing about it. The seed
        averages ~490 attempts per student, so an unfiltered call was
        already losing about a fifth of them silently — the response had
        no field that could have told anyone. It is paginated now:
        `count` is the true total and `next` is populated when there is
        more.
        """
        qs = Attempt.objects.filter(
            student_id=pk, institute_id=self.institute_id()
        ).select_related("topic")
        paper = request.query_params.get("paper")
        if paper:
            qs = qs.filter(test_paper_id=paper)
        # `id` as tie-break: `question_id` is unique per paper but repeats
        # across papers, so without it the unfiltered ordering is only
        # partial and page 2 can re-show a row from page 1.
        return self.paginated(qs.order_by("question_id", "id"), ser.AttemptSerializer)


@extend_schema(tags=["flags"], parameters=[INSTITUTE_PARAM])
class FlagViewSet(TenantScopedMixin, viewsets.ReadOnlyModelViewSet):
    """Detector output — what the console triages, newest first.

    Every filter below was already implemented and none of them were in
    the contract, so the console reached them through an
    `undocumentedQuery` escape hatch and re-applied each one client-side
    in case the server ignored it
    (`web/src/api/gaps.ts: FLAGS_OPEN_FILTER`). They are declared now.
    `?student=` is genuinely new: Student 360 was fetching every flag in
    the institute and filtering in the browser.

    Ordered by `raised_at` descending. `?open=true` combined with
    `?severity=` is served by the partial index `idx_flag_open`
    `(institute_id, severity, raised_at DESC) WHERE resolved_at IS NULL`,
    with no sort step at all.
    """

    serializer_class = ser.FlagSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        qs = self.scoped(
            Flag.objects.select_related("student__batch", "student__mentor", "topic")
        )
        if self.request.query_params.get("open") == "true":
            qs = qs.filter(resolved_at__isnull=True)
        severity = self.request.query_params.get("severity")
        if severity:
            qs = qs.filter(severity=severity)
        mentor = self.request.query_params.get("mentor")
        if mentor:
            qs = qs.filter(student__mentor_id=mentor)
        student = self.request.query_params.get("student")
        if student:
            qs = qs.filter(student_id=student)
        # `id` as tie-break: `raised_at` is set by the detector run, so a
        # single batch writes dozens of flags on the same timestamp and
        # the sort is otherwise not total.
        return qs.order_by("-raised_at", "-id")

    @extend_schema(
        parameters=[
            INSTITUTE_PARAM,
            OpenApiParameter(
                "open", bool,
                description=(
                    "`true` returns only unresolved flags (`resolved_at` is "
                    "null). Any other value, including `false`, is ignored "
                    "and returns everything — this is a presence filter, not "
                    "a boolean field."
                ),
            ),
            OpenApiParameter(
                "severity", str, enum=[s for s, _ in Flag.SEVERITY],
                description=(
                    "Exact match on the flag's severity. Thresholds are per "
                    "detector and are documented on `FlagSerializer.severity`."
                ),
            ),
            OpenApiParameter(
                "mentor", int,
                description=(
                    "Only flags for students assigned to this mentor "
                    "(`Mentor.id`, from `/api/mentors/`). Students with no "
                    "mentor never match."
                ),
            ),
            OpenApiParameter(
                "student", int,
                description="Only flags raised against this `Student.id`.",
            ),
        ],
        responses=ser.FlagSerializer(many=True),
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @extend_schema(
        request=ser.InterventionSerializer, responses={201: ser.InterventionSerializer},
        tags=["flags"],
    )
    @action(detail=True, methods=["post"])
    def intervene(self, request, pk=None):
        """Log what the mentor did about this flag.

        Deliberately does NOT resolve the flag. Contacting a student is not
        the same event as the student recovering, and `Flag.outcome` is a
        training label for the eventual risk model — so it has to record
        what actually happened, weeks later, not the act of picking up the
        phone. Closing is a separate, explicit judgement: see `resolve`.
        """
        flag = self.get_object()
        mentor = getattr(request.user, "mentor", None)
        if mentor is None:
            return Response({"detail": "Only mentors can log interventions."},
                            status=status.HTTP_403_FORBIDDEN)
        obj = Intervention.objects.create(
            flag=flag, mentor=mentor,
            action=request.data.get("action", ""), taken_at=timezone.now(),
        )
        return Response(ser.InterventionSerializer(obj).data, status=status.HTTP_201_CREATED)

    @extend_schema(
        request=ser.FlagResolveSerializer,
        responses={200: ser.FlagSerializer, 409: OpenApiResponse(description="Already resolved")},
        tags=["flags"],
    )
    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        """Close a flag, recording what actually became of the student.

        Until this existed there was no way to close a flag at all, and the
        consequences compounded quietly:

        * `run_detectors` suppresses a re-raise while a flag for the same
          (student, type, topic) is open — so with nothing ever closing,
          detectors went permanently mute. Seven of eight had already
          stopped firing on the seeded data.
        * `flags_resolved` and `recovery_rate_pct` on the director's KPI
          strip were structurally frozen. "17 of 23 flagged students
          recovered" is the number that renews a contract, and it could
          never move off its seeded value.

        `outcome` is required rather than defaulted. A closed flag with no
        stated outcome is a lost training label, and an honest "declined"
        is worth more to the model than a polite blank.
        """
        flag = self.get_object()
        mentor = getattr(request.user, "mentor", None)
        if mentor is None:
            return Response({"detail": "Only mentors can resolve flags."},
                            status=status.HTTP_403_FORBIDDEN)
        if flag.resolved_at is not None:
            return Response(
                {"detail": f"Already resolved on {flag.resolved_at.date()} as '{flag.outcome}'."},
                status=status.HTTP_409_CONFLICT,
            )

        payload = ser.FlagResolveSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        flag.outcome = payload.validated_data["outcome"]
        flag.resolved_at = timezone.now()
        flag.save(update_fields=["outcome", "resolved_at"])

        note = payload.validated_data.get("note", "")
        if note:
            Intervention.objects.create(
                flag=flag, mentor=mentor, action=note, taken_at=timezone.now()
            )
        return Response(ser.FlagSerializer(flag).data)


@extend_schema(tags=["papers"], parameters=[INSTITUTE_PARAM])
class TestPaperViewSet(TenantScopedMixin, viewsets.ReadOnlyModelViewSet):
    """Mock papers the institute has held.

    **Ordered by `held_on` descending** — most recent first, from
    `TestPaper.Meta.ordering`. The first element is therefore the paper
    `/api/dashboard/summary/` reports `batch_mock_avg` for, which is what
    lets the console label the KPI without a second request.
    """

    serializer_class = ser.TestPaperSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        # `id` as tie-break: two papers can be held on the same day.
        return self.scoped(TestPaper.objects.all()).order_by("-held_on", "-id")


@extend_schema(tags=["dashboard"], parameters=[INSTITUTE_PARAM])
class DashboardViewSet(TenantScopedMixin, viewsets.ViewSet):
    """The director's KPI strip. One endpoint, one request, no fan-out."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        parameters=[
            INSTITUTE_PARAM,
            OpenApiParameter(
                "batch", int,
                description=(
                    "Scope every KPI to one batch (`Batch.id`, from "
                    "`/api/batches/`). Omit it for the whole institute. "
                    "The response echoes `batch_id` / `batch_name` so the "
                    "caller can tell a filtered strip from an unfiltered "
                    "one. A batch id belonging to another institute is a "
                    "404, not a silent strip of zeroes.\n\n"
                    "`latest_paper_*` stays institute-wide: it names the "
                    "institute's most recent mock, and `batch_mock_avg` is "
                    "that paper restricted to this batch's students. If the "
                    "batch did not sit it, `latest_paper_students` is 0 and "
                    "`batch_mock_avg` is null."
                ),
            ),
        ],
        responses={200: ser.DashboardSummarySerializer, 404: ser.DetailSerializer},
        tags=["dashboard"],
    )
    @action(detail=False)
    def summary(self, request):
        """The director's KPI strip. Three things were wrong with it.

        **① It read the institute's entire attempt history.** The old
        `batch_mock_avg` query was `filter(test_paper__isnull=False)` with
        an `order_by` that the aggregate discarded, so Postgres did a Seq
        Scan over every attempt ever recorded — 24,000 rows and 343
        buffers on the seed, and O(history) on the most-visited page in
        the product. At the design's volume (45k attempts per institute
        per month) that is a multi-second query on every dashboard load.

        No index fixes it, because the query genuinely wanted every row.
        Asking for one paper instead is what fixes it.

        **Re-measured, because the number in the handoff was for a
        different query.** Three warm runs of each, `EXPLAIN (ANALYZE,
        BUFFERS)` against the seeded 24,000 attempts:

        ```
        old  Seq Scan, 24000 rows, SUM only          343 buffers  3.56 ms
        new  Index Scan, 3300 rows, SUM + COUNT(DISTINCT student_id)
                                                      52 buffers  1.14 ms
        new  Index Scan, 3300 rows, SUM only          52 buffers  0.61 ms
        ```

        So **6.6x fewer buffers and 3.1x faster** as actually shipped.
        The handoff's "12x / 0.687 ms" was measured on a bare `SUM`; the
        shipped version also needs `COUNT(DISTINCT student_id)` to have a
        denominator, and that adds a quicksort of 3,300 rows which roughly
        doubles the time. Against the same bare-`SUM` shape this
        reproduces at 0.61 ms — 5.8x, not 12x, because the 8.7 ms
        baseline was a colder cache than this 3.56 ms one.

        The multiple is the least interesting part. `old` is
        O(institute history) and `new` is O(one paper): at the design's
        45k attempts per institute per month the old plan is reading two
        years of history on every dashboard load while the new one still
        reads ~3,300 rows.

        **② `batch_mock_avg` was a SUM.** It added up every mark scored by
        every student on every paper and presented the total as an
        average. On the seeded institute it now reads **52,471.0** against
        a paper worth 300 — the number grew as more events landed, which
        is the tell. It is now the mean total per student on the latest
        paper: **163.2 of 300 over 44 sitters**. Confirmed fixed.

        **③ `revision_debt_pct` was not a percentage.** It divided a sum
        of per-student overdue counts by the student count — a mean, not a
        share, free to exceed 100 and meaningless against the `%` the UI
        renders beside it. It is now the share of scheduled revisions that
        are overdue, and the old quantity is still available under the
        name it should always have had, `avg_revision_debt`.

        **④ `?batch=` now scopes the whole strip.** The console has had a
        batch filter since the first frontend pass and the KPI strip
        ignored it (`web/src/api/gaps.ts: DASHBOARD_BATCH_SCOPE`), so
        picking "Alpha" narrowed the triage table underneath a header
        still reporting the whole institute — two different populations
        stacked on one screen with nothing to say so. Every count,
        average and rate below is filtered; `batch_id` / `batch_name` come
        back in the payload so the caller can prove which one it got.
        """
        inst = self.institute_id()
        if inst is None:
            return Response(
                ser.DashboardSummarySerializer(_EMPTY_SUMMARY).data
            )

        # Resolve `?batch=` before anything else. An unknown or
        # cross-tenant id is a 404 rather than a strip of zeroes: zeroes
        # are a legitimate answer for a real empty batch, so they must not
        # double as the error case.
        batch = None
        raw_batch = request.query_params.get("batch")
        if raw_batch:
            try:
                batch_id = int(raw_batch)
            except (TypeError, ValueError):
                return Response({"detail": "?batch= must be a numeric Batch id."},
                                status=status.HTTP_400_BAD_REQUEST)
            batch = (
                Batch.objects.filter(institute_id=inst, id=batch_id)
                .values("id", "name")
                .first()
            )
            if batch is None:
                return Response({"detail": "No such batch in this institute."},
                                status=status.HTTP_404_NOT_FOUND)

        week_ago = timezone.now() - timezone.timedelta(days=7)
        students = Student.objects.filter(institute_id=inst)
        flags = Flag.objects.filter(institute_id=inst)
        revisions = RevisionEvent.objects.filter(institute_id=inst)
        if batch:
            students = students.filter(batch_id=batch["id"])
            flags = flags.filter(student__batch_id=batch["id"])
            revisions = revisions.filter(student__batch_id=batch["id"])

        closed = flags.filter(resolved_at__isnull=False)
        closed_n = closed.count()
        recovered = closed.filter(outcome=Flag.RECOVERED).count()
        total_students = students.count()

        paper = (
            TestPaper.objects.filter(institute_id=inst)
            .order_by("-held_on")
            .values("id", "name", "held_on", "max_marks")
            .first()
        )
        mock_avg = sat_by = None
        if paper:
            # Deliberately still one paper and one index scan. Adding
            # `student__batch_id` keeps the same `test_paper_id` index
            # entry point and only narrows the filter, so the batch-scoped
            # form costs a join against `tenancy_student` and nothing
            # more — it does not reopen the history scan this replaced.
            attempts = Attempt.objects.filter(
                institute_id=inst, test_paper_id=paper["id"]
            )
            if batch:
                attempts = attempts.filter(student__batch_id=batch["id"])
            agg = attempts.aggregate(
                total=Sum("marks"), sitters=Count("student_id", distinct=True)
            )
            sat_by = agg["sitters"] or 0
            if sat_by:
                mock_avg = round((agg["total"] or 0) / sat_by, 1)

        # One aggregate over revision events rather than a per-student
        # rollup: this is a share of cycles, so cycles are the denominator.
        rev = revisions.aggregate(
            due=Count("id", filter=Q(scheduled_for__lt=timezone.localdate())),
            overdue=Count(
                "id",
                filter=Q(
                    scheduled_for__lt=timezone.localdate(), done_at__isnull=True
                ),
            ),
        )
        debt_total = students.aggregate(d=Sum("state__revision_debt"))["d"] or 0

        data = {
            "batch_id": batch["id"] if batch else None,
            "batch_name": batch["name"] if batch else None,
            "total_students": total_students,
            "active_students": students.filter(exited_at__isnull=True).count(),
            "flagged_this_week": flags.filter(raised_at__gte=week_ago).count(),
            "critical_flags": flags.filter(resolved_at__isnull=True,
                                           severity=Flag.CRITICAL).count(),
            "batch_mock_avg": mock_avg,
            "latest_paper_id": paper["id"] if paper else None,
            "latest_paper_name": paper["name"] if paper else None,
            "latest_paper_held_on": paper["held_on"] if paper else None,
            "latest_paper_max_marks": paper["max_marks"] if paper else None,
            "latest_paper_students": sat_by or 0,
            "revision_debt_pct": (
                round(rev["overdue"] / rev["due"] * 100, 1) if rev["due"] else 0.0
            ),
            "avg_revision_debt": (
                round(debt_total / total_students, 1) if total_students else 0.0
            ),
            "flags_resolved": closed_n,
            "recovery_rate_pct": round(recovered / closed_n * 100, 1) if closed_n else None,
        }
        return Response(ser.DashboardSummarySerializer(data).data)


@extend_schema(tags=["student-app"])
class MyPlanViewSet(TenantScopedMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    """Today's plan for the logged-in student.

    Scoped by the account, not by a path parameter: there is no way to
    ask for another student's plan. A caller with no linked `Student`
    gets an empty list rather than a 403, because a mentor opening the
    student PWA is a navigation mistake, not an attack.

    Ordered by `start_time` ascending.
    """

    serializer_class = ser.PlanBlockSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        student = getattr(self.request.user, "student", None)
        if student is None:
            return PlanBlock.objects.none()
        day = self.request.query_params.get("date") or timezone.localdate()
        return (
            PlanBlock.objects.filter(student=student, date=day)
            .select_related("topic__parent__parent")
            .order_by("start_time", "id")
        )

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "date", OpenApiTypes.DATE,
                description=(
                    "The day to plan for, `YYYY-MM-DD`. Defaults to today in "
                    "the server's local timezone. An unparseable date is a "
                    "400 from the ORM."
                ),
            ),
        ],
        responses=ser.PlanBlockSerializer(many=True),
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @extend_schema(request=None, responses=ser.PlanBlockSerializer, tags=["student-app"])
    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        block = self.get_queryset().filter(pk=pk).first()
        if block is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        block.completed = True
        block.save(update_fields=["completed"])
        return Response(ser.PlanBlockSerializer(block).data)


@extend_schema(tags=["student-app"])
class StudyLogViewSet(TenantScopedMixin, mixins.CreateModelMixin,
                      mixins.ListModelMixin, viewsets.GenericViewSet):
    """The logged-in student's own study log — read and append.

    Ordered by `ts` descending, most recent first. Append-only by
    construction: there is no update or delete route, matching the
    append-only rule the admin enforces on `StudyLog` itself.
    """

    serializer_class = ser.StudyLogCreateSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        student = getattr(self.request.user, "student", None)
        if student is None:
            return StudyLog.objects.none()
        # The `[:100]` cap that used to be here made `count` lie: a
        # sliced queryset counts the slice, so a student with 400 logs
        # was told they had 100 and page 3 came back empty. Pagination
        # already bounds the response; the cap only bounded the truth.
        return StudyLog.objects.filter(student=student).order_by("-ts", "-id")

    def perform_create(self, serializer):
        student = self.request.user.student
        serializer.save(student=student, institute=student.institute)
