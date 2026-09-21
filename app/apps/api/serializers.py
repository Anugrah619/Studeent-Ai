"""Serializers. These ARE the OpenAPI contract.

drf-spectacular reads these to generate `openapi.yaml`, which is the
source of truth every agent works against. Changing a field here changes
the contract — regenerate the schema and tell the frontend.
"""

from rest_framework import serializers

from apps.derived.models import Flag, Intervention, PlanBlock, StudentState, TopicState
from apps.events.models import Attempt, StudyLog
from apps.ingestion.models import TestPaper
from apps.syllabus.models import Topic
from apps.tenancy.models import Batch, Institute, Mentor, Student


class InstituteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Institute
        fields = ["id", "name", "city", "slug"]


class MentorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Mentor
        fields = ["id", "name", "email"]


class BatchSerializer(serializers.ModelSerializer):
    exam_code = serializers.CharField(source="exam.code", read_only=True)
    student_count = serializers.IntegerField(read_only=True, required=False)

    class Meta:
        model = Batch
        fields = ["id", "name", "exam_code", "year", "exam_date", "student_count"]


class TopicSerializer(serializers.ModelSerializer):
    subject = serializers.SerializerMethodField()

    class Meta:
        model = Topic
        fields = ["id", "name", "kind", "weight", "subject"]

    @staticmethod
    def get_subject(obj) -> str:
        node = obj
        while node.parent_id is not None:
            node = node.parent
        return node.name


class StudentStateSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentState
        fields = [
            "consistency", "load_index", "balance_index", "revision_debt",
            "risk_score", "mock_avg", "mock_trend", "syllabus_pct", "computed_at",
        ]


class StudentListSerializer(serializers.ModelSerializer):
    """Row in the director's triage table."""

    batch_name = serializers.CharField(source="batch.name", read_only=True)
    mentor_name = serializers.CharField(source="mentor.name", read_only=True, default=None)
    risk_score = serializers.FloatField(source="state.risk_score", read_only=True, default=None)
    mock_trend = serializers.FloatField(source="state.mock_trend", read_only=True, default=None)
    mock_avg = serializers.FloatField(source="state.mock_avg", read_only=True, default=None)
    open_flags = serializers.IntegerField(read_only=True, required=False)

    class Meta:
        model = Student
        fields = [
            "id", "name", "roll_no", "batch_name", "mentor_name", "target",
            "risk_score", "mock_trend", "mock_avg", "open_flags", "exited_at",
        ]


class StudentDetailSerializer(serializers.ModelSerializer):
    batch = BatchSerializer(read_only=True)
    mentor = MentorSerializer(read_only=True)
    state = StudentStateSerializer(read_only=True)

    class Meta:
        model = Student
        fields = [
            "id", "name", "roll_no", "target", "joined_at", "exited_at",
            "batch", "mentor", "state",
        ]


class TopicStateSerializer(serializers.ModelSerializer):
    topic = TopicSerializer(read_only=True)
    confidence_gap = serializers.FloatField(read_only=True)

    class Meta:
        model = TopicState
        fields = [
            "id", "topic", "mastery", "retention", "attempts_n", "correct_n",
            "accuracy_30d", "exposure_min", "avg_time_spent", "self_rating",
            "confidence_gap", "last_seen", "last_revised",
        ]


class FlagSerializer(serializers.ModelSerializer):
    student_id = serializers.IntegerField(read_only=True)
    student_name = serializers.CharField(source="student.name", read_only=True)
    batch_name = serializers.CharField(source="student.batch.name", read_only=True)
    mentor_name = serializers.CharField(source="student.mentor.name", read_only=True, default=None)
    topic_name = serializers.CharField(source="topic.name", read_only=True, default=None)
    is_open = serializers.BooleanField(read_only=True)

    class Meta:
        model = Flag
        fields = [
            "id", "student_id", "student_name", "batch_name", "mentor_name",
            "topic_name", "type", "severity", "headline", "evidence",
            "rule_version", "raised_at", "resolved_at", "outcome", "is_open",
        ]


class InterventionSerializer(serializers.ModelSerializer):
    mentor_name = serializers.CharField(source="mentor.name", read_only=True)

    class Meta:
        model = Intervention
        fields = ["id", "flag", "mentor", "mentor_name", "action", "taken_at"]
        read_only_fields = ["taken_at"]


class SubjectBreakdownSerializer(serializers.Serializer):
    """Time share vs marks-lost share — the neglect chart."""

    subject = serializers.CharField()
    time_share_pct = serializers.FloatField()
    marks_lost_share_pct = serializers.FloatField()
    accuracy_pct = serializers.FloatField(allow_null=True)


class MockScoreSerializer(serializers.Serializer):
    paper_id = serializers.IntegerField()
    paper_name = serializers.CharField()
    held_on = serializers.DateField()
    physics = serializers.FloatField()
    chemistry = serializers.FloatField()
    maths = serializers.FloatField()
    total = serializers.FloatField()


class MarksLostCauseSerializer(serializers.Serializer):
    """One row of the mistake taxonomy, chart-ready."""

    cause = serializers.ChoiceField(
        choices=["conceptual_gap", "execution_error", "time_exhaustion", "avoidable_skip"]
    )
    marks = serializers.IntegerField()
    questions = serializers.IntegerField()
    share_pct = serializers.FloatField()


class LossTopicSerializer(serializers.Serializer):
    """Where the marks actually went, by chapter."""

    topic_id = serializers.IntegerField(allow_null=True)
    topic = serializers.CharField()
    subject = serializers.CharField()
    marks_lost = serializers.FloatField()
    questions = serializers.IntegerField()


