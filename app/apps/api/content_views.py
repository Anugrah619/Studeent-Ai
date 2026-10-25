"""Content work in the console: describing a paper's options, reviewing answer keys.

    GET   /api/papers/{id}/questions/                 a paper's questions, for tagging
    PATCH /api/papers/{id}/questions/{question_pk}/   text, solution, option tags
    GET   /api/misconceptions/?subject=               the taxonomy, for the picker
    GET   /api/review/disagreements/                  answer-key disagreements
    POST  /api/review/disagreements/{question_pk}/    a person's decision on one

Why each exists:

* An institute's own paper arrives through a blueprint, which knows each
  question's chapter and key and nothing about its options. Its results give
  scores and flags but no diagnosis — `GET /api/students/{id}/diagnosis/`
  answers 422 "options not described" — until someone says what each wrong
  option means. The first three routes are that job, once per paper.
* The question factory flags every official question where its blind solve
  and NTA's key differ (`verification = disagreed`). Thirty-two of them sat in
  an admin filter with no way to record what a person concluded. The last two
  routes are that record. What each decision changes is in
  `apps/ingestion/services/review.py`.

The rules live in `apps/ingestion/services/tagging.py` and `review.py`; the
views are HTTP only. Every route is console-only (`CONSOLE_PERMISSIONS`) and
scoped to the caller's institute, and "not yours" answers exactly like "does
not exist". The taxonomy is the one global table here: misconceptions are the
same in Kota and Jaipur.
"""

from __future__ import annotations

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.events.models import Attempt
from apps.ingestion.models import Misconception, QuestionTopicMap, TestPaper
from apps.ingestion.services import review, tagging

from . import content_serializers as cser
from . import serializers as ser
from .pagination import StandardPagination
from .views import CONSOLE_PERMISSIONS, INSTITUTE_PARAM, TenantScopedMixin

NO_SUCH_PAPER = "No such paper."
NO_SUCH_QUESTION = "No such question on this paper."
NO_SUCH_DISAGREEMENT = "No such answer-key disagreement."

VALIDATION_400 = OpenApiResponse(
    response=OpenApiTypes.OBJECT,
    description=(
        "Nothing was written. DRF's validation-error shape: each field maps to "
        "a list of sentences. For `options` that is either a list of sentences "
        "(a problem with the list as a whole — a numerical question, a label "
        "named twice) or a list aligned with the request's `options`, each "
        "entry `{}` or `{field: [sentences]}` — e.g. the correct option given "
        "a misconception, a code not in the taxonomy, a code of another "
        "subject, or a tag on a question whose key a reviewer found wrong."
    ),
)


def _paper(institute_id: int | None, pk: int) -> TestPaper | None:
    if not institute_id:
        return None
    return TestPaper.objects.filter(pk=pk, institute_id=institute_id).first()


def _questions(paper: TestPaper):
    return (
        QuestionTopicMap.objects.filter(test_paper=paper, institute_id=paper.institute_id)
        .select_related("topic__parent__parent")
        .prefetch_related("options__misconception")
        # Load order is paper order for factory papers and file order for a
        # blueprint, and `id` is total; `question_id` would sort Q10 before Q2.
        .order_by("id")
    )


def _answered(paper: TestPaper, labels=None) -> set[str]:
    qs = Attempt.objects.filter(test_paper=paper, institute_id=paper.institute_id)
    if labels is not None:
        qs = qs.filter(question_id__in=list(labels))
    return set(qs.values_list("question_id", flat=True).distinct())


# --------------------------------------------------------- paper questions


@extend_schema(tags=["papers"], parameters=[INSTITUTE_PARAM])
class PaperQuestionsView(TenantScopedMixin, APIView):
    """Every question on one paper, with its options and what each one means."""

    permission_classes = CONSOLE_PERMISSIONS

    @extend_schema(
        responses={
            200: cser.PaperQuestionsSerializer,
            404: OpenApiResponse(response=ser.DetailSerializer, description="No such paper in this institute."),
        },
    )
    def get(self, request, pk: int):
        """A paper's questions for the tagging screen, whole, with progress counts.

        `summary.wrong_options_tagged` against `summary.wrong_options` is how
        far the paper is from being diagnosable. Only what students actually
        chose matters to a diagnosis, so a paper does not have to be finished
        to be useful — but an untagged option a student picked is a wrong
        answer the diagnosis cannot explain.
        """
        paper = _paper(self.institute_id(), pk)
        if paper is None:
            return Response({"detail": NO_SUCH_PAPER}, status=status.HTTP_404_NOT_FOUND)
        answered = _answered(paper)
        questions = [tagging.present_question(q, answered) for q in _questions(paper)]
        return Response(cser.PaperQuestionsSerializer({
            "paper_id": paper.id,
            "paper_name": paper.name,
            "paper_source": paper.source,
            "held_on": paper.held_on,
            "summary": tagging.summarise(questions),
            "questions": questions,
        }).data)


