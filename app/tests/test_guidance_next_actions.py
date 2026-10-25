"""`next_actions` — what a student should do next, by rule, with no model.

WHAT IS UNDER TEST
    Six rules, each read from the student's own data, and the order they are
    ranked in (`guidance.py`, "1 · next actions"). Each rule is tested for
    firing *and* for staying quiet, because a nudge that cannot be silenced
    is noise, and the student stops reading the list.

    And the wall, as everywhere under `/api/my/`: a classmate's plan,
    revisions, weak chapters and logs never shape my list.
"""

from __future__ import annotations

import datetime as dt
from types import SimpleNamespace

import pytest
from django.utils import timezone

from apps.derived.models import TopicState
from apps.reasoning.services import guidance
from tests import factories as f
from tests.guidance_support import RecordingGemini, login, use

pytestmark = [pytest.mark.django_db, pytest.mark.usefixtures("fast_password_hasher")]

TODAY = timezone.localdate()


@pytest.fixture
def world(cohort):
    aarav = f.make_student(cohort, "Aarav Mehta", roll_no="R7741")
    bhavna = f.make_student(cohort, "Bhavna Rao", roll_no="R7742")
    return SimpleNamespace(
        cohort=cohort, aarav=aarav, bhavna=bhavna,
        thermo=cohort.chapter("Thermodynamics"),
        hydro=cohort.chapter("Hydrocarbons"),
        kin=cohort.chapter("Kinematics"),
        a=login(f.make_student_user(aarav, "aarav")),
        b=login(f.make_student_user(bhavna, "bhavna")),
        mentor=login(f.make_mentor_user(cohort, "mentor-n")),
    )


def mastery(student, topic, value, attempts=10):
    return TopicState.objects.create(
        institute_id=student.institute_id, student=student, topic=topic,
        mastery=value, attempts_n=attempts, correct_n=round((value or 0) * attempts),
    )


def actions(student) -> list[dict]:
    return guidance.next_actions(student)


def kinds(student) -> list[str]:
    return [a["kind"] for a in actions(student)]


def by_kind(student, kind) -> dict | None:
    return next((a for a in actions(student) if a["kind"] == kind), None)


def logged(student, topic, days_ago: float):
    return f.study(student, topic, 40, timezone.now() - dt.timedelta(days=days_ago))


# ================================================================== the ranking


def test_a_new_student_is_only_asked_to_log_study(world):
    """Nothing to plan, revise, recover or rate — so nothing is invented."""
    assert actions(world.aarav) == [{
        "kind": "log_study",
        "title": "Log what you study",
        "detail": "Nothing is logged yet. A quick log after each session lets your "
                  "plan fit the time you really have.",
        "target": "study-log",
    }]


def test_the_ranking_is_fixed_and_the_list_stops_at_five(world):
    """All six rules fire; the cheapest nudge is the one that waits."""
    w = world
    f.PlanBlockFactory(student=w.aarav, topic=w.thermo, mode="revise", minutes=30,
                       reason_text="Revision 1 was due 2 days ago")
    f.revision(w.aarav, w.thermo, 1, TODAY - dt.timedelta(days=2))
    paper = f.make_paper(w.cohort, "Mock 15", TODAY - dt.timedelta(days=6))
    f.record(w.aarav, w.kin, "ccnnn", paper=paper)
    mastery(w.aarav, w.hydro, 0.3)                       # weak, never rated

    assert kinds(w.aarav) == [
        "start_plan", "revisions_due", "mock_recoverable", "weak_chapter", "log_study",
    ]
    assert guidance.MAX_NEXT_ACTIONS == 5

    # Log a session and the sixth rule moves up into the space it left.
    logged(w.aarav, w.hydro, days_ago=1)
    assert kinds(w.aarav) == [
        "start_plan", "revisions_due", "mock_recoverable", "weak_chapter", "rate_confidence",
    ]


def test_the_published_enum_is_in_ranking_order():
    """The contract documents the order through the enum; keep them one list."""
    assert [k for k, _ in guidance.NEXT_ACTION_KINDS] == [
        "start_plan", "make_plan", "revisions_due", "mock_recoverable",
        "weak_chapter", "log_study", "rate_confidence",
    ]


# ========================================================================= plan


def test_an_untouched_plan_says_what_comes_first_and_why(world):
    w = world
    f.PlanBlockFactory(student=w.aarav, topic=w.thermo, minutes=30, mode="revise",
                       reason_text="Revision 1 was due 2 days ago")
    f.PlanBlockFactory(student=w.aarav, topic=w.hydro, minutes=45)
    assert by_kind(w.aarav, "start_plan") == {
        "kind": "start_plan",
        "title": "Start today's plan",
        "detail": "2 blocks, 75 minutes. First up: Thermodynamics — Revision 1 was due 2 days ago.",
        "target": "plan",
    }


