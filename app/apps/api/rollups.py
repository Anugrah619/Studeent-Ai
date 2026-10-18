"""Per-student read models, shared by the console and the student app.

`/api/students/{id}/mock-scores/` and `/api/my/mock-scores/` are one
answer addressed two ways: by id for a mentor, by account for the student.
They live here, once, rather than being copied into both viewsets. The
copy is the dangerous part. A fix to one path — the day `mock-scores`
learned a fourth subject, say — would reach the console and leave the
student app quietly disagreeing with it, and a student comparing their own
screen with what their mentor shows them is the worst place to find that.

Every function takes `institute_id` and `student_id` explicitly and trusts
neither: callers pass the institute from `TenantScopedMixin` and a student
id they have already authorised. Nothing here reads `request.user`.
"""

from __future__ import annotations

import datetime as dt

from django.db.models import Count, OuterRef, Q, Subquery, Sum
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.derived.models import PlanBlock, TopicState
from apps.derived.services import features
from apps.events.models import Attempt, ConfidenceRating, RevisionEvent, StudyLog
from apps.events.services import mock_analysis
from apps.ingestion.models import QuestionTopicMap

from . import serializers as ser

SUBJECTS = ["Physics", "Chemistry", "Maths"]


def day_param(request, name: str = "date") -> dt.date:
    """`?date=YYYY-MM-DD`, defaulting to today in the server's timezone.

    A malformed value is a 400 with a sentence in it. It used to be handed
    straight to the ORM, which raised Django's `ValidationError` — not DRF's,
    so the exception handler did not recognise it and a typo in a query
    string became a 500. Two ways to be wrong, both caught here:
    `parse_date` returns None for text that is not shaped like a date and
    *raises* for text that is shaped like one but is not (`2026-13-45`).
    """
    raw = request.query_params.get(name)
    if not raw:
        return timezone.localdate()
    try:
        parsed = parse_date(raw)
    except ValueError:
        parsed = None
    if parsed is None:
        raise ValidationError({name: "Use a calendar date written YYYY-MM-DD."})
    return parsed


def plan_block_queryset(institute_id: int | None, student_id: int, day: dt.date):
    """One student's plan for one day, in the order they will do it."""
    return (
        PlanBlock.objects.filter(student_id=student_id, institute_id=institute_id, date=day)
        .select_related("topic__parent__parent")
        .order_by("start_time", "id")
    )


def topic_state_queryset(institute_id: int | None, student_id: int, *, weak: bool = False):
    """One student's per-chapter mastery, weakest first.

    Ordered by `mastery` ascending; Postgres sorts NULLs last on an
    ascending sort, so chapters with too little evidence to score sit at
    the end rather than masquerading as the weakest ones.
    """
    qs = (
        TopicState.objects.filter(student_id=student_id, institute_id=institute_id)
        .select_related("topic__parent__parent")
        .order_by("mastery", "id")
    )
    if weak:
        qs = qs.filter(mastery__lt=0.5, mastery__isnull=False)
    return qs


