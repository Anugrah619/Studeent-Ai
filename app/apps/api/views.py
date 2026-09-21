"""API viewsets.

Every queryset is tenant-scoped. RLS in Postgres is the backstop (P0 day 5),
but scoping here too means a bug shows up as an empty list rather than a
leak, and the intent is visible where developers actually read.
"""

from django.db.models import Count, Q, Sum
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.derived.models import Flag, Intervention, PlanBlock, TopicState
from apps.derived.services import features
from apps.events.models import Attempt, RevisionEvent, StudyLog
from apps.events.services import mock_analysis
from apps.ingestion.models import TestPaper
from apps.tenancy.models import Batch, Student

from . import serializers as ser

SUBJECTS = ["Physics", "Chemistry", "Maths"]

#: What the KPI strip shows a caller bound to no institute. Every count is
#: zero rather than absent, so the console renders an empty dashboard
#: instead of failing on a missing key.
_EMPTY_SUMMARY = {
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


@extend_schema(tags=["batches"])
class BatchViewSet(TenantScopedMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = ser.BatchSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return self.scoped(
            Batch.objects.select_related("exam").annotate(student_count=Count("students"))
        )


@extend_schema(tags=["students"])
class StudentViewSet(TenantScopedMixin, viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]

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
            qs = qs.filter(state__risk_score__gte=0.55)
        if self.request.query_params.get("active") == "true":
            qs = qs.filter(exited_at__isnull=True)
        return qs.order_by("-state__risk_score", "name")

    @extend_schema(
        parameters=[OpenApiParameter("batch", int), OpenApiParameter("at_risk", bool),
                    OpenApiParameter("active", bool)],
        responses=ser.StudentListSerializer(many=True),
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @extend_schema(responses=ser.TopicStateSerializer(many=True), tags=["students"])
    @action(detail=True, url_path="topic-states")
    def topic_states(self, request, pk=None):
        qs = (
            TopicState.objects.filter(student_id=pk, institute_id=self.institute_id())
            .select_related("topic__parent__parent")
            .order_by("mastery")
        )
        if request.query_params.get("weak") == "true":
            qs = qs.filter(mastery__lt=0.5, mastery__isnull=False)
        return Response(ser.TopicStateSerializer(qs[:200], many=True).data)

    @extend_schema(responses=ser.MockScoreSerializer(many=True), tags=["students"])
    @action(detail=True, url_path="mock-scores")
    def mock_scores(self, request, pk=None):
        """Per-subject totals for every paper this student sat."""
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
        return Response(ser.MockScoreSerializer(out, many=True).data)

    @extend_schema(responses=ser.SubjectBreakdownSerializer(many=True), tags=["students"])
    @action(detail=True, url_path="subject-breakdown")
    def subject_breakdown(self, request, pk=None):
        """Study-time share vs marks-lost share. The neglect chart.

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
            return Response([])
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
        return Response(ser.SubjectBreakdownSerializer(out, many=True).data)

    @extend_schema(
        parameters=[
            OpenApiParameter("paper", int, required=True),
            OpenApiParameter(
                "detail", bool,
                description="Include the per-question cause breakdown.",
            ),
        ],
        responses={200: ser.MarksLostSerializer, 404: ser.DetailSerializer},
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

    @extend_schema(responses=ser.AttemptSerializer(many=True), tags=["students"])
    @action(detail=True)
    def attempts(self, request, pk=None):
        qs = Attempt.objects.filter(
            student_id=pk, institute_id=self.institute_id()
        ).select_related("topic")
        paper = request.query_params.get("paper")
        if paper:
            qs = qs.filter(test_paper_id=paper)
        return Response(ser.AttemptSerializer(qs.order_by("question_id")[:400], many=True).data)


@extend_schema(tags=["flags"])
class FlagViewSet(TenantScopedMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = ser.FlagSerializer
    permission_classes = [IsAuthenticated]

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
        return qs.order_by("-raised_at")

    @extend_schema(
        request=ser.InterventionSerializer, responses={201: ser.InterventionSerializer},
        tags=["flags"],
    )
    @action(detail=True, methods=["post"])
    def intervene(self, request, pk=None):
        """Log what the mentor did. This is what closes the risk loop."""
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


@extend_schema(tags=["papers"])
class TestPaperViewSet(TenantScopedMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = ser.TestPaperSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return self.scoped(TestPaper.objects.all())


@extend_schema(tags=["dashboard"])
class DashboardViewSet(TenantScopedMixin, viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses=ser.DashboardSummarySerializer, tags=["dashboard"])
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
        Asking for one paper instead is what fixes it: the DB agent
        measured the rewritten form at **56 buffers and 0.687 ms, 12x
        faster**, and — the part that matters more than the multiple — it
        stops growing with history.

        **② `batch_mock_avg` was a SUM.** It added up every mark scored by
        every student on every paper and presented the total as an
        average. On the seeded institute it read 8,437.0 out of a possible
        300. It is now the mean total per student on the latest paper.

        **③ `revision_debt_pct` was not a percentage.** It divided a sum
        of per-student overdue counts by the student count — a mean, not a
        share, free to exceed 100 and meaningless against the `%` the UI
        renders beside it. It is now the share of scheduled revisions that
        are overdue, and the old quantity is still available under the
        name it should always have had, `avg_revision_debt`.
        """
        inst = self.institute_id()
        if inst is None:
            return Response(
                ser.DashboardSummarySerializer(_EMPTY_SUMMARY).data
            )

        week_ago = timezone.now() - timezone.timedelta(days=7)
        students = Student.objects.filter(institute_id=inst)
        flags = Flag.objects.filter(institute_id=inst)
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
            agg = Attempt.objects.filter(
                institute_id=inst, test_paper_id=paper["id"]
            ).aggregate(
                total=Sum("marks"), sitters=Count("student_id", distinct=True)
            )
            sat_by = agg["sitters"] or 0
            if sat_by:
                mock_avg = round((agg["total"] or 0) / sat_by, 1)

        # One aggregate over revision events rather than a per-student
        # rollup: this is a share of cycles, so cycles are the denominator.
        rev = RevisionEvent.objects.filter(institute_id=inst).aggregate(
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
    """Today's plan for the logged-in student."""

    serializer_class = ser.PlanBlockSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        student = getattr(self.request.user, "student", None)
        if student is None:
            return PlanBlock.objects.none()
        day = self.request.query_params.get("date") or timezone.localdate()
        return (
            PlanBlock.objects.filter(student=student, date=day)
            .select_related("topic__parent__parent")
            .order_by("start_time")
        )

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
    serializer_class = ser.StudyLogCreateSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        student = getattr(self.request.user, "student", None)
        if student is None:
            return StudyLog.objects.none()
        return StudyLog.objects.filter(student=student).order_by("-ts")[:100]

    def perform_create(self, serializer):
        student = self.request.user.student
        serializer.save(student=student, institute=student.institute)
