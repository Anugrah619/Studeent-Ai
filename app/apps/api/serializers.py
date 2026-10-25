"""Serializers. These ARE the OpenAPI contract.

drf-spectacular reads these to generate `openapi.yaml`, which is the
source of truth every agent works against. Changing a field here changes
the contract — regenerate the schema and tell the frontend.
"""

import datetime as dt

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.derived.models import Flag, Intervention, PlanBlock, StudentState, TopicState
from apps.events.models import Attempt, ConfidenceRating, RevisionEvent, StudyLog
from apps.ingestion.models import (
    ColumnMappingProfile,
    IngestBatch,
    Misconception,
    QuestionOption,
    QuestionTopicMap,
    TestPaper,
)
from apps.ingestion.services.results import MAPPABLE_FIELDS
from apps.reasoning.services.diagnose import MARKS_PER_WRONG
from apps.syllabus.models import Exam, Topic
from apps.syllabus.services import chapters_for_student
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


LOGIN_STATUSES = ["none", "awaiting_first_sign_in", "active"]


class LoginStatusMixin(serializers.Serializer):
    """Whether a student can sign in yet — so staff know which button to show.

    `none` has no login (offer to issue one); `awaiting_first_sign_in` has
    one but has not yet replaced the temporary password (the credentials slip
    is still live); `active` has chosen their own. Only the state is exposed:
    nothing here can be used to sign in.
    """

    login_status = serializers.SerializerMethodField()

    @extend_schema_field(serializers.ChoiceField(choices=LOGIN_STATUSES))
    def get_login_status(self, obj) -> str:
        if obj.user_id is None:
            return "none"
        return "awaiting_first_sign_in" if obj.user.must_change_password else "active"


class StudentListSerializer(LoginStatusMixin, serializers.ModelSerializer):
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
            "login_status",
        ]