def test_a_plan_with_any_tick_has_been_started(world):
    w = world
    f.PlanBlockFactory(student=w.aarav, topic=w.thermo)
    f.PlanBlockFactory(student=w.aarav, topic=w.hydro, completed=True)
    assert by_kind(w.aarav, "start_plan") is None


def test_yesterdays_plan_is_not_todays(world):
    f.PlanBlockFactory(student=world.aarav, topic=world.thermo,
                       date=TODAY - dt.timedelta(days=1))
    assert by_kind(world.aarav, "start_plan") is None


def test_no_plan_with_work_to_plan_suggests_making_one(world):
    f.revision(world.aarav, world.thermo, 1, TODAY)
    action = actions(world.aarav)[0]
    assert action["kind"] == "make_plan" and action["target"] == "plan"


def test_no_plan_and_nothing_to_plan_is_not_a_nag(world):
    """A student with nothing due and nothing weak would press "make plan"
    and get an empty day. The nudge is withheld rather than sent there."""
    mastery(world.aarav, world.thermo, 0.8)              # measured, not weak
    assert "make_plan" not in kinds(world.aarav)


# ==================================================================== revisions


def test_one_revision_due_today(world):
    f.revision(world.aarav, world.thermo, 1, TODAY)
    assert by_kind(world.aarav, "revisions_due") == {
        "kind": "revisions_due",
        "title": "Revise Thermodynamics",
        "detail": "Revision 1 is due today. Revising on time stops it fading.",
        "target": "revisions",
    }


def test_several_due_lead_with_the_most_overdue(world):
    w = world
    f.revision(w.aarav, w.thermo, 1, TODAY - dt.timedelta(days=1))
    f.revision(w.aarav, w.hydro, 2, TODAY - dt.timedelta(days=5))
    f.revision(w.aarav, w.kin, 1, TODAY + dt.timedelta(days=2))          # not yet due
    f.revision(w.aarav, w.kin, 2, TODAY - dt.timedelta(days=9),
               done_at=timezone.now())                                      # done
    f.revision(w.bhavna, w.kin, 1, TODAY - dt.timedelta(days=20))        # not mine
    action = by_kind(w.aarav, "revisions_due")
    assert action["title"] == "2 revisions are due"
    assert action["detail"] == "Start with Hydrocarbons: revision 2 was due 5 days ago."


def test_nothing_due_is_nothing_said(world):
    f.revision(world.aarav, world.thermo, 1, TODAY + dt.timedelta(days=1))
    assert by_kind(world.aarav, "revisions_due") is None


# ========================================================================= mocks


def test_marks_that_went_to_the_clock(world):
    """The brief's own example, shape for shape: "N marks on Mock 15 went to
    the clock". Three questions not reached at 4 marks each."""
    paper = f.make_paper(world.cohort, "Mock 15", TODAY - dt.timedelta(days=3))
    f.record(world.aarav, world.kin, "ccnnn", paper=paper)
    assert by_kind(world.aarav, "mock_recoverable") == {
        "kind": "mock_recoverable",
        "title": "12 marks on Mock 15 went to the clock",
        "detail": "You did not reach 3 questions. Timed practice on one section at a "
                  "time wins these back without learning anything new.",
        "target": {"mock": paper.id},
    }


def test_the_biggest_recoverable_cause_leads_and_the_total_follows(world):
    """Two slips in a chapter he knows (5 marks each) outweigh one unreached
    question (4). The other recoverable marks are still counted in."""
    w = world
    mastery(w.aarav, w.thermo, 0.9)                     # known: a wrong answer is a slip
    paper = f.make_paper(w.cohort, "Mock 15", TODAY - dt.timedelta(days=3))
    f.record(w.aarav, w.thermo, "wwcc", paper=paper, question_prefix="T")
    f.record(w.aarav, w.kin, "n", paper=paper, question_prefix="K")
    action = by_kind(w.aarav, "mock_recoverable")
    assert action["title"] == "10 marks on Mock 15 were slips"
    assert action["detail"] == (
        "2 questions went wrong in chapters you usually get right. Go back over them "
        "to see where each one slipped. In all, 14 of the marks you lost on this "
        "paper needed no new learning."
    )


def test_only_the_latest_mock_is_read(world):
    w = world
    old = f.make_paper(w.cohort, "Mock 14", TODAY - dt.timedelta(days=30))
    new = f.make_paper(w.cohort, "Mock 15", TODAY - dt.timedelta(days=3))
    f.record(w.aarav, w.kin, "nnnn", paper=old)
    f.record(w.aarav, w.kin, "cccc", paper=new)
    assert by_kind(w.aarav, "mock_recoverable") is None


