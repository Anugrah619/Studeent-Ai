"""`POST /api/my/plan/explain/` — a day's plan in two or three sentences.

THE PROMISE
    Always a 200. Explaining a plan must never block the plan, so when the
    model is unavailable, failing, or over budget the answer is a fixed
    summary built from the blocks' own reasons, with `available: false` —
    never a 429 or a 503.

    Cached on the plan's *content*: asking again, ticking a block, or seeing
    the same plan on another day costs nothing; a different plan is a new
    explanation. No student ref and no date go to the model.
"""

from __future__ import annotations

import datetime as dt
from types import SimpleNamespace

import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from apps.derived.models import PlanBlock
from apps.reasoning.models import ReasoningTrace
from apps.reasoning.services import guidance
from tests import factories as f
from tests.guidance_support import (
    ApiError,
    RecordingGemini,
    find_pii,
    identifiers,
    login,
    use,
)

pytestmark = [pytest.mark.django_db, pytest.mark.usefixtures("fast_password_hasher")]

TODAY = timezone.localdate()
SUMMARY = {"summary": "This plan starts with your overdue Thermodynamics revision."}


@pytest.fixture
def world(cohort):
    aarav = f.make_student(cohort, "Aarav Mehta", roll_no="R7741")
    bhavna = f.make_student(cohort, "Bhavna Rao", roll_no="R7742")
    return SimpleNamespace(
        cohort=cohort, aarav=aarav, bhavna=bhavna,
        thermo=cohort.chapter("Thermodynamics"), hydro=cohort.chapter("Hydrocarbons"),
        limits=cohort.chapter("Limits"),
        a=login(f.make_student_user(aarav, "aarav")),
        b=login(f.make_student_user(bhavna, "bhavna")),
        mentor=login(f.make_mentor_user(cohort, "mentor-p")),
    )


def plan(w, student=None, day=TODAY):
    student = student or w.aarav
    return [
        f.PlanBlockFactory(student=student, topic=w.thermo, date=day, mode="revise",
                           minutes=30, reason_text="Revision 1 was due 2 days ago"),
        f.PlanBlockFactory(student=student, topic=w.hydro, date=day, mode="practice",
                           minutes=45, reason_text="One of your weakest chapters: 30% over 10 questions"),
        f.PlanBlockFactory(student=student, topic=w.limits, date=day, mode="learn",
                           minutes=60, reason_text="Taught in class yesterday, and you have not attempted it yet"),
    ]


def explain(client, **body):
    response = client.post("/api/my/plan/explain/", body, format="json")
    assert response.status_code == 200, response.content
    return response.json()


DETERMINISTIC = (
    "Today's plan has 3 blocks, 135 minutes in all. First, revise Thermodynamics "
    "(revision 1 was due 2 days ago). Then practise Hydrocarbons and start Limits."
)


# ============================================================ always a 200


def test_no_plan_is_said_plainly(world, monkeypatch):
    client = RecordingGemini(SUMMARY)
    use(monkeypatch, client)
    assert explain(world.a) == {
        "date": TODAY.isoformat(),
        "summary": "There is nothing on your plan for today yet.",
        "available": False, "from_cache": False,
    }
    assert client.calls == [], "there was nothing to explain"


def test_without_the_model_the_reasons_still_explain_it(world, monkeypatch):
    use(monkeypatch, None)                         # no key
    plan(world)
    assert explain(world.a) == {
        "date": TODAY.isoformat(), "summary": DETERMINISTIC,
        "available": False, "from_cache": False,
    }


def test_google_down_is_the_same_answer_and_a_cool_down(world, monkeypatch):
    client = RecordingGemini(ApiError(503, "busy"))
    use(monkeypatch, client)
    plan(world)
    assert explain(world.a)["summary"] == DETERMINISTIC
    spent = len(client.calls)
    assert explain(world.a)["available"] is False
    assert len(client.calls) == spent, "a reload during an outage spent quota again"


def test_over_budget_is_the_fixed_summary_never_a_429(world, monkeypatch):
    client = RecordingGemini(SUMMARY)
    use(monkeypatch, client)
    monkeypatch.setitem(ScopedRateThrottle.THROTTLE_RATES, "plan_explain", "1/day")
    blocks = plan(world)
    assert explain(world.a)["available"] is True                 # the one live call

    PlanBlock.objects.filter(pk=blocks[2].pk).delete()            # a different plan
    again = explain(world.a)
    assert again["available"] is False and len(client.calls) == 1
    assert again["summary"].startswith("Today's plan has 2 blocks, 75 minutes")


def test_an_empty_model_summary_is_the_fixed_one(world, monkeypatch):
    use(monkeypatch, RecordingGemini({"summary": "   "}))
    plan(world)
    body = explain(world.a)
    assert body["available"] is False and body["summary"] == DETERMINISTIC


# =================================================================== the model


