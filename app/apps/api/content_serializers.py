"""Serializers for content work: describing a paper's options, reviewing answer keys.

Kept apart from `serializers.py` so this surface can grow without every change
landing in the one file the whole contract lives in. They are still the
contract — drf-spectacular reads them for `openapi.yaml` like any other.

Console only. Misconception tags are the diagnosis in miniature, and students
are minors who are not shown what the system thinks they believe; nothing
here is reachable from `/api/my/`.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.ingestion.models import QuestionTopicMap, Source

# Module-level so `SPECTACULAR_SETTINGS["ENUM_NAME_OVERRIDES"]` can name them:
# two of these sit on fields called `status`, and an unpinned second `status`
# enum would rename the existing `StatusEnum` (see `apps/api/enums.py`).
KEY_REVIEW_DECISIONS = [
    (QuestionTopicMap.REVIEW_KEY_STANDS, "The official key stands"),
    (QuestionTopicMap.REVIEW_KEY_WRONG, "The key as stored is wrong"),
    (QuestionTopicMap.REVIEW_UNCLEAR, "Unclear — needs a subject expert"),
]
KEY_REVIEW_STATUSES = [("unreviewed", "Not reviewed yet"), *KEY_REVIEW_DECISIONS]
DRAFT_STATUSES = [
    ("draft", "Proposed, not yet acted on"),
    ("accepted", "A person tagged the option with this code"),
    ("superseded", "A person tagged the option with a different code"),
]
VERIFICATION_CHOICES = QuestionTopicMap.VERIFICATION
DIFFICULTY_CHOICES = QuestionTopicMap._meta.get_field("difficulty").choices

VERIFICATION_HELP = (
    "Trust in this question's answer key. `agreed`: the factory's blind solve "
    "matched the official key. `disagreed`: it did not, and nobody has "
    "reviewed it. `key_stands` / `key_wrong` / `key_unclear`: a person's "
    "decision on a disagreement. `unverifiable`: could not be checked. Blank: "
    "never cross-checked — an institute's own or a demo paper, whose key is "
    "its author's. Trusted keys: blank, `agreed`, `key_stands`."
)


# ------------------------------------------------------- paper questions (GET)


class MisconceptionRefSerializer(serializers.Serializer):
    code = serializers.CharField()
    name = serializers.CharField()


class DraftMisconceptionSerializer(serializers.Serializer):
    """A proposed misconception for one option. **Not a tag** — diagnosis ignores it."""

    code = serializers.CharField(
        allow_blank=True,
        help_text=(
            "The code proposed — an existing taxonomy code, or a new one the "
            "model invented. Blank for a proposal made in the console, which "
            "names a belief rather than a code."
        ),
    )
    name = serializers.CharField(allow_blank=True)
    description = serializers.CharField(
        allow_blank=True, help_text="The wrong belief, in the student's voice."
    )
    is_new = serializers.BooleanField(
        help_text="True when the proposal is not (yet) in the taxonomy."
    )
    proposed_by = serializers.ChoiceField(
        choices=[("model", "The question factory's tagger"), ("console", "A person, in the console")]
    )
    status = serializers.ChoiceField(
        choices=DRAFT_STATUSES,
        help_text=(
            "`draft` until a person tags the option; then `accepted` if they "
            "used this draft's code, `superseded` if they chose another."
        ),
    )


class TaggableOptionSerializer(serializers.Serializer):
    label = serializers.CharField()
    text = serializers.CharField(
        allow_blank=True, help_text="Blank on a blueprint paper until someone types it."
    )
    is_correct = serializers.BooleanField()
    misconception = MisconceptionRefSerializer(
        allow_null=True,
        help_text=(
            "The confirmed tag — what diagnosis reads. Always null on a correct "
            "option; null on a wrong option nobody has described yet."
        ),
    )
    draft_misconception = DraftMisconceptionSerializer(
        allow_null=True,
        help_text="A proposal awaiting a person, or its resolved record. Null if none.",
    )


class TaggableQuestionSerializer(serializers.Serializer):
    """One question as the tagging screen edits it."""

    id = serializers.IntegerField(
        help_text="`QuestionTopicMap.id` — the `question_pk` the PATCH route takes."
    )
    label = serializers.CharField(help_text="As the paper prints it: `Q14`, `D16`.")
    topic = serializers.CharField(allow_null=True, help_text="Chapter name. Null if unmapped.")
    topic_id = serializers.IntegerField(allow_null=True)
    subject = serializers.CharField(
        allow_null=True,
        help_text=(
            "The question's subject — its chapter's root in the syllabus tree. "
            "Pass it to `GET /api/misconceptions/?subject=` to offer only the "
            "misconceptions a tag may use. Null when nothing places the question."
        ),
    )
    answer_type = serializers.ChoiceField(choices=QuestionTopicMap.ANSWER_TYPE)
    correct_option = serializers.CharField(
        allow_null=True,
        help_text=(
            "Label of the correct option; comma-joined when the official key "
            "accepts more than one (`1,2`). Null for a numerical-value question."
        ),
    )
    official_answer = serializers.CharField(
        allow_blank=True, help_text="The key as stored — the number, for a numerical question."
    )
    question_text = serializers.CharField(allow_blank=True)
    solution = serializers.CharField(allow_blank=True)
    difficulty = serializers.ChoiceField(choices=DIFFICULTY_CHOICES, allow_blank=True)
    verification = serializers.ChoiceField(choices=VERIFICATION_CHOICES, help_text=VERIFICATION_HELP)
    has_answers = serializers.BooleanField(
        help_text=(
            "Students have answers recorded here. Informational: tags and text "
            "may still be edited, because they change no one's marks."
        )
    )
    options = TaggableOptionSerializer(
        many=True, help_text="In label order. Empty for a numerical-value question."
    )


class PaperQuestionsSummarySerializer(serializers.Serializer):
    questions = serializers.IntegerField()
    with_text = serializers.IntegerField(help_text="Questions whose stem has been written.")
    wrong_options = serializers.IntegerField(
        help_text="Wrong options across the paper — every one a diagnosis could use."
    )
    wrong_options_tagged = serializers.IntegerField(
        help_text=(
            "Wrong options carrying a confirmed misconception. A paper is "
            "diagnosable once the options its students actually chose are tagged."
        )
    )
    wrong_options_with_draft = serializers.IntegerField(
        help_text="Untagged wrong options with a pending proposal to act on."
    )


class PaperQuestionsSerializer(serializers.Serializer):
    """A paper's questions, whole, with how far through tagging it is.

    Not paginated, on purpose: it is bounded by one paper (a paper has at most
    300 questions; NEET's is 180), and a tagging screen that showed one page
    beside counts for the whole paper would misreport its own progress.
    """

    paper_id = serializers.IntegerField()
    paper_name = serializers.CharField()
    paper_source = serializers.ChoiceField(choices=Source.choices)
    held_on = serializers.DateField()
    summary = PaperQuestionsSummarySerializer()
    questions = TaggableQuestionSerializer(many=True)


# ---------------------------------------------------- paper question (PATCH)


class DraftMisconceptionProposalSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120, help_text="A short name for the belief.")
    description = serializers.CharField(
        max_length=2000, help_text="The wrong belief, stated as the student would hold it."
    )


class OptionContentUpdateSerializer(serializers.Serializer):
    label = serializers.CharField(max_length=2, help_text="Which option: `A`, or `1` on an official paper.")
    text = serializers.CharField(
        max_length=500, required=False, allow_blank=True,
        help_text="The option's text. Omit to leave it unchanged.",
    )
    misconception_code = serializers.CharField(
        max_length=32, required=False, allow_null=True, allow_blank=True,
        help_text=(
            "Tag this wrong option with a taxonomy code (`GET /api/misconceptions/`). "
            "Null or blank removes the tag; omit to leave it unchanged. Refused "
            "on the correct option, for a code not in the taxonomy, and for a "
            "code of another subject."
        ),
    )
    draft_misconception = DraftMisconceptionProposalSerializer(
        required=False, allow_null=True,
        help_text=(
            "Propose a belief the taxonomy lacks. Stored as a draft that counts "
            "for nothing until a person adds it to the taxonomy and tags the "
            "option with it. Null clears the option's draft; omit to leave it."
        ),
    )


class QuestionContentUpdateSerializer(serializers.Serializer):
    """Every field optional; only what is sent changes. All or nothing."""

    question_text = serializers.CharField(required=False, allow_blank=True, max_length=10_000)
    solution = serializers.CharField(required=False, allow_blank=True, max_length=20_000)
    options = OptionContentUpdateSerializer(
        many=True, required=False,
        help_text="Only the options named here change; the rest are left as they are.",
    )


# ------------------------------------------------- answer-key disagreements


class DisagreementOptionSerializer(serializers.Serializer):
    label = serializers.CharField()
    text = serializers.CharField(allow_blank=True)
    is_correct = serializers.BooleanField(help_text="Correct according to the official key.")


class KeyReviewSerializer(serializers.Serializer):
    status = serializers.ChoiceField(
        choices=KEY_REVIEW_STATUSES,
        help_text="`unreviewed`, or the latest decision.",
    )
    note = serializers.CharField(allow_blank=True)
    reviewed_by = serializers.CharField(
        allow_null=True, help_text="Who made the latest decision (their username). Null if nobody."
    )
    reviewed_at = serializers.DateTimeField(allow_null=True)


class KeyDisagreementSerializer(serializers.Serializer):
    """One question where the factory's blind answer and the official key differ."""

    id = serializers.IntegerField(
        help_text="`QuestionTopicMap.id` — the `question_pk` the review POST takes."
    )
    paper_id = serializers.IntegerField()
    paper_name = serializers.CharField()
    label = serializers.CharField()
    subject = serializers.CharField(allow_null=True)
    answer_type = serializers.ChoiceField(choices=QuestionTopicMap.ANSWER_TYPE)
    question_text = serializers.CharField(allow_blank=True)
    options = DisagreementOptionSerializer(many=True)
    official_answer = serializers.CharField(
        allow_blank=True, help_text="NTA's key, mapped to this paper's labels: `2`, `1,2`, `225`."
    )
    model_answer = serializers.CharField(
        allow_blank=True, help_text="What the model got solving blind. Never the answer."
    )
    has_diagram = serializers.BooleanField()
    verification = serializers.ChoiceField(choices=VERIFICATION_CHOICES, help_text=VERIFICATION_HELP)
    detail_summary = serializers.CharField(
        help_text=(
            "`verification_detail` in one paragraph: the model's answer and "
            "confidence, its note, transcription issues, and the factory agent's "
            "first look — labelled as not a human review."
        )
    )
    model_working = serializers.CharField(
        allow_blank=True, help_text="The model's blind working, truncated to 1,500 characters."
    )
    review = KeyReviewSerializer()


class DisagreementReviewSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(
        choices=KEY_REVIEW_DECISIONS,
        help_text=(
            "`key_stands`: the official key is right (the key becomes trusted). "
            "`key_wrong`: the key as stored is wrong — usually a misread question "
            "(the key becomes untrusted and its options cannot be tagged). "
            "`unclear`: needs a subject expert (still untrusted, no longer unreviewed)."
        ),
    )
    note = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=2000,
        help_text="Why. Kept with the decision and in its history.",
    )
