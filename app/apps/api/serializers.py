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


#: The published meaning of `risk_score`, reused verbatim wherever the
#: field appears so the triage table and Student 360 cannot document it
#: differently. `AT_RISK_THRESHOLD` in `views.py` is the same 0.55 that
#: `?at_risk=true` filters on — one number, one definition.
#:
#: The bands exist because the frontend had to invent some
#: (`web/src/api/gaps.ts: RISK_SCORE_BANDS`) and invented them on a 0–100
#: scale, which this field has never used.
RISK_SCORE_HELP = (
    "Composite risk on a **0–1** scale, not 0–100. Null when there is not "
    "yet enough signal to score the student at all — an unscored student "
    "is unmeasured, not safe, and sorts out of the triage table rather "
    "than sitting at a confident 0.0.\n\n"
    "Bands, which `?at_risk=true` and the console's chips both key off:\n"
    "- `>= 0.75` critical\n"
    "- `>= 0.55` high — this is the at-risk threshold\n"
    "- `>= 0.35` watch\n"
    "- below that, ok\n\n"
    "It is a weighted sum of four normalised components, each "
    "explainable on its own: mock decline 0.50, subject imbalance 0.20, "
    "inconsistent study 0.20, revision debt 0.10. Components with no data "
    "are dropped and the remainder renormalised, so a student is never "
    "penalised for what is not known about them. These weights are a "
    "stated prior, not a trained model."
)


class MentorSerializer(serializers.ModelSerializer):
    """Who a flag can be routed to. Backs the intervention dialog.

    `student_count` is active students only — a mentor whose whole batch
    has left is available, and a director choosing between mentors is
    asking about present load, not historical.
    """

    student_count = serializers.IntegerField(
        read_only=True,
        # `default=None` rather than `required=False`, because this
        # serializer is also nested inside `StudentDetail.mentor`, where
        # the annotation does not exist. With `required=False` DRF drops
        # the key there while drf-spectacular still lists it as required
        # — a contract that says "always present" over a payload where it
        # sometimes is not. `null` says "not counted here" honestly.
        # `BatchSerializer.student_count` has the same latent problem and
        # is fixed the same way below.
        default=None,
        allow_null=True,
        help_text=(
            "Active students currently assigned to this mentor. Null when "
            "this mentor is embedded in another payload (e.g. "
            "`StudentDetail.mentor`), where the count is not computed."
        ),
    )

    class Meta:
        model = Mentor
        fields = ["id", "name", "email", "student_count"]


class BatchSerializer(serializers.ModelSerializer):
    exam_code = serializers.CharField(source="exam.code", read_only=True)
    # See `MentorSerializer.student_count`: `required=False` made the
    # schema promise a key that `StudentDetail.batch` does not carry,
    # because only `BatchViewSet` annotates it.
    student_count = serializers.IntegerField(
        read_only=True,
        default=None,
        allow_null=True,
        help_text=(
            "Students in this batch. Null when the batch is embedded in "
            "another payload (e.g. `StudentDetail.batch`), where it is not "
            "computed."
        ),
    )

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
    """The per-student rollup behind Student 360's health header.

    Every float here is on a stated scale, because the one field that was
    not (`risk_score`) got rendered on the wrong one.
    """

    risk_score = serializers.FloatField(
        read_only=True, allow_null=True, help_text=RISK_SCORE_HELP
    )
    consistency = serializers.FloatField(
        read_only=True, allow_null=True,
        help_text="Study regularity, 0–1. Share of recent days with any logged study.",
    )
    load_index = serializers.FloatField(
        read_only=True, allow_null=True,
        help_text=(
            "Study hours this month over last month, clamped to 0–3. **A "
            "ratio, not a fraction**: 1.0 is steady, 1.3 is a third more "
            "work than last month. Null when there is no prior month."
        ),
    )
    balance_index = serializers.FloatField(
        read_only=True, allow_null=True,
        help_text=(
            "Largest gap, 0–1, between a subject's share of study time and "
            "its share of marks lost. 0 is perfectly aimed effort. Below "
            "0.10 is normal variation rather than a signal."
        ),
    )
    revision_debt = serializers.IntegerField(
        read_only=True, help_text="Count of revision cycles now past due and not done."
    )
    mock_avg = serializers.FloatField(
        read_only=True, allow_null=True, help_text="Mean total marks across this student's papers."
    )
    mock_trend = serializers.FloatField(
        read_only=True, allow_null=True,
        help_text=(
            "Marks gained or lost across recent papers. **Signed marks, not "
            "a percentage** — negative is a decline, and -40 is the point "
            "where the decline component of `risk_score` saturates."
        ),
    )
    syllabus_pct = serializers.FloatField(
        read_only=True, allow_null=True,
        help_text=(
            "Share of the *batch's* chapters marked taught, 0–100. A batch "
            "property, not a student one: a student cannot be behind on a "
            "chapter nobody has taught yet."
        ),
    )

    class Meta:
        model = StudentState
        fields = [
            "consistency", "load_index", "balance_index", "revision_debt",
            "risk_score", "mock_avg", "mock_trend", "syllabus_pct", "computed_at",
        ]