class MarksLostSerializer(serializers.Serializer):
    """Mistake taxonomy for one paper — the line that sells the product.

    The four cause fields and `total_lost` / `recoverable` are unchanged
    from v0.1. Everything else is additive: paper identity, the score the
    taxonomy partitions, the student's own pace baseline that the cause
    rules used, and the per-chapter breakdown a mentor asks for next.
    """

    paper_id = serializers.IntegerField()
    paper_name = serializers.CharField()
    held_on = serializers.DateField()
    max_marks = serializers.IntegerField()
    questions = serializers.IntegerField()
    attempted = serializers.IntegerField()
    score = serializers.FloatField()

    conceptual_gap = serializers.IntegerField()
    execution_error = serializers.IntegerField()
    time_exhaustion = serializers.IntegerField()
    avoidable_skip = serializers.IntegerField()
    total_lost = serializers.IntegerField()
    recoverable = serializers.IntegerField(
        help_text="Marks lost to causes that need no new learning."
    )

    time_baseline_sec = serializers.FloatField(
        allow_null=True,
        help_text=(
            "Median seconds this student spends on a question they get right. "
            "Null when they have fewer than 8 timed correct answers, in which "
            "case the time rule was not applied."
        ),
    )
    causes = MarksLostCauseSerializer(many=True)
    top_loss_topics = LossTopicSerializer(many=True)


class TestPaperSerializer(serializers.ModelSerializer):
    class Meta:
        model = TestPaper
        fields = ["id", "name", "held_on", "total_questions", "max_marks", "duration_min"]


class AttemptSerializer(serializers.ModelSerializer):
    topic_name = serializers.CharField(source="topic.name", read_only=True)

    class Meta:
        model = Attempt
        fields = [
            "id", "question_id", "topic_name", "status", "time_spent",
            "marks", "source", "ts",
        ]


class PlanBlockSerializer(serializers.ModelSerializer):
    topic_name = serializers.CharField(source="topic.name", read_only=True)
    subject = serializers.SerializerMethodField()

    class Meta:
        model = PlanBlock
        fields = [
            "id", "date", "start_time", "minutes", "mode", "topic_name",
            "subject", "reason_code", "reason_text", "completed",
        ]
        read_only_fields = ["date", "start_time", "minutes", "mode", "reason_code"]

    @staticmethod
    def get_subject(obj) -> str:
        node = obj.topic
        while node.parent_id is not None:
            node = node.parent
        return node.name


class StudyLogCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudyLog
        fields = ["id", "topic", "minutes", "mode", "ts"]


class DashboardSummarySerializer(serializers.Serializer):
    """Director's KPI strip.

    Two fields here changed *meaning* in v0.2 and the frontend must know:

    `batch_mock_avg` was a SUM of every mark every student ever scored on
    every paper, labelled as an average. It is now the mean total per
    student on the latest paper — which is what the label always claimed,
    and is also 12x cheaper because it stops reading the institute's
    entire history on every dashboard load.

    `revision_debt_pct` divided a sum of per-student debts by a student
    count and called the result a percentage; it could exceed 100 freely.
    It is now the genuine share of scheduled revisions that are overdue.
    The old quantity survives as `avg_revision_debt`, correctly named.
    """

    total_students = serializers.IntegerField()
    active_students = serializers.IntegerField()
    flagged_this_week = serializers.IntegerField()
    critical_flags = serializers.IntegerField()

    batch_mock_avg = serializers.FloatField(
        allow_null=True,
        help_text="Mean total marks per student on the most recent paper.",
    )
    latest_paper_id = serializers.IntegerField(allow_null=True)
    latest_paper_name = serializers.CharField(allow_null=True)
    latest_paper_held_on = serializers.DateField(allow_null=True)
    latest_paper_max_marks = serializers.IntegerField(allow_null=True)
    latest_paper_students = serializers.IntegerField(
        help_text="How many students sat the paper `batch_mock_avg` is computed over."
    )

    revision_debt_pct = serializers.FloatField(
        help_text="Share of scheduled revisions now past due and not done."
    )
    avg_revision_debt = serializers.FloatField(
        help_text="Mean overdue revision cycles per student."
    )

    flags_resolved = serializers.IntegerField()
    recovery_rate_pct = serializers.FloatField(
        allow_null=True, help_text="Share of closed flags whose outcome was 'recovered'."
    )


# ------------------------------------------------------------------- auth


class DetailSerializer(serializers.Serializer):
    """The one-key error/ack envelope DRF already uses everywhere."""

    detail = serializers.CharField()


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(
        style={"input_type": "password"}, trim_whitespace=False, write_only=True
    )


class MeSerializer(serializers.Serializer):
    """The caller's identity. Drives navigation and the institute label."""

    id = serializers.IntegerField()
    username = serializers.CharField()
    name = serializers.CharField()
    email = serializers.CharField(allow_blank=True)
    role = serializers.ChoiceField(
        choices=["mentor", "student", "director"],
        allow_null=True,
        help_text="Null for an authenticated account attached to nothing — which "
        "sees no tenant data at all, by design.",
    )
    institute = InstituteSerializer(allow_null=True)
    mentor_id = serializers.IntegerField(allow_null=True)
    student_id = serializers.IntegerField(allow_null=True)
    is_staff = serializers.BooleanField()
    is_superuser = serializers.BooleanField()