def test_the_model_explains_it_from_the_reasons(world, monkeypatch):
    client = RecordingGemini(SUMMARY)
    use(monkeypatch, client)
    plan(world)
    assert explain(world.a) == {
        "date": TODAY.isoformat(), "summary": SUMMARY["summary"],
        "available": True, "from_cache": False,
    }
    [call] = client.calls
    assert call["system_prompt"] == guidance.PLAN_SYSTEM_PROMPT
    assert [b["reason"] for b in call["payload"]["blocks"]] == [
        "Revision 1 was due 2 days ago",
        "One of your weakest chapters: 30% over 10 questions",
        "Taught in class yesterday, and you have not attempted it yet",
    ]
    assert call["payload"]["total_minutes"] == 135
    trace = ReasoningTrace.objects.get(task=ReasoningTrace.EXPLAIN_PLAN)
    assert trace.student_id == world.aarav.id


def test_the_payload_is_the_plans_content_and_nothing_about_who(world, monkeypatch):
    client = RecordingGemini(SUMMARY)
    use(monkeypatch, client)
    plan(world)
    explain(world.a)
    payload = client.calls[0]["payload"]
    assert set(payload) == {"blocks", "total_minutes"}
    assert set(payload["blocks"][0]) == {"order", "chapter", "subject", "mode", "minutes", "reason"}
    body = client.calls[0]["body"]
    assert f"S-{world.aarav.id}" not in body and TODAY.isoformat() not in body


def test_a_name_in_a_reason_does_not_leave(world, monkeypatch):
    """Structural: the planner writing a name into a reason would not leak it."""
    w = world
    client = RecordingGemini(SUMMARY)
    use(monkeypatch, client)
    f.PlanBlockFactory(student=w.aarav, topic=w.thermo, reason_text="Aarav Mehta (R7741) asked")
    explain(w.a)
    assert find_pii(client.calls[0]["payload"], identifiers(w.aarav, w.cohort)) == []
    assert client.calls[0]["payload"]["blocks"][0]["reason"] == "[name] ([roll number]) asked"


# ===================================================================== caching


def test_asking_again_and_ticking_a_block_cost_nothing(world, monkeypatch):
    use(monkeypatch, RecordingGemini(SUMMARY))
    blocks = plan(world)
    explain(world.a)

    later = RecordingGemini({"summary": "A DIFFERENT SUMMARY"})
    use(monkeypatch, later)
    assert explain(world.a)["from_cache"] is True
    world.a.post(f"/api/my/plan/{blocks[0].id}/complete/")
    replay = explain(world.a)
    assert replay["summary"] == SUMMARY["summary"] and replay["from_cache"] is True
    assert later.calls == []


def test_a_different_plan_is_a_new_explanation(world, monkeypatch):
    client = RecordingGemini(SUMMARY, {"summary": "A SECOND PLAN"})
    use(monkeypatch, client)
    blocks = plan(world)
    explain(world.a)
    PlanBlock.objects.filter(pk=blocks[1].pk).update(reason_text="Something else now")
    assert explain(world.a)["summary"] == "A SECOND PLAN"
    assert len(client.calls) == 2


def test_the_same_plan_on_another_day_is_the_same_explanation(world, monkeypatch):
    use(monkeypatch, RecordingGemini(SUMMARY))
    plan(world, day=TODAY)
    plan(world, day=TODAY + dt.timedelta(days=1))
    explain(world.a)
    later = RecordingGemini({"summary": "UNUSED"})
    use(monkeypatch, later)
    tomorrow = (TODAY + dt.timedelta(days=1)).isoformat()
    assert explain(world.a, date=tomorrow)["from_cache"] is True
    assert later.calls == []


# ===================================================================== the day


def test_another_day_is_named_in_the_fixed_summary(world, monkeypatch):
    use(monkeypatch, None)
    tomorrow = TODAY + dt.timedelta(days=1)
    plan(world, day=tomorrow)
    body = explain(world.a, date=tomorrow.isoformat())
    assert body["date"] == tomorrow.isoformat()
    assert body["summary"].startswith("Tomorrow's plan has 3 blocks")


def test_a_far_day_is_written_out(world, monkeypatch):
    use(monkeypatch, None)
    day = TODAY + dt.timedelta(days=5)
    body = explain(world.a, date=day.isoformat())
    assert body["summary"] == (
        f"There is nothing on your plan for {day:%A} {day.day} {day:%B} yet."
    )


@pytest.mark.parametrize("bad", ["garbage", "2026-13-45", "24/10/2026"])
def test_a_bad_date_is_a_400(world, bad):
    response = world.a.post("/api/my/plan/explain/", {"date": bad}, format="json")
    assert response.status_code == 400 and "date" in response.json()


# ===================================================================== the wall


def test_only_my_blocks_are_explained(world, monkeypatch):
    client = RecordingGemini(SUMMARY)
    use(monkeypatch, client)
    plan(world, student=world.bhavna)
    assert explain(world.a)["summary"] == "There is nothing on your plan for today yet."
    assert client.calls == []


@pytest.mark.parametrize("who", ["mentor", "anonymous"])
def test_explaining_is_for_students_only(world, who):
    client = world.mentor if who == "mentor" else APIClient()
    assert client.post("/api/my/plan/explain/", {}, format="json").status_code == 403