class StudentListSerializer(serializers.ModelSerializer):
    """Row in the director's triage table.

    Sortable on `risk_score`, `mock_avg`, `mock_trend`, `open_flags`,
    `name` and `roll_no` via `?ordering=`; default `-risk_score,name`.
    """

    batch_name = serializers.CharField(source="batch.name", read_only=True)
    mentor_name = serializers.CharField(source="mentor.name", read_only=True, default=None)
    risk_score = serializers.FloatField(
        source="state.risk_score", read_only=True, default=None,
        help_text=RISK_SCORE_HELP,
    )
    mock_trend = serializers.FloatField(
        source="state.mock_trend", read_only=True, default=None,
        help_text="Marks gained or lost across recent papers. Signed marks, not a percentage.",
    )
    mock_avg = serializers.FloatField(
        source="state.mock_avg", read_only=True, default=None,
        help_text="Mean total marks across this student's papers.",
    )
    open_flags = serializers.IntegerField(
        read_only=True, required=False,
        help_text="Flags currently unresolved for this student.",
    )

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
    """One (student, chapter) rollup. Returned weakest-mastery-first."""

    topic = TopicSerializer(read_only=True)
    confidence_gap = serializers.FloatField(
        read_only=True, allow_null=True,
        help_text=(
            "`self_rating` rescaled to 0–1 minus `mastery`, so both sides "
            "are on one scale. **Positive means overconfident** — rates it "
            "strong, scores weak. Null when either input is missing."
        ),
    )
    mastery = serializers.FloatField(
        read_only=True, allow_null=True,
        help_text=(
            "Measured command of this chapter, 0–1. **Null below the "
            "evidence floor of 4 attempts** — roughly a quarter of rows on "
            "the seeded data. Null is not zero and must not render as 0%: "
            "it means not enough evidence to say, and a client that "
            "conflates the two shows a diligent new student as a crisis."
        ),
    )
    retention = serializers.FloatField(
        read_only=True, allow_null=True,
        help_text="Forecast recall probability, 0–1, decayed since `last_revised`.",
    )
    # `accuracy_30d` was here and is **removed from the contract in
    # v0.3**. It is still computed and still stored — the column is an
    # internal diagnostic and the admin shows it — but it is no longer a
    # number a client can bind to, for three reasons:
    #
    #   1. It was null on 86% of rows, and of the 14% that carried a
    #      value, 89% were a bare 0% or 100%. Raising its floor from 3 to
    #      match mastery's 4 does not fix that: on the seeded data it
    #      halves the populated rows (490 -> 253 pairs) and still leaves
    #      45% of them at exactly 0 or exactly 1, because four questions
    #      can only produce {0, ¼, ½, ¾, 1}. That trades one half of the
    #      defect for the other instead of removing it.
    #   2. It duplicates `mastery` and loses. Both answer "how is this
    #      student doing on this chapter lately"; `mastery` does it with
    #      a 20-attempt window, half-life decay, a stated evidence floor
    #      and documented null-is-not-zero semantics. A client given both
    #      has no way to know which to trust, and the weaker one is the
    #      one that looks like a plain percentage.
    #   3. It is the only field in `TopicState` anchored to the wall
    #      clock, which is exactly what the `features` module docstring
    #      refuses to do for `mastery` because it breaks
    #      rebuild-equivalence. A stored `accuracy_30d` also goes stale
    #      with no event behind it: nothing happens for 31 days and the
    #      row keeps serving last month's number until something
    #      recomputes that pair.
    #
    # A recency signal is worth publishing once it has a defensible floor
    # and an anchor that is not `now()`. This one had neither, and it was
    # already in a published contract where the first client to bind it
    # would render a confident 100% off three questions.
    self_rating = serializers.IntegerField(
        read_only=True, allow_null=True,
        help_text="The student's own latest confidence, 1–5. Null if never rated.",
    )

    class Meta:
        model = TopicState
        fields = [
            "id", "topic", "mastery", "retention", "attempts_n", "correct_n",
            "exposure_min", "avg_time_spent", "self_rating",
            "confidence_gap", "last_seen", "last_revised",
        ]


