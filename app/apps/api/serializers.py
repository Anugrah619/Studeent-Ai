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


class MarksLostSerializer(serializers.Serializer):
    """Mistake taxonomy for one paper — the line that sells the product."""

    conceptual_gap = serializers.IntegerField()
    execution_error = serializers.IntegerField()
    time_exhaustion = serializers.IntegerField()
    avoidable_skip = serializers.IntegerField()
    total_lost = serializers.IntegerField()
    recoverable = serializers.IntegerField(
        help_text="Marks lost to causes that need no new learning."
    )


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
    """Director's KPI strip."""

    total_students = serializers.IntegerField()
    active_students = serializers.IntegerField()
    flagged_this_week = serializers.IntegerField()
    critical_flags = serializers.IntegerField()
    batch_mock_avg = serializers.FloatField(allow_null=True)
    revision_debt_pct = serializers.FloatField()
    flags_resolved = serializers.IntegerField()
    recovery_rate_pct = serializers.FloatField(
        allow_null=True, help_text="Share of closed flags whose outcome was 'recovered'."
    )
