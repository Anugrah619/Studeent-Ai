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
from apps.events.models import Attempt, StudyLog
from apps.ingestion.models import TestPaper
from apps.tenancy.models import Batch, Student

from . import serializers as ser

SUBJECTS = ["Physics", "Chemistry", "Maths"]


def subject_name(topic) -> str:
    node = topic
    while node.parent_id is not None:
        node = node.parent
    return node.name


class TenantScopedMixin:
    """Restrict every queryset to the caller's institute."""

    def institute_id(self):
        user = self.request.user
        mentor = getattr(user, "mentor", None)
        if mentor:
            return mentor.institute_id
        student = getattr(user, "student", None)
        if student:
            return student.institute_id
        # Superusers may pass ?institute=<id> for admin tooling.
        return self.request.query_params.get("institute")

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
        """Study-time share vs marks-lost share. The neglect chart."""
        inst = self.institute_id()
        time_by, lost_by, att_by, cor_by = {}, {}, {}, {}

        for r in (
            StudyLog.objects.filter(student_id=pk, institute_id=inst)
            .select_related("topic__parent__parent")
            .values("topic__parent__parent__name").annotate(m=Sum("minutes"))
        ):
            time_by[r["topic__parent__parent__name"]] = r["m"] or 0

        for r in (
            Attempt.objects.filter(student_id=pk, institute_id=inst)
            .select_related("topic__parent__parent")
            .values("topic__parent__parent__name")
            .annotate(
                lost=Count("id", filter=~Q(status=Attempt.CORRECT)),
                attempted=Count("id", filter=Q(status__in=[Attempt.CORRECT, Attempt.WRONG])),
                correct=Count("id", filter=Q(status=Attempt.CORRECT)),
            )
        ):
            name = r["topic__parent__parent__name"]
            lost_by[name], att_by[name], cor_by[name] = r["lost"], r["attempted"], r["correct"]

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
        parameters=[OpenApiParameter("paper", int, required=True)],
        responses=ser.MarksLostSerializer, tags=["students"],
    )
    @action(detail=True, url_path="marks-lost")
    def marks_lost(self, request, pk=None):
        """Partition lost marks by cause for one paper.

        Cause is inferred from status plus prior mastery on the topic:
        a wrong answer on a topic the student knows is an execution error,
        not a conceptual gap.
        """
        paper_id = request.query_params.get("paper")
        attempts = (
            Attempt.objects.filter(student_id=pk, institute_id=self.institute_id(),
                                   test_paper_id=paper_id)
            .select_related("topic")
        )
        mastery = dict(
            TopicState.objects.filter(student_id=pk, mastery__isnull=False)
            .values_list("topic_id", "mastery")
        )
        MARK = 4
        buckets = {"conceptual_gap": 0, "execution_error": 0,
                   "time_exhaustion": 0, "avoidable_skip": 0}
        for a in attempts:
            m = mastery.get(a.topic_id, 0.0)
            if a.status == Attempt.WRONG:
                key = "execution_error" if m >= 0.6 else "conceptual_gap"
                buckets[key] += MARK + 1          # lost the mark and took the penalty
            elif a.status == Attempt.NOT_REACHED:
                buckets["time_exhaustion"] += MARK
            elif a.status == Attempt.BLANK:
                key = "avoidable_skip" if m >= 0.6 else "conceptual_gap"
                buckets[key] += MARK
        total = sum(buckets.values())
        data = {
            **buckets,
            "total_lost": total,
            "recoverable": total - buckets["conceptual_gap"],
        }
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
        inst = self.institute_id()
        week_ago = timezone.now() - timezone.timedelta(days=7)
        students = Student.objects.filter(institute_id=inst)
        flags = Flag.objects.filter(institute_id=inst)
        closed = flags.filter(resolved_at__isnull=False)
        recovered = closed.filter(outcome=Flag.RECOVERED).count()

        avg = (
            Attempt.objects.filter(institute_id=inst, test_paper__isnull=False)
            .order_by("-test_paper__held_on")
            .values("test_paper_id").annotate(t=Sum("marks")).first()
        )
        debt_total = students.aggregate(d=Sum("state__revision_debt"))["d"] or 0

        data = {
            "total_students": students.count(),
            "active_students": students.filter(exited_at__isnull=True).count(),
            "flagged_this_week": flags.filter(raised_at__gte=week_ago).count(),
            "critical_flags": flags.filter(resolved_at__isnull=True,
                                           severity=Flag.CRITICAL).count(),
            "batch_mock_avg": round(avg["t"], 1) if avg and avg["t"] else None,
            "revision_debt_pct": round(debt_total / max(students.count(), 1), 1),
            "flags_resolved": closed.count(),
            "recovery_rate_pct": round(recovered / closed.count() * 100, 1) if closed.count() else None,
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
