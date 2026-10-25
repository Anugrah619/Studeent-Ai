"""The student app's guidance routes.

    GET  /api/my/guidance/        what to do next, and what my mentor agreed
    POST /api/my/guidance/ask/    a preparation question, answered
    POST /api/my/plan/explain/    a day's plan, in two or three sentences

Addressed by account like the rest of `/api/my/` (see `my_views`): the
student is whoever the session says, and nothing in a path, query or body
can name another one. All three are student-only — a 403 for anyone else,
because none of them has a sensible empty answer.

The services live in `apps/reasoning/services/guidance.py`; this module is
only the HTTP around them. The one thing decided here is the throttle,
because it needs the request.

WHY THE THROTTLES ARE APPLIED BY HAND
    `ScopedRateThrottle` normally runs before the view and counts every
    request. Both POSTs here instead ask it only at the moment a *model call*
    is about to be made:

    * `ask` — a cached answer to a repeated question costs nothing and is not
      counted, and the fixed reply to a student who says they want to hurt
      themselves is never throttled at all. A 429 in answer to that message
      would be the worst possible reply.
    * `plan/explain` — "always 200". Over the budget, the deterministic
      summary is returned instead of a 429: explaining a plan must never
      block the plan.
"""

from __future__ import annotations

from django.utils import timezone
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.reasoning.services import guidance

from . import guidance_serializers as gs
from . import serializers as ser
from .permissions import IsStudentAccount

#: The 503 body for `ask`. Read by a student, so it says what happened and
#: that nothing else is affected — never a model name or an error string.
ASK_UNAVAILABLE = (
    "The guide can't answer right now — it's busy or offline. Your plan, "
    "revisions and results all still work, and you can ask again in a few "
    "minutes or ask your mentor."
)

STUDENT_ONLY = OpenApiResponse(
    response=ser.DetailSerializer, description="Not a student account."
)


class StudentOnlyView(APIView):
    permission_classes = [IsAuthenticated, IsStudentAccount]

    #: Applied by hand in the POSTs below; see the module docstring.
    throttle_scope: str | None = None

    def get_throttles(self):
        return []

    def model_budget(self, request):
        """A `may_spend()` for the service: True while the scope allows a call.

        Each `True` is one recorded use of the throttle. The throttle object
        is returned too, so a refusal can report how long to wait.
        """
        throttle = ScopedRateThrottle()
        return (lambda: throttle.allow_request(request, self)), throttle


@extend_schema(tags=["student-app"])
class MyGuidanceView(StudentOnlyView):
    """What to do next, and the findings my mentor has agreed with."""

    @extend_schema(responses={200: gs.GuidanceSerializer, 403: STUDENT_ONLY})
    def get(self, request):
        """My next actions and my mentor-approved findings.

        `next_actions` are rules over my own data — no model — at most five,
        ranked by kind (see `NextAction.kind`). `findings` are diagnoses my
        mentor marked **agreed**, one per paper, reworded for me; a diagnosis
        nobody has reviewed, or that my mentor disagreed with, never appears.

        Never a 503, and never a wait on the model: a finding shows the
        rewording the nightly job made, or — until it has — a fixed template
        (`reworded: false`).
        """
        student = request.user.student
        return Response(gs.GuidanceSerializer({
            "next_actions": guidance.next_actions(student),
            # The cache only. The rewording itself is done by the nightly job
            # (`guidance.reword_findings`); one live call took 40 s.
            "findings": guidance.findings(student, live_budget=0),
        }).data)


@extend_schema(tags=["student-app"])
class MyGuidanceAskView(StudentOnlyView):
    """Ask the guide a preparation question."""

    throttle_scope = "guidance_ask"

    @extend_schema(
        request=gs.AskSerializer,
        responses={
            200: gs.AskAnswerSerializer,
            400: OpenApiResponse(
                description=(
                    "`question` missing, blank, or over 500 characters. DRF's "
                    "field-error shape: `{\"question\": [\"...\"]}`."
                ),
            ),
            403: STUDENT_ONLY,
            429: OpenApiResponse(
                response=ser.DetailSerializer,
                description=(
                    "Today's questions are used up (`guidance_ask`, about 20 a "
                    "day). Repeating a question already answered is not counted."
                ),
            ),
            503: OpenApiResponse(
                response=ser.DetailSerializer,
                description=(
                    "The guide cannot answer now. `detail` is a sentence for the "
                    "student, safe to show verbatim."
                ),
            ),
        },
    )
    def post(self, request):
        """Answer a question about my preparation — not a doubt about a chapter.

        "What should I focus on this week?" and "why is X in my plan?" are
        answered from my own plan, weakest chapters, due revisions and recent
        mocks. A request to solve a question or explain a concept is politely
        declined with a pointer to my teacher; health and wellbeing get a kind
        pointer to my mentor or a trusted adult and no advice.

        My name, roll number, mentor, institute, and any phone number or email
        are removed from the question before it leaves the server.
        """
        form = gs.AskSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        may_spend, throttle = self.model_budget(request)
        try:
            answer = guidance.answer_question(
                request.user.student, form.validated_data["question"], may_spend=may_spend
            )
        except guidance.OverBudget:
            self.throttled(request, throttle.wait())
        except guidance.Unavailable:
            return Response({"detail": ASK_UNAVAILABLE},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response(gs.AskAnswerSerializer({
            "answer": answer.answer,
            "available": answer.available,
            "from_cache": answer.from_cache,
        }).data)


@extend_schema(tags=["student-app"])
class MyPlanExplainView(StudentOnlyView):
    """A day's plan, explained in a sentence or three."""

    throttle_scope = "plan_explain"

    @extend_schema(
        request=gs.PlanExplainDaySerializer,
        responses={
            200: gs.PlanExplainSerializer,
            400: OpenApiResponse(
                description=(
                    "`date` is not a `YYYY-MM-DD` date. DRF's field-error shape: "
                    "`{\"date\": [\"...\"]}`."
                ),
            ),
            403: STUDENT_ONLY,
        },
    )
    def post(self, request):
        """Why my plan for a day is what it is, from its blocks' own reasons.

        **Always a 200** for a valid request. When the model is unavailable,
        or the `plan_explain` budget is spent, `summary` is a fixed summary
        built from the same reasons and `available` is false. A day with no
        plan says so, with `available: false`. Cached on the plan's content:
        ticking a block or asking again costs nothing.
        """
        form = gs.PlanExplainDaySerializer(data=request.data)
        form.is_valid(raise_exception=True)
        day = form.validated_data.get("date") or timezone.localdate()
        may_spend, _ = self.model_budget(request)
        result = guidance.explain_plan(request.user.student, day, may_spend=may_spend)
        return Response(gs.PlanExplainSerializer(result).data)