class StudentDetailSerializer(LoginStatusMixin, serializers.ModelSerializer):
    batch = BatchSerializer(read_only=True)
    mentor = MentorSerializer(read_only=True)
    state = StudentStateSerializer(read_only=True)
    # What the student said at onboarding (`/api/my/onboarding/`). Read-only
    # here: they are the student's answers, not the institute's to edit.
    daily_minutes = serializers.IntegerField(
        read_only=True, allow_null=True,
        help_text=(
            "Minutes a day the student says they can study (45–720). Null "
            "until they onboard. The day planner uses it first."
        ),
    )
    target_rank = serializers.IntegerField(
        read_only=True, allow_null=True,
        help_text="The rank the student says they are aiming for. Null until they say.",
    )
    onboarded_at = serializers.DateTimeField(
        read_only=True, allow_null=True,
        help_text="When the student first completed onboarding. Null: not yet.",
    )

    class Meta:
        model = Student
        fields = [
            "id", "name", "roll_no", "target", "joined_at", "exited_at",
            "batch", "mentor", "state", "login_status",
            "daily_minutes", "target_rank", "onboarded_at",
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
        help_text=(
            "Forecast probability, 0–1, that the student would recall this "
            "chapter today — an exponential forgetting curve, "
            "`exp(-t / S)`. `t` is days since the later of `last_seen` (newest "
            "attempt) and `last_revised` (newest completed revision). `S`, the "
            "stability in days, is `10 × 2.5^(completed revision cycles, at "
            "most 3) × (0.5 + mastery)`, with a null mastery counted as 0.5: "
            "so a chapter met once at middling mastery falls to 50% in about "
            "a week, and each completed revision cycle makes it fade 2.5× "
            "slower. **Null when the chapter was never seen** (no attempt and "
            "no completed revision; a study log alone does not count). "
            "Computed as of the last recompute — nightly, and after the "
            "student's own events — so it is a forecast for that moment, not "
            "a live clock. Below 0.5 is what `?forgetting=true` returns and "
            "what the planner treats as worth a revise block. The constants "
            "are stated priors, not fitted values."
        ),
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


class DiagnosisEvidenceSerializer(serializers.Serializer):
    """One cited question, resolved so the console can actually open it.

    `evidence_questions` carries bare labels like `"D16"`, and a label is
    unique only *within one paper* — there is no URL a client can build
    from it. That is why this exists: the server resolves every citation
    against the student's own attempts and hands back the id that
    `GET /api/questions/{id}/` answers on.
    """

    question_id = serializers.IntegerField(
        allow_null=True,
        help_text=(
            "`QuestionTopicMap.id` — pass it straight to "
            "`GET /api/questions/{id}/?student={student_id}` to get the "
            "stem, the options, which one is correct, which one this "
            "student chose and what that choice indicates. It is the same "
            "value as `QuestionDetail.id` on that endpoint.\n\n"
            "**Null means the citation did not resolve**: the model named a "
            "question that is not a wrong answer this student gave on this "
            "paper, or the paper carries no mapped question by that label. "
            "Render those as plain text, never as a link to nowhere — a "
            "chip that opens an empty panel is worse than a chip that "
            "visibly is not one."
        ),
    )
    label = serializers.CharField(
        help_text=(
            "The question as the paper prints it — `\"D16\"`. What the chip "
            "shows, and the same string as `QuestionDetail.label`."
        )
    )
    chose = serializers.CharField(
        allow_blank=True,
        help_text=(
            "The option letter this student actually picked, e.g. `\"C\"`. "
            "Blank when the citation did not resolve."
        ),
    )
    marks_at_stake = serializers.IntegerField(
        help_text=(
            f"What this one question cost: {MARKS_PER_WRONG} — the 4 marks "
            "forgone plus the 1-mark penalty. 0 when the citation did not "
            "resolve, because no marks can be claimed for a question we "
            "cannot tie to an answer."
        )
    )


class DiagnosisHypothesisSerializer(serializers.Serializer):
    """One candidate explanation, with the questions it rests on."""

    misconception_code = serializers.CharField()
    claim = serializers.CharField()
    confidence = serializers.ChoiceField(choices=["high", "medium", "low"])
    evidence_questions = serializers.ListField(
        child=serializers.CharField(),
        help_text=(
            "The labels the model cited, verbatim. **Display only.** It is "
            "kept because it is what the model wrote, but it cannot be "
            "linked from — use `evidence` instead, which is the same list "
            "with each label resolved to a routable id."
        ),
    )
    evidence = DiagnosisEvidenceSerializer(
        many=True,
        help_text=(
            "`evidence_questions`, resolved. One entry per cited label, in "
            "the order the model gave them."
        ),
    )
    counter_evidence_questions = DiagnosisEvidenceSerializer(
        many=True,
        help_text=(
            "The questions `counter_evidence` names, resolved — the correct "
            "answers the argument leans on, now linkable. Until this existed "
            "the strongest line on the card was the one line that could not "
            "open the question behind it.\n\n"
            "Found by matching whole labels in the sentence against the "
            "counter-evidence candidates **the server derived** for this "
            "misconception, so a label the model invented is never offered. "
            "`marks_at_stake` is 0 on every entry: these are questions the "
            "student got right. Empty when the sentence names none."
        ),
    )
    counter_evidence = serializers.CharField(
        help_text=(
            "The correct answers that narrow this finding — the strongest "
            "thing on the card, because it is what separates 'weak at this "
            "chapter' from 'fails only when the condition is implicit'.\n\n"
            "**Never blank and never null.** The prompt already tells the "
            "model to say plainly that there is no counter-evidence on this "
            "paper when there is none; the server now guarantees it. If the "
            "model returns nothing, one of two sentences is substituted — "
            "'no counter-evidence on this paper, the weakness may be "
            "chapter-wide' when none was available to it, or 'the model did "
            "not state the counter-evidence, treat this finding as "
            "un-narrowed' when some was. The second is deliberately not "
            "disguised as the first: they are different claims and only one "
            "of them is good news."
        )
    )
    marks_at_stake = serializers.IntegerField(
        help_text=(
            f"`{MARKS_PER_WRONG} x` the number of citations in `evidence` "
            "that resolved. **Counted server-side, not taken from the "
            "model** — the model is asked for judgement, not arithmetic, "
            "and this is the arithmetic. Sum `evidence[].marks_at_stake` to "
            "check it.\n\n"
            "Only the model's own figure survives if *no* citation "
            "resolved, in which case there is nothing better to offer and "
            "`evidence` will show why."
        )
    )


class DiagnosisTallyRowSerializer(serializers.Serializer):
    misconception_code = serializers.CharField()
    wrong_answers = serializers.IntegerField(
        help_text="Wrong answers whose chosen option is tagged with this misconception."
    )
    marks = serializers.IntegerField(help_text="What those cost, at the diagnosis's per-wrong rate.")


class DiagnosisTallySerializer(serializers.Serializer):
    """The counting done in code before the model was asked anything.

    Step two of the pipeline is "we count, exactly": tagged wrong options are
    tallied deterministically and the model reasons over the result. This is
    that tally for **every** wrong answer on the paper, not just the ones the
    diagnosis cites, so a reader can hold the model's story against the
    arithmetic it was given.
    """

    answered = serializers.IntegerField(help_text="Questions with a recorded choice.")
    wrong = serializers.IntegerField()
    wrong_with_known_cause = serializers.IntegerField(
        help_text=(
            "Wrong answers whose chosen option carries a misconception tag. "
            "The rest are wrong for a reason the taxonomy has not described — "
            "real losses, and nothing a diagnosis can say about."
        )
    )
    by_misconception = DiagnosisTallyRowSerializer(
        many=True, help_text="Largest cost first."
    )


class DiagnosisSerializer(serializers.Serializer):
    """The output of `diagnose_misconception` — the product's core claim.

    `pattern_found=False` is a real and useful answer. Scattered carelessness
    is a different problem from a systematic misconception and needs a
    different response, so the model is allowed to say so rather than being
    pushed into inventing a pattern.
    """

    paper_id = serializers.IntegerField(
        allow_null=True,
        help_text=(
            "The paper this diagnosis is about, echoed back from `?paper=` "
            "so the payload says what it is about instead of the client "
            "having to remember what it asked for — which is also what "
            "makes it safe to cache under its own key.\n\n"
            "Null means the diagnosis spans **every paper this student has "
            "sat**, which is what omitting `?paper=` asks for. Null is not "
            "'unknown'."
        ),
    )
    paper_name = serializers.CharField(
        allow_null=True,
        help_text="Display name for `paper_id`. Null when the diagnosis spans all papers.",
    )

    headline = serializers.CharField()
    pattern_found = serializers.BooleanField()
    hypotheses = DiagnosisHypothesisSerializer(many=True)
    total_marks_at_stake = serializers.IntegerField(
        help_text=(
            "Marks the whole diagnosis accounts for, computed server-side "
            "as `MARKS_PER_WRONG x` the number of **distinct** questions "
            "cited across all hypotheses.\n\n"
            "**Hypotheses cannot overlap, so this is a clean total.** A "
            "student picks one option per question, and one option carries "
            "at most one misconception, so a wrong answer is evidence for "
            "exactly one finding. (Six of the forty tagged questions do "
            "*offer* two different misconceptions across their distractors "
            "— but only the one the student actually chose can fire.) The "
            "de-duplication above therefore guards against the model citing "
            "the same question twice rather than against real overlap, and "
            "on every trace recorded so far it has removed nothing.\n\n"
            "**It will still differ from the number in `headline`, and that "
            "is not a contradiction.** The headline quotes the cost of the "
            "*leading* hypothesis; this is the cost of all of them. A card "
            "showing both should label this one as the total across "
            "findings.\n\n"
            "It is also generally **less** than the marks the paper lost in "
            "total: wrong answers on untagged distractors, skips and "
            "unreached questions are all real losses that a misconception "
            "diagnosis has nothing to say about. For the full partition of "
            "a paper's lost marks use `/api/students/{id}/marks-lost/`."
        )
    )
    recommended_action = serializers.CharField()
    time_to_fix = serializers.ChoiceField(
        choices=["minutes", "one_session", "several_sessions", "term_long"],
        help_text=(
            "How much teaching time this costs, as one of four bands. "
            "Bounded rather than free text because the model, asked for "
            "minutes, returned 40 / 20 / 45 for the same student and the "
            "same evidence while its recommended action stayed stable — "
            "false precision on a genuinely fuzzy judgement. "
            "minutes = a correction at the board · one_session = one focused "
            "sitting · several_sessions = a few sittings over a week or two · "
            "term_long = a foundational gap needing sustained work. "
            "The client supplies the display label."
        ),
    )

    student_ref = serializers.CharField(
        allow_blank=True,
        help_text=(
            "The pseudonym the model was sent in place of the student's name "
            "(`S-{id}`). Echoed so the privacy claim can be read off the "
            "response — this is the only identity the model ever saw — "
            "instead of restated by the client."
        ),
    )
    tally = DiagnosisTallySerializer()

    trace_id = serializers.IntegerField(
        help_text="Feed back agreement/disagreement against this id."
    )
    from_cache = serializers.BooleanField(
        help_text="True if replayed rather than freshly generated."
    )
    human_verdict = serializers.ChoiceField(
        choices=["agreed", "disagreed", "unreviewed"],
        help_text=(
            "What a mentor has said about this diagnosis. **`unreviewed` is a "
            "value, not an absence**: nobody has answered yet, which is not "
            "the same as having disagreed. A client that treats any "
            "non-`agreed` string as a disagreement tells a teacher who never "
            "answered that they did."
        ),
    )


class DiagnosisVerdictSerializer(serializers.Serializer):
    """A mentor agreeing or disagreeing. This is what creates training data.

    Raw model output is a guess. The same output with a teacher's verdict
    attached is a labelled example — and a corpus of those is the thing a
    competitor cannot obtain by buying an API key.
    """

    verdict = serializers.ChoiceField(choices=["agreed", "disagreed"])
    note = serializers.CharField(required=False, allow_blank=True)


class MisconceptionSerializer(serializers.ModelSerializer):
    """What a particular wrong answer means — the taxonomy, not the score.

    Global rather than tenant-scoped: physics misconceptions are the same
    in Kota and Jaipur. Institutes share the vocabulary; only their data
    is separated.
    """

    class Meta:
        model = Misconception
        fields = ["code", "subject", "name", "description", "remedy"]


class QuestionOptionSerializer(serializers.ModelSerializer):
    """One lettered option, and what choosing it would reveal.

    `misconception` is populated on wrong options that have been
    explained, which is the whole reason this endpoint is worth opening:
    it answers *why the wrong option was tempting*, not just that it was
    wrong. A wrong option with a null misconception is a gap in the
    taxonomy rather than a bug — it simply cannot contribute to a
    diagnosis.
    """

    misconception = MisconceptionSerializer(
        read_only=True, allow_null=True,
        help_text=(
            "The wrong belief that produces this option. Always null on the "
            "correct option, and null on wrong options nobody has explained "
            "yet."
        ),
    )
    chosen = serializers.BooleanField(
        read_only=True, allow_null=True, default=None,
        help_text=(
            "Whether the student named by `?student=` picked this option. "
            "**Null on every option when `?student=` was not given** — null "
            "is 'not asked', which is a different thing from `false`, and a "
            "client that renders null as 'not chosen' will show a question "
            "where the student appears to have answered nothing."
        ),
    )

    class Meta:
        model = QuestionOption
        fields = ["label", "text", "is_correct", "chosen", "misconception"]


class QuestionDetailSerializer(serializers.ModelSerializer):
    """One question, in full — what a director sees on clicking an evidence chip.

    This is the endpoint that closes the loop the diagnosis card opens.
    A finding cites `D16`; clicking it has to show the actual question,
    the option the student reached for, and what reaching for it means.
    Without that the evidence is an assertion the reader has no way to
    check, and checkability is the entire argument for tagging distractors.

    With `?student=`, three fields at the bottom and `options[].chosen`
    describe what that one student did here. Without it the question comes
    back on its own, which is what a client wants when it is showing the
    paper rather than a person.
    """

    label = serializers.CharField(
        source="question_id", read_only=True,
        help_text=(
            "The question as the paper prints it — `\"D16\"`. Unique within "
            "a paper, **not** across papers, which is why `id` and not this "
            "is what `DiagnosisEvidence.question_id` carries. Stored as "
            "`QuestionTopicMap.question_id`."
        ),
    )
    paper_id = serializers.IntegerField(source="test_paper_id", read_only=True)
    paper_name = serializers.CharField(source="test_paper.name", read_only=True)
    topic = serializers.CharField(
        source="topic.name", read_only=True, default=None, allow_null=True,
        help_text="Chapter. Null on a question nobody has mapped yet.",
    )
    subject = serializers.SerializerMethodField()
    options = QuestionOptionSerializer(many=True, read_only=True)

    student_id = serializers.IntegerField(
        read_only=True, default=None, allow_null=True,
        help_text="Echo of `?student=`. Null when the question was fetched on its own.",
    )
    chosen_label = serializers.CharField(
        read_only=True, default=None, allow_null=True,
        help_text=(
            "The option letter this student picked. Null when `?student=` "
            "was not given, and also when it was but the student left this "
            "question blank or never reached it — `status` distinguishes "
            "those."
        ),
    )
    status = serializers.ChoiceField(
        choices=Attempt.STATUS,
        read_only=True, default=None, allow_null=True,
        help_text=(
            "What became of this question for this student. A closed set, "
            "because `blank` and `not_reached` are the distinction the "
            "whole marks-lost taxonomy rests on — choosing to skip and "
            "running out of time need opposite advice. Null when "
            "`?student=` was not given, or when this student has no attempt "
            "recorded here."
        ),
    )
    marks = serializers.FloatField(
        read_only=True, default=None, allow_null=True,
        help_text="Marks scored on this question after negative marking. Null as above.",
    )
    time_spent = serializers.IntegerField(
        read_only=True, default=None, allow_null=True,
        help_text="Seconds spent. Often genuinely absent even when the attempt exists.",
    )

    class Meta:
        model = QuestionTopicMap
        fields = [
            "id", "label", "paper_id", "paper_name", "topic", "subject",
            "difficulty", "question_text", "solution", "options",
            "student_id", "chosen_label", "status", "marks", "time_spent",
            "source", "source_ref",
        ]

    @staticmethod
    def get_subject(obj) -> str | None:
        node = obj.topic
        if node is None:
            return None
        while node.parent_id is not None:
            node = node.parent
        return node.name


class MyQuestionOptionSerializer(serializers.ModelSerializer):
    """An option as the student who answered it sees it: no misconception.

    `QuestionOptionSerializer` explains *why a wrong option was tempting* —
    "reverses the directing-effect rule". That is the diagnosis, written for
    the mentor who decides how to say it. A student reviewing a mistake gets
    the question, the answer and the worked solution; whether they are also
    told which belief the system thinks they hold is the product decision
    recorded in `MyProgressSerializer`, and is held back for the same reason.
    """

    chosen = serializers.BooleanField(read_only=True)

    class Meta:
        model = QuestionOption
        fields = ["label", "text", "is_correct", "chosen"]


class MyQuestionSerializer(QuestionDetailSerializer):
    """A question I answered, with the correct answer and the working."""

    options = MyQuestionOptionSerializer(many=True, read_only=True)

    class Meta(QuestionDetailSerializer.Meta):
        fields = [f for f in QuestionDetailSerializer.Meta.fields if f != "student_id"]


class MyAttemptSerializer(serializers.ModelSerializer):
    """One answer of mine. `question_pk` opens the question behind it."""

    paper_id = serializers.IntegerField(source="test_paper_id", read_only=True, allow_null=True)
    paper_name = serializers.CharField(source="test_paper.name", read_only=True, default=None)
    topic_name = serializers.CharField(source="topic.name", read_only=True)
    question_pk = serializers.IntegerField(
        read_only=True, allow_null=True,
        help_text=(
            "Id for `GET /api/my/questions/{id}/`. Null when the paper has no "
            "question content on file (an imported mock with scores only) — "
            "there is then nothing to open."
        ),
    )

    class Meta:
        model = Attempt
        fields = [
            "id", "paper_id", "paper_name", "question_id", "question_pk",
            "topic_name", "status", "chosen_option", "marks", "time_spent",
            "source", "ts",
        ]


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
    """Time share vs marks-lost share — the neglect chart.

    **One row per subject of the student's syllabus, in syllabus order** —
    not a fixed three. JEE comes back as Physics, Chemistry, Maths exactly as
    before; NEET as Physics, Chemistry, Botany, Zoology. A subject with no
    data is a row of zeroes (and a null `accuracy_pct`), never omitted, so
    the bars do not renumber between students of one batch. A subject the
    student has history in that their current syllabus lacks is appended
    after, alphabetically. Render the rows in the order given.
    """

    subject = serializers.CharField(
        help_text="The subject's name as the syllabus tree spells it."
    )
    time_share_pct = serializers.FloatField()
    marks_lost_share_pct = serializers.FloatField()
    accuracy_pct = serializers.FloatField(allow_null=True)


class MockScoreSubjectSerializer(serializers.Serializer):
    subject = serializers.CharField(
        help_text="The subject's name as the syllabus tree spells it."
    )
    marks = serializers.FloatField(
        help_text="Marks scored in this subject on this paper, after negative marking."
    )


class MockScoreSerializer(serializers.Serializer):
    """One paper's marks, split by subject.

    `subjects` is **additive** and is the field to read: one entry per
    subject of the student's syllabus, in syllabus order, present on every
    row (0 when the paper had none of that subject). `physics`, `chemistry`
    and `maths` are kept unchanged for clients written before it, and are 0
    for an exam without that subject — a NEET row has `maths: 0` and its
    Biology only in `subjects`.
    """

    paper_id = serializers.IntegerField()
    paper_name = serializers.CharField()
    held_on = serializers.DateField()
    physics = serializers.FloatField(
        help_text="Legacy. The Physics entry of `subjects`, or 0."
    )
    chemistry = serializers.FloatField(
        help_text="Legacy. The Chemistry entry of `subjects`, or 0."
    )
    maths = serializers.FloatField(
        help_text="Legacy. The Maths (or Mathematics) entry of `subjects`, or 0 — always 0 for NEET."
    )
    total = serializers.FloatField(
        help_text="The sum of `subjects[].marks` — every subject, not only the legacy three."
    )
    subjects = MockScoreSubjectSerializer(
        many=True,
        help_text=(
            "Additive. One entry per subject of the student's syllabus, in "
            "syllabus order, on every row; a subject the student has marks "
            "in that their current syllabus lacks is appended after."
        ),
    )


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
    source = serializers.ChoiceField(
        choices=TestPaper._meta.get_field("source").choices,
        read_only=True,
        help_text=(
            "Where the paper came from: an official past paper, the institute's "
            "own mock, one we wrote for the demo, or generated. The product must "
            "always be able to say this out loud."
        ),
    )

    class Meta:
        model = TestPaper
        fields = [
            "id", "name", "held_on", "total_questions", "max_marks", "duration_min",
            "source",
        ]


class TestPaperCreateSerializer(serializers.ModelSerializer):
    """The institute's own mock, before its blueprint and results.

    `exam` is the exam's code (`JEE_MAIN`, `NEET_UG`), the same string the
    batches payload calls `exam_code`. Marking defaults to the exam's own
    scheme, so a plain JEE Main mock needs no marking fields at all.
    """

    exam = serializers.SlugRelatedField(slug_field="code", queryset=Exam.objects.all())

    class Meta:
        model = TestPaper
        fields = [
            "name", "exam", "held_on", "total_questions", "max_marks",
            "marks_correct", "marks_wrong", "duration_min", "shift_or_booklet",
        ]
        extra_kwargs = {
            "total_questions": {"min_value": 1, "max_value": 300, "required": False},
            "max_marks": {"min_value": 1, "required": False},
            "marks_correct": {"min_value": 1, "required": False},
            "marks_wrong": {"max_value": 0, "required": False},
            "duration_min": {"min_value": 1, "max_value": 600, "required": False},
        }

    def validate(self, attrs):
        exam = attrs["exam"]
        attrs.setdefault("marks_correct", exam.marks_correct)
        attrs.setdefault("marks_wrong", exam.marks_wrong)
        attrs.setdefault("max_marks", exam.total_marks)
        institute_id = self.context["institute_id"]
        if TestPaper.objects.filter(
            institute_id=institute_id, name__iexact=attrs["name"].strip(), held_on=attrs["held_on"]
        ).exists():
            raise serializers.ValidationError(
                {"name": "A paper with that name and date already exists."}
            )
        return attrs


class BlueprintUploadSerializer(serializers.Serializer):
    file = serializers.FileField(
        help_text=(
            "CSV or Excel `.xlsx` (first sheet): question_id, chapter, correct_option "
            "(or answer for a numeric question). Legacy `.xls` is refused with how to re-save it."
        )
    )
    dry_run = serializers.BooleanField(
        required=False, default=False,
        help_text="Check the file and report what would happen without saving anything.",
    )


class ResultsUploadSerializer(serializers.Serializer):
    file = serializers.FileField(
        help_text=(
            "CSV or Excel `.xlsx` (first sheet). Either one row per student with a "
            "column per question (`roll_no, Q1, Q2, …`), or one row per answer "
            "(`roll_no, question_id, answer`). Legacy `.xls` is refused with how to re-save it."
        )
    )
    paper = serializers.IntegerField(help_text="The `TestPaper.id` the file is the results of.")
    dry_run = serializers.BooleanField(
        required=False, default=False,
        help_text="Check the file and report what would happen without saving anything.",
    )
    mapping_profile = serializers.IntegerField(
        required=False, help_text="A saved column mapping (`/api/ingest/mappings/`) to apply."
    )
    column_map = serializers.CharField(
        required=False, allow_blank=True,
        help_text=(
            "JSON object renaming this file's columns, e.g. "
            '`{"Candidate No": "roll_no", "Seat": "ignore"}`. Fields: '
            + ", ".join(sorted(MAPPABLE_FIELDS)) + ". Wins over a saved profile."
        ),
    )
    save_mapping_as = serializers.CharField(
        required=False, allow_blank=True, max_length=100,
        help_text="With `column_map`: save it under this name for the next upload.",
    )


class IngestRowErrorSerializer(serializers.Serializer):
    row = serializers.IntegerField(help_text="Line in the file, counting the header as line 1.")
    roll_no = serializers.CharField(allow_blank=True, required=False)
    question_id = serializers.CharField(allow_blank=True, required=False)
    message = serializers.CharField(help_text="A sentence for the person who sent the file.")


class BlueprintReportSerializer(serializers.Serializer):
    dry_run = serializers.BooleanField()
    ok = serializers.BooleanField(help_text="No errors; a real run would apply this file.")
    paper_id = serializers.IntegerField()
    questions_in_file = serializers.IntegerField()
    expected_questions = serializers.IntegerField(
        help_text="`total_questions` on the paper. Fewer in the file is a warning, not an error."
    )
    created = serializers.IntegerField()
    updated = serializers.IntegerField()
    unchanged = serializers.IntegerField()
    errors_total = serializers.IntegerField()
    errors = IngestRowErrorSerializer(many=True, help_text="At most the first 100.")


class ResultsReportSerializer(serializers.Serializer):
    """What happened to a results file — every student accounted for.

    A student is ingested completely or not at all, so
    `students_ingested + students_already_recorded + students_failed` is
    `students_in_file`, with nobody half-counted.
    """

    dry_run = serializers.BooleanField()
    ok = serializers.BooleanField(help_text="A real run would write something (or has nothing left to).")
    paper_id = serializers.IntegerField()
    layout = serializers.CharField(help_text="`wide` (a column per question) or `long` (a row per answer).")
    batch_id = serializers.IntegerField(allow_null=True)
    students_in_file = serializers.IntegerField()
    students_ingested = serializers.IntegerField()
    students_already_recorded = serializers.IntegerField(
        help_text="Every answer in their row was already on file. Counted, not doubled."
    )
    students_failed = serializers.IntegerField()
    attempts_created = serializers.IntegerField()
    attempts_already_recorded = serializers.IntegerField()
    unmapped_questions = serializers.ListField(
        child=serializers.CharField(),
        help_text="Questions in the file the paper's blueprint does not know. Non-empty means nothing was written.",
    )
    unkeyed_questions = serializers.ListField(
        child=serializers.CharField(),
        help_text="Questions with no answer key. Non-empty means nothing was written.",
    )
    ignored_columns = serializers.ListField(child=serializers.CharField())
    questions_not_in_file = serializers.ListField(
        child=serializers.CharField(),
        help_text="Paper questions the file does not cover. A warning: a partial sitting is real.",
    )
    duplicate_of_batch = serializers.IntegerField(
        allow_null=True,
        help_text="On a dry run: this exact file was already imported as this batch.",
    )
    derived_refreshed = serializers.BooleanField(
        help_text="Counts were recomputed for the students this file touched."
    )
    flags_raised = serializers.IntegerField(
        allow_null=True, help_text="Flags the detectors raised for those students afterwards."
    )
    errors_total = serializers.IntegerField()
    errors = IngestRowErrorSerializer(many=True, help_text="At most the first 100.")


class IngestBatchSerializer(serializers.ModelSerializer):
    paper_id = serializers.IntegerField(source="test_paper_id", read_only=True, allow_null=True)
    paper_name = serializers.CharField(source="test_paper.name", read_only=True, default=None)

    class Meta:
        model = IngestBatch
        fields = [
            "id", "filename", "paper_id", "paper_name", "row_count", "rows_ok",
            "rows_failed", "status", "created_at",
        ]


class ColumnMappingProfileSerializer(serializers.ModelSerializer):
    mapping = serializers.DictField(
        child=serializers.ChoiceField(choices=sorted(MAPPABLE_FIELDS)),
        help_text="`{the column's name in the file: the field it holds}`.",
    )

    class Meta:
        model = ColumnMappingProfile
        fields = ["id", "name", "mapping", "created_at"]
        read_only_fields = ["created_at"]


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


class PlanGenerateRequestSerializer(serializers.Serializer):
    date = serializers.DateField(
        required=False,
        help_text=(
            "The day to plan, `YYYY-MM-DD`: today (the default) up to a week "
            "ahead. Further out, the state the plan is built from will have moved."
        ),
    )
    replace = serializers.BooleanField(
        required=False, default=False,
        help_text=(
            "Rebuild a plan that already exists. Only blocks not yet ticked "
            "are replaced; anything completed stays. Without it, an existing "
            "plan is returned as it is."
        ),
    )


class PlanGenerationSerializer(serializers.Serializer):
    date = serializers.DateField()
    generated = serializers.BooleanField(
        help_text=(
            "True if this call made blocks. False if the plan already existed, "
            "or if nothing qualifies yet — `blocks` then says which: empty "
            "means there was nothing to plan, not that the call failed."
        )
    )
    blocks = PlanBlockSerializer(many=True)
    note = serializers.CharField(
        allow_null=True,
        help_text=(
            "One gentle sentence when today's plan is deliberately lighter or "
            "shorter than usual — written for the student, safe to show as it "
            "is, and never naming why. Null on an ordinary day (and on an "
            "empty one). Always present."
        ),
    )


#: The longest single study log a student may enter. A sanity bound, not a
#: view on how long anyone should study: the only purpose is that one typo
#: (`4500` for `45`) cannot become a 75-hour session that skews the
#: `overload` detector and the subject-balance chart for weeks. Twelve hours
#: is longer than anyone sits in one go, so an honest entry never meets it.
MAX_STUDY_LOG_MINUTES = 720

#: How far ahead of the server's clock a client's timestamp may run. A phone
#: that is a minute fast should still be able to log "just now".
FUTURE_SKEW = dt.timedelta(minutes=5)

NOT_YOUR_CHAPTER = "That chapter is not part of your syllabus."


class OwnChapterMixin:
    """For serializers whose `topic` must be a chapter of the caller's syllabus.

    `topic` is a bare primary key on the wire, so left alone it would accept
    any topic id the database can see. Row-level security narrows that to the
    institute, which is not enough: an institute teaching both JEE and NEET
    holds two syllabi, and a JEE student logging time against a Biology
    chapter would write a row no TopicState, detector or plan can place.

    The queryset is swapped per request for the student's own chapters, so
    "no such topic" and "someone else's topic" give the same answer — the
    first would otherwise confirm that an id exists elsewhere. With no
    student to scope to (schema generation, or a non-student caller) the
    queryset is empty and nothing validates.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        student = getattr(getattr(request, "user", None), "student", None)
        field = self.fields["topic"]
        field.queryset = (
            chapters_for_student(student) if student is not None else Topic.objects.none()
        )
        field.error_messages["does_not_exist"] = NOT_YOUR_CHAPTER
        field.error_messages["incorrect_type"] = NOT_YOUR_CHAPTER


class StudyLogCreateSerializer(OwnChapterMixin, serializers.ModelSerializer):
    """A self-reported study session, as the student enters it.

    Tier-1 data — see `StudyLog`. Backdating is allowed and expected (people
    log in the evening for the afternoon); the model keeps `logged_at`
    separately so a week entered on Sunday is visible as one signal rather
    than seven. Only the future is refused.
    """

    topic_name = serializers.CharField(source="topic.name", read_only=True)
    minutes = serializers.IntegerField(
        min_value=1,
        max_value=MAX_STUDY_LOG_MINUTES,
        help_text=f"Minutes studied, 1–{MAX_STUDY_LOG_MINUTES}.",
    )

    class Meta:
        model = StudyLog
        fields = ["id", "topic", "topic_name", "minutes", "mode", "ts"]

    def validate_ts(self, value):
        if value > timezone.now() + FUTURE_SKEW:
            raise serializers.ValidationError(
                "That time has not happened yet. Log study time after you have done it."
            )
        return value


class ConfidenceRatingSerializer(OwnChapterMixin, serializers.ModelSerializer):
    """How strong the student *thinks* they are in one chapter.

    Compared against measured mastery to find overconfidence (see
    `TopicState.confidence_gap`), so the value has to be the student's own
    honest answer *now*. That is why there is no `ts` on the request: the
    server stamps it. The feature store takes the latest rating by `ts`, so a
    client that could send its own timestamp could pin a rating for ever by
    dating it in the future.
    """

    topic_name = serializers.CharField(source="topic.name", read_only=True)
    self_rating = serializers.IntegerField(
        min_value=1,
        max_value=5,
        help_text="1 = not confident at all, 5 = fully confident.",
    )

    class Meta:
        model = ConfidenceRating
        fields = ["id", "topic", "topic_name", "self_rating", "ts"]
        read_only_fields = ["ts"]


class MyTopicSerializer(TopicSerializer):
    """A chapter as the student's pick-list shows it.

    `ncert_ref` is the point of the extra weight: where to re-read the
    chapter in the current NCERT textbooks, loaded from the official
    syllabus documents. Until this route nothing returned it, so the links
    existed in the database and nowhere a student could follow them.
    """

    unit = serializers.SerializerMethodField()
    ncert_ref = serializers.JSONField(
        read_only=True,
        allow_null=True,
        help_text=(
            "Where to re-read this chapter in the NCERT textbooks: a list of "
            "`{class, subject, book, chapter, title, pdf, sections?}`. Null "
            "when the chapter has no NCERT counterpart or has not been linked "
            "yet. `sections` appears only when just part of the NCERT chapter "
            "applies."
        ),
    )

    class Meta(TopicSerializer.Meta):
        fields = [*TopicSerializer.Meta.fields, "unit", "ncert_ref"]

    @staticmethod
    def get_unit(obj) -> str:
        return obj.parent.name if obj.parent_id is not None else ""


class MyProgressSerializer(StudentStateSerializer):
    """The slice of `StudentState` a student is shown about themselves.

    `risk_score`, `load_index` and `balance_index` are withheld. They are
    inputs to a mentor's triage, not feedback for a seventeen-year-old: a
    number that says "critical" with no conversation around it is a poor way
    to learn it. Nothing is hidden that the student cannot see another way —
    `/api/my/subject-breakdown/` carries the balance in plain terms. Whether
    students should see a risk band at all is a product decision, and showing
    less first is the one that can be undone.
    """

    class Meta(StudentStateSerializer.Meta):
        fields = [
            "consistency", "revision_debt", "mock_avg", "mock_trend",
            "syllabus_pct", "computed_at",
        ]


class MyProfileSerializer(serializers.ModelSerializer):
    """Who the signed-in student is, and where they stand."""

    batch = BatchSerializer(read_only=True)
    mentor_name = serializers.CharField(source="mentor.name", read_only=True, default=None)
    progress = MyProgressSerializer(source="state", read_only=True, allow_null=True)

    class Meta:
        model = Student
        fields = [
            "id", "name", "roll_no", "target", "joined_at",
            "batch", "mentor_name", "progress",
        ]


class MyRevisionSerializer(serializers.ModelSerializer):
    """One scheduled revision cycle: R1, R2, R3 of a chapter."""

    topic = TopicSerializer(read_only=True)
    is_overdue = serializers.BooleanField(
        read_only=True,
        help_text="Scheduled before today and not yet done.",
    )

    class Meta:
        model = RevisionEvent
        fields = ["id", "topic", "cycle", "scheduled_for", "done_at", "is_overdue"]


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

    last_refreshed_at = serializers.DateTimeField(
        allow_null=True,
        help_text=(
            "When the nightly refresh (features, revisions, flags, plans) last "
            "finished successfully for this institute — how fresh the numbers "
            "on this strip are. Institute-wide even under `?batch=`. Null when "
            "it has never run, which means everything here comes from manual "
            "or on-event updates only."
        ),
    )


# ------------------------------------------------------------------- auth


class DetailSerializer(serializers.Serializer):
    """The one-key error/ack envelope DRF already uses everywhere."""

    detail = serializers.CharField()


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(
        help_text=(
            "A staff username, **or a student's roll number**. One field "
            "because the login form has one box; the password decides which "
            "account it was."
        ),
    )
    password = serializers.CharField(
        style={"input_type": "password"}, trim_whitespace=False, write_only=True
    )
    institute = serializers.CharField(
        required=False,
        allow_blank=True,
        write_only=True,
        help_text=(
            "Optional institute code (its slug). Roll numbers are only unique "
            "within a batch, so this narrows the search for a student whose "
            "number exists elsewhere; sign-in works without it."
        ),
    )


#: Django's own validators run on top of these: minimum length, not a common
#: password, not all digits, not too like the account's name.
PASSWORD_MAX_LENGTH = 128


class PasswordChangeSerializer(serializers.Serializer):
    """Replace my password. The first sign-in of a new student ends here."""

    current_password = serializers.CharField(
        style={"input_type": "password"}, trim_whitespace=False, write_only=True,
        help_text="The password I signed in with — the temporary one, the first time.",
    )
    new_password = serializers.CharField(
        style={"input_type": "password"}, trim_whitespace=False, write_only=True,
        max_length=PASSWORD_MAX_LENGTH,
        help_text=(
            "At least 8 characters; not a common password, not all digits, "
            "not like my name, and not my roll number."
        ),
    )

    def validate_current_password(self, value):
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("That is not your current password.")
        return value

    def validate(self, attrs):
        user = self.context["request"].user
        new = attrs["new_password"]

        if new == attrs["current_password"]:
            raise serializers.ValidationError(
                {"new_password": ["Choose a password different from the one you have now."]}
            )

        # A roll number is printed on the ID card and known to every
        # classmate, so a password built on it protects nothing. Four
        # characters and up, so a roll number of "7" does not outlaw every
        # password containing a seven.
        student = getattr(user, "student", None)
        if student is not None and len(student.roll_no) >= 4 and (
            student.roll_no.lower() in new.lower()
        ):
            raise serializers.ValidationError(
                {"new_password": ["Your password cannot contain your roll number."]}
            )

        try:
            validate_password(new, user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"new_password": list(exc.messages)})
        return attrs


class StudentCredentialSerializer(serializers.Serializer):
    """What staff are handed after issuing or resetting a student's login.

    **Shown once.** `temporary_password` is not stored anywhere in a form
    that can be read back, so there is no endpoint to fetch it again; the
    only recovery is a reset. The response is sent with `Cache-Control:
    no-store`.
    """

    student_id = serializers.IntegerField()
    name = serializers.CharField()
    roll_no = serializers.CharField(
        help_text="What the student types into the username box."
    )
    temporary_password = serializers.CharField()
    must_change_password = serializers.BooleanField(
        help_text="Always true: the student must choose their own at first sign-in."
    )


class StudentCredentialRequestSerializer(serializers.Serializer):
    password = serializers.CharField(
        required=False, trim_whitespace=False, write_only=True, max_length=PASSWORD_MAX_LENGTH,
        help_text=(
            "Optional. Use this password as the temporary one instead of a "
            "generated one — at least 6 characters. Omit it to have a random "
            "one made, which is the better default."
        ),
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
    must_change_password = serializers.BooleanField(
        help_text=(
            "True while this account is signed in on a temporary password. "
            "Until it is changed (`POST /api/auth/password/`) every other "
            "route answers 403 with `code: password_change_required`, so a "
            "client should route straight to the change-password screen."
        )
    )
