"""The day planner: rules over state, and what the endpoint does with them.

The rules are a pure function (`build_plan`), so most tests here need no
database and say in one line what a student's day should look like given what
the system knows. The endpoint tests then check only what the function cannot:
that it is idempotent, that regeneration never erases a tick, and who may ask.
"""

from __future__ import annotations

import csv
import datetime as dt
import io

import pytest
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.derived.models import PlanBlock, TopicState
from apps.derived.services import planner
from apps.derived.services.planner import (
    ChapterFact, PlanInputs, RevisionFact, build_plan, budget_from_logs,
)
from apps.events.models import ChapterStatus
from apps.tenancy.models import Student, User
from tests import factories as f

pytestmark = pytest.mark.usefixtures("fast_password_hasher")

DAY = dt.date(2026, 10, 15)
LONG_AGO = dt.date(2026, 8, 1)


def chapter(tid, name="Chapter", *, mastery=None, attempts=0, taught=LONG_AGO, weight=4.0):
    return ChapterFact(tid, name, weight, mastery, attempts, taught)


def revision(tid, cycle=1, days_late=2, name="Chapter"):
    return RevisionFact(tid, name, cycle, DAY - dt.timedelta(days=days_late))


def plan(chapters=(), revisions=(), budget=360, already=()):
    return build_plan(PlanInputs(
        day=DAY, budget=budget, chapters=list(chapters), revisions=list(revisions),
        already_planned=set(already),
    ))


def modes(specs):
    return [s.mode for s in specs]


# ------------------------------------------------------------ the three rules


def test_revisions_come_first_then_the_weakest_chapters_then_something_new():
    specs = plan(
        chapters=[
            chapter(1, "Weak", mastery=0.2, attempts=8),
            chapter(2, "Fresh", attempts=0),
        ],
        revisions=[revision(3, name="Due")],
    )
    assert modes(specs) == ["revise", "practice", "learn"]
    assert [s.topic_id for s in specs] == [3, 1, 2]


def test_nothing_to_go_on_means_an_empty_plan_not_an_invented_one():
    assert plan() == []
    assert plan(chapters=[chapter(1, mastery=0.9, attempts=20)]) == []   # strong, and attempted


def test_at_most_two_revisions_most_overdue_first():
    specs = plan(revisions=[
        revision(1, days_late=1), revision(2, days_late=9), revision(3, days_late=5),
    ])
    assert [s.topic_id for s in specs] == [2, 3]


def test_a_revision_scheduled_for_the_future_is_not_planned_today():
    assert plan(revisions=[revision(1, days_late=-3)]) == []


def test_a_revision_due_today_is_planned_and_says_so():
    (spec,) = plan(revisions=[revision(1, cycle=2, days_late=0)])
    assert spec.reason_code == "revision_r2"
    assert spec.reason_text == "Revision 2 is due today"


def test_overdue_revision_reason_counts_the_days():
    three, one = plan(revisions=[revision(1, days_late=1), revision(2, days_late=3)])
    assert three.reason_text == "Revision 1 was due 3 days ago"       # most overdue leads
    assert one.reason_text == "Revision 1 was due 1 day ago"


def test_practice_is_the_weakest_taught_chapters_with_measured_mastery_only():
    specs = plan(chapters=[
        chapter(1, "Mid", mastery=0.45, attempts=10),
        chapter(2, "Worst", mastery=0.10, attempts=10),
        chapter(3, "Fine", mastery=0.80, attempts=10),            # not weak
        chapter(4, "Unmeasured", mastery=None, attempts=2),       # below the evidence floor
        chapter(5, "Not taught", mastery=0.05, attempts=10, taught=None),
        chapter(6, "Taught tomorrow", mastery=0.05, attempts=10, taught=DAY + dt.timedelta(days=1)),
    ])
    assert [s.topic_id for s in specs] == [2, 1]
    assert all(s.mode == "practice" and s.reason_code == "weak_topic" for s in specs)


def test_unmeasured_mastery_is_never_treated_as_weak():
    """Null is "not enough attempts to say", not zero. A plan that drilled
    every chapter a new student had barely touched would be a crisis plan for
    a student who has done nothing wrong."""
    assert plan(chapters=[chapter(1, mastery=None, attempts=3)]) == []


def test_practice_at_most_two_ties_broken_by_weight():
    specs = plan(chapters=[
        chapter(1, "A", mastery=0.3, attempts=8, weight=2.0),
        chapter(2, "B", mastery=0.3, attempts=8, weight=9.0),
        chapter(3, "C", mastery=0.3, attempts=8, weight=5.0),
    ])
    assert [s.topic_id for s in specs] == [2, 3]