class FlagSerializer(serializers.ModelSerializer):
    """One detector output, evidenced and routable.

    Filterable by `?open=`, `?severity=`, `?student=` and `?mentor=`;
    ordered by `raised_at` descending.
    """

    student_id = serializers.IntegerField(read_only=True)
    student_name = serializers.CharField(source="student.name", read_only=True)
    batch_name = serializers.CharField(source="student.batch.name", read_only=True)
    mentor_name = serializers.CharField(source="student.mentor.name", read_only=True, default=None)
    topic_name = serializers.CharField(source="topic.name", read_only=True, default=None)
    is_open = serializers.BooleanField(
        read_only=True, help_text="`resolved_at is null`. The same set `?open=true` returns."
    )
    severity = serializers.ChoiceField(
        choices=Flag.SEVERITY,
        help_text=(
            "How hard this flag argues for attention. **Graded per "
            "detector, not from `risk_score`** — the two answer different "
            "questions, and a student can carry a critical flag on one "
            "chapter while scoring low overall risk.\n\n"
            "Each detector states its own cut-offs in the units it "
            "measures, so they are comparable within a type and only "
            "roughly comparable across types. The shape is consistent:\n"
            "- `critical` — act this week. e.g. `subject_imbalance` at "
            ">= 50 marks *and* >= 10% of the paper at stake; "
            "`plateau` at a 30-point gap; `disengagement` at 14 silent days.\n"
            "- `high` — act this cycle. The same measures at roughly "
            "two-thirds of the critical cut-off (30 marks / 6%, 24 points, "
            "7 silent days).\n"
            "- `watch` — the rule fired but below those bars. Evidence, "
            "not an instruction.\n"
            "- `improving` — the condition is resolving on its own. "
            "Deliberately not silence: a mentor should see that what they "
            "did worked.\n\n"
            "`evidence` carries whatever that detector measured, and "
            "`rule_version` is what lets the grading be re-derived after "
            "the thresholds change."
        ),
    )
    type = serializers.CharField(
        max_length=40,
        help_text=(
            "Detector identifier — `weak_topic`, `over_attempting`, "
            "`plateau`, `subject_imbalance`, `confidence_mismatch`, "
            "`revision_overdue`, `disengagement`, `overload`, "
            "`mock_decline`. Open-ended on purpose: detectors are added "
            "without a migration, so a client must render an unknown type "
            "rather than assume a closed set."
        )
    )
    evidence = serializers.JSONField(
        # `required=False` mirrors what ModelSerializer derived from the
        # model default and keeps the generated client's optionality
        # unchanged; this adds documentation, not a breaking change.
        required=False,
        help_text=(
            "What this detector measured, in its own keys. Shape varies by "
            "`type` — it is what answers 'why was this flagged?' six "
            "months later, read together with `rule_version`."
        )
    )

    class Meta:
        model = Flag
        fields = [
            "id", "student_id", "student_name", "batch_name", "mentor_name",
            "topic_name", "type", "severity", "headline", "evidence",
            "rule_version", "raised_at", "resolved_at", "outcome", "is_open",
        ]


class DiagnosisHypothesisSerializer(serializers.Serializer):
    misconception_code = serializers.CharField()
    claim = serializers.CharField()
    confidence = serializers.ChoiceField(choices=["high", "medium", "low"])
    evidence_questions = serializers.ListField(child=serializers.CharField())
    counter_evidence = serializers.CharField(allow_blank=True)
    marks_at_stake = serializers.IntegerField()