def mock_score_rows(institute_id: int | None, student_id: int) -> list[dict]:
    """Per-subject totals for every paper this student sat, oldest first.

    **Ordered by `held_on` ascending** — the payload is chart-ready in the
    order given, left to right.
    """
    rows = (
        Attempt.objects.filter(student_id=student_id, institute_id=institute_id,
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
    return sorted(papers.values(), key=lambda x: x["held_on"])


def subject_breakdown_rows(institute_id: int | None, student_id: int) -> list[dict]:
    """Study-time share vs marks-lost share. The neglect chart.

    Always exactly three rows, in the fixed order Physics, Chemistry,
    Maths — a subject with no data comes back as zeroes rather than being
    omitted, so the chart's three bars never renumber themselves between
    students.

    `marks_lost_share_pct` is a share of **marks**, computed by
    `features.marks_lost_by_topic` — the same function the
    `subject_imbalance` detector reads, so the flag and this chart cannot
    disagree.
    """
    if institute_id is None:
        return []

    subjects = features.subject_map(institute_id)
    lost_by = features.marks_lost_by_subject(
        features.marks_lost_by_topic(institute_id, [student_id]), subjects
    ).get(student_id, {})
    time_by = features.study_minutes_by_subject(institute_id, [student_id], subjects).get(
        student_id, {}
    )

    att_by, cor_by = {}, {}
    for r in (
        Attempt.objects.filter(student_id=student_id, institute_id=institute_id)
        .values("topic_id")
        .annotate(
            attempted=Count("id", filter=Q(status__in=[Attempt.CORRECT, Attempt.WRONG])),
            correct=Count("id", filter=Q(status=Attempt.CORRECT)),
        )
    ):
        name = subjects.get(r["topic_id"])
        if name:
            att_by[name] = att_by.get(name, 0) + r["attempted"]
            cor_by[name] = cor_by.get(name, 0) + r["correct"]

    t_tot = sum(time_by.values()) or 1
    l_tot = sum(lost_by.values()) or 1
    return [
        {
            "subject": s,
            "time_share_pct": round(time_by.get(s, 0) / t_tot * 100, 1),
            "marks_lost_share_pct": round(lost_by.get(s, 0) / l_tot * 100, 1),
            "accuracy_pct": round(cor_by.get(s, 0) / att_by[s] * 100, 1) if att_by.get(s) else None,
        }
        for s in SUBJECTS
    ]


def marks_lost_response(request, institute_id: int | None, student_id: int) -> Response:
    """Partition lost marks by cause for one paper — or say why it can't.

    The attribution itself lives in `apps.events.services.mock_analysis`;
    it is an engine, not a view, and is also called by the planner and the
    narration layer. This is only the HTTP wrapper around it, shared so the
    two routes agree on what a missing paper and an empty sitting look like.
    """
    raw = request.query_params.get("paper")
    try:
        paper_id = int(raw)
    except (TypeError, ValueError):
        return Response(
            {"detail": "A numeric ?paper=<id> is required."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if institute_id is None:
        return Response({"detail": "No institute in scope."},
                        status=status.HTTP_404_NOT_FOUND)

    data = mock_analysis.analyse_mock(
        institute_id=institute_id,
        student_id=student_id,
        paper_id=paper_id,
        include_questions=request.query_params.get("detail") == "true",
    )
    if data is None:
        return Response(
            {"detail": "No attempts recorded for that student on that paper."},
            status=status.HTTP_404_NOT_FOUND,
        )
    return Response(ser.MarksLostSerializer(data).data)


# ------------------------------------------------- logs, ratings, revisions


def study_log_queryset(institute_id: int | None, student_id: int):
    """One student's self-reported study sessions, most recent first."""
    return (
        StudyLog.objects.filter(student_id=student_id, institute_id=institute_id)
        .select_related("topic")
        .order_by("-ts", "-id")
    )


def confidence_queryset(institute_id: int | None, student_id: int):
    """One student's confidence ratings, newest first. History, not just the latest."""
    return (
        ConfidenceRating.objects.filter(student_id=student_id, institute_id=institute_id)
        .select_related("topic")
        .order_by("-ts", "-id")
    )


def revision_queryset(institute_id: int | None, student_id: int, *, pending: bool = False):
    """Scheduled revisions, soonest first — so anything overdue leads."""
    qs = (
        RevisionEvent.objects.filter(student_id=student_id, institute_id=institute_id)
        .select_related("topic__parent__parent")
        .order_by("scheduled_for", "id")
    )
    return qs.filter(done_at__isnull=True) if pending else qs


# ------------------------------------------------- attempts and questions


def attempt_queryset(
    institute_id: int | None, student_id: int, *, paper: int | None = None,
    status: str | None = None,
):
    """A student's answers, each carrying the id that opens its question.

    `Attempt.question_id` is the label a paper prints (`"Q14"`), unique only
    within one paper, and there is no foreign key from an attempt to the
    question row. The subquery supplies `question_pk` — null where the paper
    has no question content (a label-only mock), which is the honest answer
    and tells the client there is nothing to open.
    """
    question = QuestionTopicMap.objects.filter(
        test_paper_id=OuterRef("test_paper_id"), question_id=OuterRef("question_id")
    ).values("id")[:1]
    qs = (
        Attempt.objects.filter(student_id=student_id, institute_id=institute_id)
        .select_related("topic", "test_paper")
        .annotate(question_pk=Subquery(question))
        .order_by("test_paper_id", "question_id", "id")
    )
    if paper is not None:
        qs = qs.filter(test_paper_id=paper)
    if status:
        qs = qs.filter(status=status)
    return qs


def attach_answer(question, student, institute_id: int | None):
    """Decorate a question with how one student answered it. Returns the attempt.

    Shared by the console's `?student=` view and the student's own review so
    the two agree on what "as this student answered it" means: the newest
    attempt on that (paper, question), the option they picked, and `chosen` on
    each option. With no student, every one of those is null — "not asked",
    which is not the same as "not chosen".
    """
    attempt = None
    if student is not None:
        attempt = (
            Attempt.objects
            .filter(student=student, institute_id=institute_id,
                    test_paper_id=question.test_paper_id,
                    question_id=question.question_id)
            .order_by("-ts", "-id")
            .first()
        )

    chosen = (attempt.chosen_option or None) if attempt else None
    question.student_id = student.id if student else None
    question.chosen_label = chosen
    question.status = attempt.status if attempt else None
    question.marks = attempt.marks if attempt else None
    question.time_spent = attempt.time_spent if attempt else None

    # `None` rather than `False` when no student was named. The two render
    # differently and must: `False` on every option says "they answered
    # nothing", which would be a claim we were never asked to make.
    for option in question.options.all():
        option.chosen = None if student is None else option.label == chosen
    return attempt