@extend_schema(tags=["papers"], parameters=[INSTITUTE_PARAM])
class PaperQuestionView(TenantScopedMixin, APIView):
    """Describe one question: its text, its solution, what its wrong options mean."""

    permission_classes = CONSOLE_PERMISSIONS

    @extend_schema(
        request=cser.QuestionContentUpdateSerializer,
        responses={
            200: cser.TaggableQuestionSerializer,
            400: VALIDATION_400,
            404: OpenApiResponse(
                response=ser.DetailSerializer,
                description="No such paper in this institute, or no such question on it.",
            ),
        },
    )
    def patch(self, request, pk: int, question_pk: int):
        """Set a question's text and solution, and tag or describe its options.

        Partial: only what is sent changes, and within `options` only the
        labels named. Every problem is reported at once and nothing is written
        unless there are none. Allowed on questions students have already
        answered — a tag changes no one's marks, only what the next diagnosis
        can say. Returns the question as `GET …/questions/` shows it.
        """
        paper = _paper(self.institute_id(), pk)
        question = (
            QuestionTopicMap.objects.filter(
                pk=question_pk, test_paper=paper, institute_id=paper.institute_id
            ).first()
            if paper is not None else None
        )
        if question is None:
            detail = NO_SUCH_PAPER if paper is None else NO_SUCH_QUESTION
            return Response({"detail": detail}, status=status.HTTP_404_NOT_FOUND)

        form = cser.QuestionContentUpdateSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        data = form.validated_data
        edit = tagging.ContentEdit(
            question_text=data.get("question_text", tagging.MISSING),
            solution=data.get("solution", tagging.MISSING),
            options=[
                tagging.OptionEdit(
                    label=item["label"].strip(),
                    text=item.get("text", tagging.MISSING),
                    misconception_code=item.get("misconception_code", tagging.MISSING),
                    draft=item.get("draft_misconception", tagging.MISSING),
                )
                for item in data.get("options", [])
            ],
        )
        try:
            question = tagging.apply_content_edit(question, edit, user=request.user)
        except tagging.ContentRejected as exc:
            return Response(exc.errors, status=status.HTTP_400_BAD_REQUEST)

        fresh = _questions(paper).get(pk=question.pk)
        return Response(cser.TaggableQuestionSerializer(
            tagging.present_question(fresh, _answered(paper, [fresh.question_id]))
        ).data)


# ------------------------------------------------------------- the taxonomy


@extend_schema(
    tags=["misconceptions"],
    parameters=[
        OpenApiParameter(
            "subject", str,
            description=(
                "Only misconceptions of this subject — pass `TaggableQuestion.subject`. "
                "Spellings of one subject match each other: `Botany` and `Zoology` "
                "find `Biology` entries, `Mathematics` finds `Maths`. Blank or "
                "omitted: the whole taxonomy."
            ),
        ),
    ],
)
class MisconceptionListView(generics.ListAPIView):
    """The misconception taxonomy, for the tagging screen's picker.

    Global, not tenant-scoped: every institute shares one curated vocabulary,
    which is what makes a diagnosis comparable across them. Console only —
    the taxonomy is a description of wrong beliefs, and is not shown to
    students. Ordered by subject, then code.
    """

    permission_classes = CONSOLE_PERMISSIONS
    serializer_class = ser.MisconceptionSerializer
    pagination_class = StandardPagination

    def get_queryset(self):
        qs = Misconception.objects.order_by("subject", "code")
        subject = (self.request.query_params.get("subject") or "").strip()
        if subject:
            qs = qs.filter(subject__in=tagging.subjects_matching(subject))
        return qs


# ------------------------------------------------------ key disagreements


REVIEW_STATUS_PARAM = OpenApiParameter(
    "status", str,
    enum=["unreviewed", "reviewed", *(value for value, _ in cser.KEY_REVIEW_DECISIONS)],
    description=(
        "`unreviewed`: still `disagreed`, nobody has decided. `reviewed`: any "
        "decision. Or one decision. Omitted (or anything else): all of them."
    ),
)