def test_practice_reason_states_the_evidence():
    (spec,) = plan(chapters=[chapter(1, mastery=0.333, attempts=12)])
    assert "33%" in spec.reason_text and "12 questions" in spec.reason_text


def test_a_chapter_with_a_due_revision_is_not_also_practised_today():
    specs = plan(
        chapters=[chapter(1, mastery=0.1, attempts=9)],
        revisions=[revision(1)],
    )
    assert [(s.topic_id, s.mode) for s in specs] == [(1, "revise")]


def test_learn_is_one_taught_chapter_never_attempted_earliest_first():
    specs = plan(chapters=[
        chapter(1, "Newer", attempts=0, taught=dt.date(2026, 10, 1)),
        chapter(2, "Older", attempts=0, taught=dt.date(2026, 9, 1)),
        chapter(3, "Not taught", attempts=0, taught=None),
        chapter(4, "Started", attempts=3, taught=dt.date(2026, 8, 1), mastery=None),
    ])
    assert [(s.topic_id, s.mode) for s in specs] == [(2, "learn")]


@pytest.mark.parametrize("taught, phrase", [
    (DAY, "today"),
    (DAY - dt.timedelta(days=1), "yesterday"),
    (DAY - dt.timedelta(days=6), "6 days ago"),
])
def test_learn_reason_says_when_it_was_taught(taught, phrase):
    (spec,) = plan(chapters=[chapter(1, attempts=0, taught=taught)])
    assert phrase in spec.reason_text


def test_a_chapter_already_on_the_plan_is_not_planned_again():
    specs = plan(chapters=[chapter(1, mastery=0.1, attempts=9), chapter(2, mastery=0.2, attempts=9)],
                 already=[1])
    assert [s.topic_id for s in specs] == [2]


# ---------------------------------------------------------------- the budget


def test_the_plan_never_exceeds_the_budget():
    specs = plan(
        chapters=[chapter(1, mastery=0.1, attempts=9), chapter(2, attempts=0)],
        revisions=[revision(3), revision(4)],
        budget=100,
    )
    assert sum(s.minutes for s in specs) <= 100
    assert [s.mode for s in specs] == ["revise", "revise"]       # 60; a 45 would make 105


def test_a_block_that_does_not_fit_is_dropped_not_squeezed():
    (spec,) = plan(chapters=[chapter(1, mastery=0.1, attempts=9)], budget=60)
    assert spec.minutes == planner.MINUTES["practice"] == 45


def test_a_smaller_block_can_still_fit_after_a_larger_one_is_dropped():
    specs = plan(
        chapters=[chapter(1, mastery=0.1, attempts=9), chapter(2, mastery=0.2, attempts=9)],
        revisions=[revision(3)],
        budget=80,                    # revise 30 + practice 45 = 75; a second practice would be 120
    )
    assert [s.mode for s in specs] == ["revise", "practice"]


@pytest.mark.parametrize("logged, expected", [
    ([], planner.DEFAULT_BUDGET),
    ([200, 200], planner.DEFAULT_BUDGET),                         # two days is not a habit
    ([120, 130, 140, 150], 135),
    ([60, 30, 45, 20], planner.MIN_BUDGET),                       # clamped up
    ([900, 800, 700, 1000], planner.MAX_BUDGET),                  # clamped down
    ([100, 100, 100, 100, 1200], 100),                            # one huge day does not move a median
])
def test_the_budget_is_what_the_student_actually_logs(logged, expected):
    assert budget_from_logs(logged) == expected




@pytest.mark.parametrize("mastery, planned", [
    (0.0, True), (0.49, True), (0.5, False), (0.6, False), (0.95, False),
])
def test_the_weak_line_is_exactly_half_and_strict(mastery, planned):
    """The cap of two blocks hides a threshold that has drifted: with only
    two weak chapters, a line at 0.9 plans the same two. One chapter at a time
    pins the line itself — and 0.5 is "not weak", matching `?weak=true`."""
    specs = plan(chapters=[chapter(1, mastery=mastery, attempts=10)])
    assert bool(specs) is planned
# ------------------------------------------------------------ the endpoint