def test_marks_lost_to_a_real_gap_are_not_called_recoverable(world):
    """Wrong in a chapter he is weak at is a gap, not a slip — no action."""
    w = world
    mastery(w.aarav, w.thermo, 0.2)
    paper = f.make_paper(w.cohort, "Mock 15", TODAY - dt.timedelta(days=3))
    f.record(w.aarav, w.thermo, "wwww", paper=paper)
    assert by_kind(w.aarav, "mock_recoverable") is None


def test_a_mock_only_a_classmate_sat_is_not_mine(world):
    paper = f.make_paper(world.cohort, "Mock 15", TODAY - dt.timedelta(days=3))
    f.record(world.bhavna, world.kin, "nnnn", paper=paper)
    assert by_kind(world.aarav, "mock_recoverable") is None


# ================================================================ weak chapters


def test_the_weakest_measured_chapter(world):
    w = world
    mastery(w.aarav, w.hydro, 0.45)
    mastery(w.aarav, w.thermo, 0.33, attempts=6)
    mastery(w.aarav, w.kin, None, attempts=2)           # unmeasured is not weak
    assert by_kind(w.aarav, "weak_chapter") == {
        "kind": "weak_chapter",
        "title": "Practise Thermodynamics",
        "detail": "Your weakest chapter so far: 33% over 6 questions.",
        "target": "topics",
    }


def test_half_is_the_line_and_it_is_not_weak(world):
    mastery(world.aarav, world.thermo, 0.5)
    assert by_kind(world.aarav, "weak_chapter") is None


# ===================================================================== logging


def test_a_session_logged_in_the_last_three_days_silences_the_nudge(world):
    logged(world.aarav, world.thermo, days_ago=2.5)
    assert by_kind(world.aarav, "log_study") is None


def test_a_lapse_says_how_long(world):
    logged(world.aarav, world.thermo, days_ago=5)
    assert by_kind(world.aarav, "log_study") == {
        "kind": "log_study",
        "title": "Log your recent study",
        "detail": "Your last logged session was 5 days ago. If you have studied since, "
                  "add it so your plan fits your real day.",
        "target": "study-log",
    }


def test_a_classmates_logging_does_not_count_as_mine(world):
    logged(world.bhavna, world.thermo, days_ago=0)
    assert by_kind(world.aarav, "log_study")["title"] == "Log what you study"


# ================================================================== confidence


def test_weak_chapters_never_rated_are_named(world):
    w = world
    mastery(w.aarav, w.thermo, 0.3)
    mastery(w.aarav, w.hydro, 0.4)
    f.rate(w.aarav, w.hydro, 4)
    f.rate(w.bhavna, w.thermo, 2)                       # hers, not his
    logged(w.aarav, w.kin, days_ago=0)
    assert by_kind(w.aarav, "rate_confidence") == {
        "kind": "rate_confidence",
        "title": "How sure are you about Thermodynamics?",
        "detail": "Say how sure you feel about Thermodynamics. Setting that beside "
                  "your scores shows where practice will help most.",
        "target": "confidence",
    }


def test_several_unrated_are_counted(world):
    w = world
    for topic in (w.thermo, w.hydro, w.kin):
        mastery(w.aarav, topic, 0.3)
    logged(w.aarav, w.kin, days_ago=0)
    action = by_kind(w.aarav, "rate_confidence")
    assert action["title"] == "Rate your confidence in 3 chapters"


def test_every_weak_chapter_rated_is_nothing_to_ask(world):
    mastery(world.aarav, world.thermo, 0.3)
    f.rate(world.aarav, world.thermo, 2)
    assert by_kind(world.aarav, "rate_confidence") is None


# ===================================================================== the wall


def test_a_classmates_data_never_shapes_my_list(world):
    w = world
    f.PlanBlockFactory(student=w.bhavna, topic=w.thermo)
    f.revision(w.bhavna, w.thermo, 1, TODAY - dt.timedelta(days=3))
    mastery(w.bhavna, w.thermo, 0.1)
    assert kinds(w.aarav) == ["log_study"]


# ===================================================================== the route


def test_the_route_returns_my_actions_and_calls_no_model(world, monkeypatch):
    w = world
    client = RecordingGemini()
    use(monkeypatch, client)
    f.revision(w.aarav, w.thermo, 1, TODAY - dt.timedelta(days=1))
    mastery(w.aarav, w.hydro, 0.3)

    body = w.a.get("/api/my/guidance/").json()
    assert body["next_actions"] == guidance.next_actions(w.aarav)
    assert body["findings"] == []
    assert client.calls == [], "next actions are rules; nothing here may reach a model"


@pytest.mark.parametrize("who", ["mentor", "anonymous"])
def test_guidance_is_for_students_only(world, who):
    from rest_framework.test import APIClient

    client = world.mentor if who == "mentor" else APIClient()
    assert client.get("/api/my/guidance/").status_code == 403