class DiagnosisSerializer(serializers.Serializer):
    """The output of `diagnose_misconception` — the product's core claim.

    `pattern_found=False` is a real and useful answer. Scattered carelessness
    is a different problem from a systematic misconception and needs a
    different response, so the model is allowed to say so rather than being
    pushed into inventing a pattern.
    """

    headline = serializers.CharField()
    pattern_found = serializers.BooleanField()
    hypotheses = DiagnosisHypothesisSerializer(many=True)
    recommended_action = serializers.CharField()
    time_to_fix = serializers.CharField()

    trace_id = serializers.IntegerField(
        help_text="Feed back agreement/disagreement against this id."
    )
    from_cache = serializers.BooleanField(
        help_text="True if replayed rather than freshly generated."
    )
    human_verdict = serializers.CharField()


class DiagnosisVerdictSerializer(serializers.Serializer):
    """A mentor agreeing or disagreeing. This is what creates training data.

    Raw model output is a guess. The same output with a teacher's verdict
    attached is a labelled example — and a corpus of those is the thing a
    competitor cannot obtain by buying an API key.
    """

    verdict = serializers.ChoiceField(choices=["agreed", "disagreed"])
    note = serializers.CharField(required=False, allow_blank=True)


class FlagResolveSerializer(serializers.Serializer):
    """Closing a flag. `outcome` is required, on purpose.

    Every resolved flag is a labelled training example for the eventual
    risk model — "given this student's state in month 3, did they recover?"
    Defaulting the field would fill that dataset with polite blanks, so the
    mentor has to say which way it went. `declined` is a perfectly good
    answer and more useful than silence.
    """

    outcome = serializers.ChoiceField(
        choices=[Flag.RECOVERED, Flag.DECLINED, Flag.UNKNOWN],
        help_text="What actually became of the student. Required.",
    )
    note = serializers.CharField(
        required=False, allow_blank=True,
        help_text="Optional. If given, also logged as an Intervention.",
    )


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
    """One row of the mistake taxonomy, chart-ready.

    Five rows now, always, in this order. `insufficient_evidence` was
    added in v0.3 and appended rather than inserted, so a client reading
    `causes[i]` positionally keeps reading the same cause it did before.
    """

    cause = serializers.ChoiceField(
        choices=[
            "conceptual_gap",
            "execution_error",
            "time_exhaustion",
            "avoidable_skip",
            "insufficient_evidence",
        ],
        help_text=(
            "`insufficient_evidence` is **not a diagnosis** — it is the "
            "marks lost on chapters whose mastery sits below the "
            "four-attempt evidence floor, so no cause can be claimed. "
            "Render it in a neutral colour, never in the conceptual-gap "
            "red: it previously *was* counted as conceptual gap, which "
            "was the defect this bucket exists to fix."
        ),
    )
    marks = serializers.IntegerField()
    questions = serializers.IntegerField()
    share_pct = serializers.FloatField(
        help_text="Share of `total_lost`. The five rows sum to 100%."
    )


class LossTopicSerializer(serializers.Serializer):
    """Where the marks actually went, by chapter."""

    topic_id = serializers.IntegerField(allow_null=True)
    topic = serializers.CharField()
    subject = serializers.CharField()
    marks_lost = serializers.FloatField()
    questions = serializers.IntegerField()