@pytest.fixture
def pupil(cohort):
    """A student with evidence: one weak taught chapter, one fresh taught
    chapter, an overdue revision, and a login."""
    s = f.make_student(cohort, "Aarav Mehta", roll_no="A-1041")
    weak, fresh = cohort.chapter("Thermodynamics"), cohort.chapter("Kinematics")
    TopicState.objects.create(institute=cohort.institute, student=s, topic=weak,
                              mastery=0.25, attempts_n=12, correct_n=3)
    ChapterStatus.objects.create(institute=cohort.institute, batch=cohort.batch, topic=weak,
                                 taught_at=LONG_AGO)
    ChapterStatus.objects.create(institute=cohort.institute, batch=cohort.batch, topic=fresh,
                                 taught_at=timezone.localdate() - dt.timedelta(days=2))
    due = f.revision(s, cohort.chapter("Limits"), 1, timezone.localdate() - dt.timedelta(days=4))
    client = APIClient()
    client.force_login(f.make_student_user(s, "aarav"))
    return type("Pupil", (), dict(cohort=cohort, student=s, client=client, weak=weak,
                                  fresh=fresh, due=due))


def generate(client, **body):
    return client.post("/api/my/plan/generate/", body, format="json")


def test_generating_makes_a_plan_in_rule_order_with_reasons(pupil):
    response = generate(pupil.client)
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["generated"] is True and body["date"] == str(timezone.localdate())
    assert [b["mode"] for b in body["blocks"]] == ["revise", "practice", "learn"]
    assert [b["topic_name"] for b in body["blocks"]] == ["Limits", "Thermodynamics", "Kinematics"]
    assert all(b["reason_text"] for b in body["blocks"])
    assert all(b["start_time"] is None for b in body["blocks"])          # no invented times
    assert body["blocks"][1]["reason_text"].startswith("One of your weakest chapters: 25%")
    # …and it is the plan the rest of the API shows.
    listed = pupil.client.get("/api/my/plan/").json()["results"]
    assert [b["id"] for b in listed] == [b["id"] for b in body["blocks"]]


def test_generating_twice_is_the_same_plan_not_two(pupil):
    first = generate(pupil.client).json()["blocks"]
    again = generate(pupil.client)
    assert again.status_code == 200 and again.json()["generated"] is False
    assert [b["id"] for b in again.json()["blocks"]] == [b["id"] for b in first]
    assert PlanBlock.objects.filter(student=pupil.student).count() == len(first)


def test_a_new_student_with_nothing_to_plan_gets_an_honest_empty_answer(cohort):
    s = f.make_student(cohort, "Newcomer", roll_no="N-1")
    client = APIClient()
    client.force_login(f.make_student_user(s, "newcomer"))
    response = generate(client)
    assert response.status_code == 200
    assert response.json() == {"date": str(timezone.localdate()), "generated": False, "blocks": []}


def test_regenerating_keeps_what_i_ticked_and_does_not_plan_it_twice(pupil):
    blocks = generate(pupil.client).json()["blocks"]
    practised = next(b for b in blocks if b["mode"] == "practice")
    pupil.client.post(f"/api/my/plan/{practised['id']}/complete/")

    # The student gets stronger: the chapter is no longer weak. A rebuild must
    # still not delete the tick, nor schedule that chapter a second time.
    TopicState.objects.filter(student=pupil.student).update(mastery=0.95)
    rebuilt = generate(pupil.client, replace=True).json()["blocks"]

    assert practised["id"] in [b["id"] for b in rebuilt], "a ticked block was erased"
    assert next(b for b in rebuilt if b["id"] == practised["id"])["completed"] is True
    assert [b["topic_name"] for b in rebuilt].count("Thermodynamics") == 1
    # …while the blocks that were not ticked really were rebuilt, not kept.
    unticked_before = {b["id"] for b in blocks if b["id"] != practised["id"]}
    assert unticked_before.isdisjoint(b["id"] for b in rebuilt)


def test_replace_rebuilds_unticked_blocks_from_current_state(pupil):
    generate(pupil.client)
    f.revision(pupil.student, pupil.cohort.chapter("Matrices"), 3,
               timezone.localdate() - dt.timedelta(days=20))
    rebuilt = generate(pupil.client, replace=True).json()["blocks"]
    revises = [b["topic_name"] for b in rebuilt if b["mode"] == "revise"]
    assert revises == ["Matrices", "Limits"]                      # most overdue first


def test_the_budget_follows_what_the_student_logs(pupil):
    for days_ago in range(1, 6):
        f.study(pupil.student, pupil.weak, 100, timezone.now() - dt.timedelta(days=days_ago))
    blocks = generate(pupil.client).json()["blocks"]
    assert sum(b["minutes"] for b in blocks) <= 100
    assert [b["mode"] for b in blocks] == ["revise", "practice"]  # 30+45; learn (60) would not fit


@pytest.mark.parametrize("when, ok", [
    (0, True), (7, True), (8, False), (-1, False),
])
def test_only_today_and_the_coming_week_can_be_planned(pupil, when, ok):
    day = timezone.localdate() + dt.timedelta(days=when)
    response = generate(pupil.client, date=str(day))
    assert (response.status_code in (200, 201)) is ok
    if not ok:
        assert response.status_code == 400 and "date" in response.json()