def present_disagreement(question: QuestionTopicMap) -> dict:
    reviewer = question.key_reviewed_by
    return {
        "id": question.id,
        "paper_id": question.test_paper_id,
        "paper_name": question.test_paper.name,
        "label": question.question_id,
        "subject": tagging.question_subject(question) or None,
        "answer_type": question.answer_type,
        "question_text": question.question_text,
        "options": [
            {"label": o.label, "text": o.text, "is_correct": o.is_correct}
            for o in question.options.all()
        ],
        "official_answer": question.official_answer,
        "model_answer": question.model_answer,
        "has_diagram": question.has_diagram,
        "verification": question.verification,
        "detail_summary": review.summarise_detail(question),
        "model_working": review.model_working(question),
        "review": {
            "status": review.review_status(question),
            "note": question.key_review_note,
            "reviewed_by": reviewer.get_username() if reviewer is not None else None,
            "reviewed_at": question.key_reviewed_at,
        },
    }


def _disagreements(institute_id):
    return (
        review.disagreements(institute_id)
        .select_related("test_paper", "topic__parent__parent", "key_reviewed_by")
        .prefetch_related("options")
    )


@extend_schema(tags=["review"])
class DisagreementListView(TenantScopedMixin, generics.GenericAPIView):
    """Official questions where the factory's blind solve and the key disagree."""

    permission_classes = CONSOLE_PERMISSIONS
    pagination_class = StandardPagination
    serializer_class = cser.KeyDisagreementSerializer

    @extend_schema(
        parameters=[
            INSTITUTE_PARAM,
            REVIEW_STATUS_PARAM,
            OpenApiParameter("paper", int, description="Only questions on this `TestPaper.id`."),
        ],
        responses=cser.KeyDisagreementSerializer(many=True),
    )
    def get(self, request):
        """The answer-key review queue, oldest paper first, in paper order.

        Every question the cross-check ever disagreed on — reviewed or not —
        so a decision stays visible after it is made. `?status=unreviewed` is
        the queue itself.
        """
        qs = _disagreements(self.institute_id())
        wanted = request.query_params.get("status")
        if wanted == "unreviewed":
            qs = qs.filter(verification=QuestionTopicMap.DISAGREED)
        elif wanted == "reviewed":
            qs = qs.exclude(key_review="")
        elif wanted in {value for value, _ in cser.KEY_REVIEW_DECISIONS}:
            qs = qs.filter(key_review=wanted)
        paper = request.query_params.get("paper")
        if paper:
            qs = qs.filter(test_paper_id=paper) if str(paper).isdigit() else qs.none()
        qs = qs.order_by("test_paper__held_on", "test_paper_id", "id")

        page = self.paginate_queryset(qs)
        rows = page if page is not None else list(qs)
        data = cser.KeyDisagreementSerializer([present_disagreement(q) for q in rows], many=True).data
        return self.get_paginated_response(data) if page is not None else Response(data)


@extend_schema(tags=["review"], parameters=[INSTITUTE_PARAM])
class DisagreementReviewView(TenantScopedMixin, APIView):
    """Record a person's decision on one answer-key disagreement."""

    permission_classes = CONSOLE_PERMISSIONS

    @extend_schema(
        request=cser.DisagreementReviewSerializer,
        responses={
            200: cser.KeyDisagreementSerializer,
            400: OpenApiResponse(response=OpenApiTypes.OBJECT, description="`decision` missing or not one of the three."),
            404: OpenApiResponse(
                response=ser.DetailSerializer,
                description=(
                    "No such question in this institute, or one the cross-check did "
                    "not disagree on — the same body either way."
                ),
            ),
        },
    )
    def post(self, request, question_pk: int):
        """`key_stands`, `key_wrong` or `unclear`, with an optional note.

        Records who decided and when, moves the question's `verification` out
        of `disagreed` (to `key_stands`, `key_wrong` or `key_unclear`), and
        keeps every earlier decision in its history. A later decision
        replaces this one — an `unclear` can become `key_stands` once an
        expert has looked. Returns the updated row.
        """
        question = _disagreements(self.institute_id()).filter(pk=question_pk).first()
        if question is None:
            return Response({"detail": NO_SUCH_DISAGREEMENT}, status=status.HTTP_404_NOT_FOUND)

        form = cser.DisagreementReviewSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        review.record_review(
            question,
            decision=form.validated_data["decision"],
            note=form.validated_data.get("note", ""),
            user=request.user,
        )
        fresh = _disagreements(self.institute_id()).get(pk=question.pk)
        return Response(cser.KeyDisagreementSerializer(present_disagreement(fresh)).data)