class MarksLostSerializer(serializers.Serializer):
    """Mistake taxonomy for one paper — the line that sells the product.

    **BREAKING, v0.3.** A fifth cause, `insufficient_evidence`, and two
    new fields, `attributed_lost` and `recoverable_pct`. `conceptual_gap`
    keeps its name and its type but its *value falls* — by a third across
    the seeded cohort — because it no longer absorbs marks lost on
    chapters whose mastery was never measured.

    The old shape had four buckets partitioning `total_lost`, with
    `recoverable` defined as `total_lost - conceptual_gap`. Every chapter
    held below the four-attempt evidence floor arrived with a null
    mastery, failed the "do they know it" test for the same reason a
    chapter they are genuinely bad at fails it, and was booked as a
    demonstrated conceptual gap. A refusal to claim became a claim.

    A client rendering the taxonomy must give the new bucket its own
    neutral segment. Folding it back into `conceptual_gap` to keep the
    old four-bar chart reinstates the defect in the presentation layer.
    """

    paper_id = serializers.IntegerField()
    paper_name = serializers.CharField()
    held_on = serializers.DateField()
    max_marks = serializers.IntegerField()
    questions = serializers.IntegerField()
    attempted = serializers.IntegerField()
    score = serializers.FloatField()

    conceptual_gap = serializers.IntegerField(
        help_text=(
            "Marks lost where mastery was **measured and low**, plus "
            "wrong answers on chapters they know that took more than "
            "twice their own median time. Evidenced failures only."
        )
    )
    execution_error = serializers.IntegerField()
    time_exhaustion = serializers.IntegerField()
    avoidable_skip = serializers.IntegerField()
    insufficient_evidence = serializers.IntegerField(
        help_text=(
            "Marks lost on chapters below the four-attempt evidence "
            "floor, where `TopicState.mastery` is null. **Not a cause.** "
            "The action it implies is 'practise this chapter so we can "
            "tell you', not 'relearn it'."
        )
    )
    total_lost = serializers.IntegerField(
        help_text=(
            "`max_marks - score`. The five cause buckets sum to exactly "
            "this."
        )
    )
    attributed_lost = serializers.IntegerField(
        help_text=(
            "`total_lost - insufficient_evidence` — the marks the "
            "analysis is entitled to explain, and the denominator of "
            "`recoverable_pct`."
        )
    )
    recoverable = serializers.IntegerField(
        help_text=(
            "Marks lost to causes that need no new learning: "
            "`execution_error + time_exhaustion + avoidable_skip`. "
            "**No longer `total_lost - conceptual_gap`** — that identity "
            "held only while four buckets partitioned the loss, and "
            "counting unmeasured chapters as recoverable would be the "
            "same unsupported claim the fifth bucket exists to stop, "
            "pointed the other way."
        )
    )
    recoverable_pct = serializers.FloatField(
        allow_null=True,
        help_text=(
            "`recoverable / attributed_lost * 100` — the headline share. "
            "Over attributed marks, not total: a percentage diluted by "
            "marks nobody can explain is not the claim being made. Null "
            "when `attributed_lost` is 0, which is an honest 'cannot "
            "say' and must not render as 0%."
        ),
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

    batch_id = serializers.IntegerField(
        allow_null=True,
        help_text=(
            "The batch every KPI below is scoped to, echoed back from "
            "`?batch=`. Null means the whole institute. It is echoed rather "
            "than assumed so a console can tell 'the server honoured my "
            "filter' from 'the server ignored it' — which is exactly the "
            "state this endpoint was in before `?batch=` existed."
        ),
    )
    batch_name = serializers.CharField(
        allow_null=True, help_text="Display name for `batch_id`. Null when unscoped."
    )

    total_students = serializers.IntegerField()
    active_students = serializers.IntegerField()
    flagged_this_week = serializers.IntegerField()
    critical_flags = serializers.IntegerField()

    batch_mock_avg = serializers.FloatField(
        allow_null=True,
        help_text=(
            "Mean total marks per student on the most recent paper — out of "
            "`latest_paper_max_marks`, over `latest_paper_students` sitters. "
            "Null when nobody in scope sat it, which is the honest answer "
            "rather than 0."
        ),
    )
    latest_paper_id = serializers.IntegerField(
        allow_null=True,
        help_text=(
            "The institute's most recent paper by `held_on`. Stays "
            "institute-wide even under `?batch=`: the batch narrows who is "
            "counted, not which paper is reported."
        ),
    )
    latest_paper_name = serializers.CharField(allow_null=True)
    latest_paper_held_on = serializers.DateField(allow_null=True)
    latest_paper_max_marks = serializers.IntegerField(
        allow_null=True, help_text="The denominator for `batch_mock_avg`."
    )
    latest_paper_students = serializers.IntegerField(
        help_text=(
            "How many students in scope sat the paper `batch_mock_avg` is "
            "computed over. 0 with a non-null `latest_paper_id` means this "
            "batch did not sit the institute's latest mock."
        )
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
