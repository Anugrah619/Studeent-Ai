"""Serializers for the student app's guidance routes. Part of the contract.

    GET  /api/my/guidance/        GuidanceSerializer
    POST /api/my/guidance/ask/    AskSerializer -> AskAnswerSerializer
    POST /api/my/plan/explain/    PlanExplainDaySerializer -> PlanExplainSerializer

Kept apart from `serializers.py` so the guidance surface reads as one unit,
and because everything here is shown to a minor: each field's help text
says what is withheld as well as what is shown.
"""

from __future__ import annotations

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.reasoning.services import guidance
from apps.syllabus.models import Topic

#: The published values of `NextAction.kind`, in ranking order. Pinned to its
#: own component name in `SPECTACULAR_SETTINGS["ENUM_NAME_OVERRIDES"]`: the
#: field is called `kind`, like `Topic.kind`, and without the pin the two
#: collide — measured: `Topic.kind`'s `KindEnum` became `KindC54Enum`, the
#: exact silent rename `apps/api/enums.py` exists to prevent.
NEXT_ACTION_KIND_CHOICES = guidance.NEXT_ACTION_KINDS

#: `Topic.kind`, pinned back to the `KindEnum` name the generated client
#: already imports. An import path is needed, and a class attribute is not
#: one. (It belongs beside the others in `apps/api/enums.py`; it is here
#: only because this change does not own that file.)
TOPIC_KIND_CHOICES = Topic.KIND

TARGET_SCHEMA = {
    "oneOf": [
        {
            "type": "string",
            "enum": guidance.TARGETS,
            "description": (
                "A screen of the student app: `plan`, `revisions`, `topics` "
                "(chapter mastery), `study-log`, or `confidence`."
            ),
        },
        {
            "type": "object",
            "properties": {
                "mock": {
                    "type": "integer",
                    "description": (
                        "A `paper_id` this student sat — what "
                        "`GET /api/my/marks-lost/?paper=` takes."
                    ),
                },
            },
            "required": ["mock"],
        },
    ],
}


@extend_schema_field(TARGET_SCHEMA)
class GuidanceTargetField(serializers.Field):
    """A route hint: a screen name, or `{"mock": paper_id}`. Read-only."""

    def to_representation(self, value):
        return value


class NextActionSerializer(serializers.Serializer):
    """One thing to do next, worked out by rules from the student's own data.

    No model is involved, and nothing here is a label about the student:
    every `title` and `detail` is an action and the fact behind it.
    """

    kind = serializers.ChoiceField(
        choices=NEXT_ACTION_KIND_CHOICES,
        help_text=(
            "Which rule produced this. The list is ranked by kind, in the "
            "order the enum lists them: `start_plan`/`make_plan`, "
            "`revisions_due`, `mock_recoverable`, `weak_chapter`, "
            "`log_study`, `rate_confidence`. At most one of each."
        ),
    )
    title = serializers.CharField(help_text="One line, safe to show verbatim.")
    detail = serializers.CharField(help_text="One or two sentences: the fact behind the action.")
    target = GuidanceTargetField(
        help_text="Where tapping this should go. A screen name, or `{\"mock\": paper_id}`.",
    )


class FindingQuestionSerializer(serializers.Serializer):
    question_pk = serializers.IntegerField(
        help_text=(
            "Opens with `GET /api/my/questions/{id}/`. Only questions this "
            "student answered are ever listed, so the link always opens."
        ),
    )
    label = serializers.CharField(help_text="The question as the paper prints it, e.g. `\"Q16\"`.")


class FindingSerializer(serializers.Serializer):
    """A diagnosis the student's mentor agreed with, in the student's words.

    **Only `agreed` diagnoses appear.** Unreviewed and disagreed ones never
    reach the student app. No misconception code, risk score or flag is
    included; the wording is the model's rewording of the approved finding
    (`reworded: true`) or a fixed template built from it when the model is
    unavailable (`reworded: false`).
    """

    paper_id = serializers.IntegerField(
        allow_null=True,
        help_text=(
            "The paper this finding is about — the `paper_id` of "
            "`GET /api/my/mock-scores/`. Null when the diagnosis spanned "
            "every paper the student had sat, or its paper no longer exists."
        ),
    )
    paper_name = serializers.CharField(
        allow_null=True, help_text="Null when the finding spans several papers."
    )
    title = serializers.CharField(help_text="Plain words, encouraging, at most about 12 words.")
    explanation = serializers.CharField(help_text="Two or three sentences, addressed to 'you'.")
    what_to_do = serializers.CharField(help_text="One concrete next step the student can take.")
    questions = FindingQuestionSerializer(
        many=True, help_text="The questions the finding rests on, in the order cited."
    )
    approved_at = serializers.DateTimeField(
        allow_null=True,
        help_text=(
            "When the mentor agreed. Null only for an agreement recorded "
            "before the time was kept."
        ),
    )
    reworded = serializers.BooleanField(
        help_text=(
            "True if the wording is the model's rewording for students; false "
            "if it is the fixed template, used while the model is unavailable."
        ),
    )


class GuidanceSerializer(serializers.Serializer):
    next_actions = NextActionSerializer(
        many=True, help_text="At most five, most useful first. Empty is a real answer."
    )
    findings = FindingSerializer(
        many=True, help_text="One per paper, newest approval first. Empty until a mentor agrees."
    )


class AskSerializer(serializers.Serializer):
    question = serializers.CharField(
        max_length=guidance.MAX_QUESTION_CHARS,
        help_text=(
            f"A preparation question, at most {guidance.MAX_QUESTION_CHARS} "
            "characters — 'what should I focus on this week?', 'why is "
            "Thermodynamics in my plan?'. Names, roll numbers, the mentor's "
            "and institute's names, phone numbers and emails are removed "
            "before it is sent anywhere."
        ),
    )


class AskAnswerSerializer(serializers.Serializer):
    answer = serializers.CharField(help_text="At most about 120 words, safe to show verbatim.")
    available = serializers.BooleanField(
        help_text="Always true on a 200. When no answer can be given the response is a 503."
    )
    from_cache = serializers.BooleanField(
        help_text="True if this exact question over the same data was answered before."
    )


class PlanExplainDaySerializer(serializers.Serializer):
    date = serializers.DateField(
        required=False,
        help_text="The day whose plan to explain, `YYYY-MM-DD`. Defaults to today.",
    )


class PlanExplainSerializer(serializers.Serializer):
    date = serializers.DateField()
    summary = serializers.CharField(
        help_text="Two or three sentences, built from the blocks' own reasons."
    )
    available = serializers.BooleanField(
        help_text=(
            "True if `summary` was written by the model. False means it is the "
            "fixed summary — because the model is unavailable, the budget is "
            "spent, or there is no plan for the day. Never an error."
        ),
    )
    from_cache = serializers.BooleanField(
        help_text="True if this exact plan was explained before and the answer replayed."
    )