def test_a_malformed_date_is_a_400(pupil):
    assert generate(pupil.client, date="next tuesday").status_code == 400


def test_only_students_generate_their_own_plan(pupil, cohort):
    mentor = APIClient()
    mentor.force_login(f.make_mentor_user(cohort, "planner-mentor"))
    assert generate(mentor).status_code == 403
    assert generate(APIClient()).status_code in (401, 403)


def test_generation_is_rate_limited(pupil, monkeypatch):
    from rest_framework.throttling import ScopedRateThrottle

    monkeypatch.setitem(ScopedRateThrottle.THROTTLE_RATES, "plan_generate", "2/hour")
    codes = [generate(pupil.client).status_code for _ in range(3)]
    assert codes == [201, 200, 429]


def test_one_students_plan_never_uses_anothers_evidence(pupil, cohort):
    other = f.make_student(cohort, "Bhavna Rao", roll_no="B-2")
    client = APIClient()
    client.force_login(f.make_student_user(other, "bhavna"))
    # Bhavna has no evidence of her own; Aarav's weak chapter and revision are not hers.
    # (The chapter he has not attempted is, though: it was taught to the batch.)
    modes_for_bhavna = [b["mode"] for b in generate(client).json()["blocks"]]
    assert modes_for_bhavna == ["learn"]


# -------------------------------------------------------- the commands


def test_generate_plans_command_plans_active_students_only(pupil, cohort):
    gone = f.make_student(cohort, "Left Early", roll_no="L-1")
    gone.exited_at = dt.date(2026, 9, 1)
    gone.save(update_fields=["exited_at"])

    call_command("generate_plans", "--institute", cohort.institute.slug, stdout=io.StringIO())
    assert PlanBlock.objects.filter(student=pupil.student).count() == 3
    assert not PlanBlock.objects.filter(student=gone).exists()

    # Running it again changes nothing.
    call_command("generate_plans", "--institute", cohort.institute.slug, stdout=io.StringIO())
    assert PlanBlock.objects.filter(student=pupil.student).count() == 3


def test_provision_command_writes_credentials_once_and_never_resets(cohort, tmp_path):
    keen = f.make_student(cohort, "Keen Student", roll_no="K-1")
    old = f.make_student(cohort, "Settled Student", roll_no="S-1")
    gone = f.make_student(cohort, "Left Early", roll_no="L-1")
    gone.exited_at = dt.date(2026, 9, 1)
    gone.save(update_fields=["exited_at"])

    settled_user = f.make_student_user(old, "settled")
    settled_user.set_password("my-own-password-9")
    settled_user.save()
    password_before = settled_user.password

    out = tmp_path / "slips.csv"
    call_command("provision_student_accounts", "--institute", cohort.institute.slug,
                 "--out", str(out), stderr=io.StringIO())

    rows = list(csv.DictReader(out.open(encoding="utf-8")))
    assert [r["roll_no"] for r in rows] == ["K-1"]                  # only the one who needed it
    assert rows[0]["name"] == "Keen Student" and rows[0]["batch"] == cohort.batch.name

    keen.refresh_from_db()
    assert keen.user.must_change_password is True
    assert User.objects.get(pk=settled_user.pk).password == password_before, "an existing login was reset"
    gone.refresh_from_db()
    assert gone.user_id is None

    # The slip works, and is hashed in the database.
    assert keen.user.check_password(rows[0]["temporary_password"])
    assert rows[0]["temporary_password"] not in keen.user.password


def test_provision_command_is_safe_to_run_twice(cohort, tmp_path):
    f.make_student(cohort, "Keen Student", roll_no="K-1")
    first, second = tmp_path / "a.csv", tmp_path / "b.csv"
    for path in (first, second):
        call_command("provision_student_accounts", "--institute", cohort.institute.slug,
                     "--out", str(path), stderr=io.StringIO())
    assert len(list(csv.DictReader(first.open(encoding="utf-8")))) == 1
    assert list(csv.DictReader(second.open(encoding="utf-8"))) == []


def test_provision_command_can_target_one_roll_number(cohort, tmp_path):
    f.make_student(cohort, "One", roll_no="R-1")
    f.make_student(cohort, "Two", roll_no="R-2")
    out = tmp_path / "one.csv"
    call_command("provision_student_accounts", "--institute", cohort.institute.slug,
                 "--roll", "R-2", "--out", str(out), stderr=io.StringIO())
    assert [r["roll_no"] for r in csv.DictReader(out.open(encoding="utf-8"))] == ["R-2"]
    assert Student.objects.get(roll_no="R-1").user_id is None
