"""Serializers for the engine features: onboarding, and the profile that reports it.

Kept out of `serializers.py` so that file's contract is not reshuffled by
features that only add to it. Everything here is part of the same OpenAPI
contract — regenerate the schema after changing a field.
"""

from __future__ import annotations

from drf_spectacular.utils import extend_schema_serializer
from rest_framework import serializers

from apps.tenancy.models import Student

from .serializers import MyProfileSerializer

#: The bounds a student may give for "how long can you study a day". The
#: upper bound is the same twelve hours a single study log may claim
#: (`serializers.MAX_STUDY_LOG_MINUTES`); the lower is half an hour, below
#: which there is no plan to build. The planner then clamps to its own
#: 90–360 budget — see `planner.choose_budget`.
#: 45 is the shortest day the planner can fill honestly: its smallest revise
#: and practice blocks both fit. A student who says less would be planned
#: either an empty day or more than they said they have.
MIN_DAILY_MINUTES, MAX_DAILY_MINUTES = 45, 720


class OnboardingSerializer(serializers.Serializer):
    """What onboarding shows and stores — read model for `/api/my/onboarding/`.

    The exam, its date and the batch are the institute's decisions, read off
    the student's batch and shown for confirmation only: a student cannot
    move themselves to another exam or batch here. What the student owns is
    how long they can study a day and the rank they are aiming for.
    """

    exam_code = serializers.CharField(source="batch.exam.code", read_only=True,
                                      help_text="The batch's exam, e.g. `JEE_MAIN`. Read-only.")
    exam_name = serializers.CharField(source="batch.exam.name", read_only=True,
                                      help_text="Display name of the exam. Read-only.")
    exam_date = serializers.DateField(
        source="batch.exam_date", read_only=True, allow_null=True,
        help_text="The day the batch sits the exam. Null when the institute has not set it. Read-only.",
    )
    batch_name = serializers.CharField(source="batch.name", read_only=True,
                                       help_text="The batch the institute placed the student in. Read-only.")
    target = serializers.CharField(
        read_only=True,
        help_text=(
            "The free-text target the institute recorded (\"AIR < 5000\"), or an "
            "empty string. Read-only here; `target_rank` is the student's own number."
        ),
    )
    target_rank = serializers.IntegerField(
        read_only=True, allow_null=True,
        help_text="The rank the student is aiming for (1 or more). Null until they say.",
    )
    daily_minutes = serializers.IntegerField(
        read_only=True, allow_null=True,
        help_text=(
            f"Minutes a day the student says they can study, {MIN_DAILY_MINUTES}–"
            f"{MAX_DAILY_MINUTES}. Null until onboarding. The day planner uses it "
            "before the median of what they log, clamped to its 90–360 minute budget."
        ),
    )
    onboarded_at = serializers.DateTimeField(
        read_only=True, allow_null=True,
        help_text="When onboarding was first saved. Set once; later edits do not move it.",
    )
    needs_onboarding = serializers.SerializerMethodField(
        help_text="True until onboarding has been saved once (`onboarded_at` is null).",
    )

    def get_needs_onboarding(self, obj: Student) -> bool:
        return obj.onboarded_at is None


class OnboardingUpdateSerializer(serializers.Serializer):
    """The body of `PUT /api/my/onboarding/`. A PUT replaces both fields."""

    daily_minutes = serializers.IntegerField(
        min_value=MIN_DAILY_MINUTES, max_value=MAX_DAILY_MINUTES,
        help_text=f"Required. Minutes a day you can study, {MIN_DAILY_MINUTES}–{MAX_DAILY_MINUTES}.",
    )
    target_rank = serializers.IntegerField(
        min_value=1, required=False, allow_null=True, default=None,
        help_text=(
            "The rank you are aiming for, 1 or more. Optional: omitting it or "
            "sending null clears it, because a PUT replaces the whole answer."
        ),
    )


# `MyProfileSerializer` plus `needs_onboarding`, published as the same
# `MyProfile` component. A subclass rather than an edit so the field arrives
# without reshuffling the shared serializer module; the component name is
# pinned so the contract sees one `MyProfile` that gained a field rather than
# a renamed schema. The docstring below is the component's public
# description, so it stays the parent's.
@extend_schema_serializer(component_name="MyProfile")
class MyProfileWithOnboardingSerializer(MyProfileSerializer):
    """Who the signed-in student is, and where they stand."""

    needs_onboarding = serializers.SerializerMethodField(
        help_text=(
            "True until the student has saved `/api/my/onboarding/` once. The "
            "student app shows onboarding first while this is true."
        ),
    )

    class Meta(MyProfileSerializer.Meta):
        fields = [*MyProfileSerializer.Meta.fields, "needs_onboarding"]

    def get_needs_onboarding(self, obj: Student) -> bool:
        return obj.onboarded_at is None
