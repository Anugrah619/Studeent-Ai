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

from apps.derived.models import Flag, PlanBlock, TopicState
from apps.derived.services import planner
from apps.derived.services.planner import (
    ChapterFact, PlanInputs, RevisionFact, build_plan, budget_from_logs, choose_budget,
    effective_budget, note_for_existing, plan_note,
)
from apps.events.models import ChapterStatus
from apps.tenancy.models import Student, User
from tests import factories as f

pytestmark = pytest.mark.usefixtures("fast_password_hasher")

DAY = dt.date(2026, 10, 15)
LONG_AGO = dt.date(2026, 8, 1)


def chapter(tid, name="Chapter", *, mastery=None, attempts=0, taught=LONG_AGO, weight=4.0,
            subject="", retention=None, touched=None):
    return ChapterFact(tid, name, weight, mastery, attempts, taught,
                       subject=subject, retention=retention, last_touched=touched)


def revision(tid, cycle=1, days_late=2, name="Chapter"):
    return RevisionFact(tid, name, cycle, DAY - dt.timedelta(days=days_late))


def plan(chapters=(), revisions=(), budget=360, already=(), flags=(), neglected=None):
    return build_plan(PlanInputs(
        day=DAY, budget=budget, chapters=list(chapters), revisions=list(revisions),
        already_planned=set(already), open_flags=frozenset(flags), neglected_subject=neglected,
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


# ------------------------------------------------- budget precedence (new)


@pytest.mark.parametrize("stated, logged, expected", [
    (120, [300, 300, 300, 300], 120),            # what they said beats what they log
    (None, [300, 300, 300, 300], 300),           # …and the logs come next
    (None, [300], planner.DEFAULT_BUDGET),       # …then the default
    (45, [], 45),                                # a short stated day is honoured…
    (30, [], planner.STATED_MIN_BUDGET),         # …down to onboarding's own minimum
    (720, [], planner.MAX_BUDGET),
    (0, [150, 150, 150], 150),                   # zero is "not said", not a budget
])
def test_the_students_own_minutes_come_first_then_the_logs_then_the_default(stated, logged, expected):
    assert choose_budget(stated, logged) == expected


def test_the_shortest_stated_day_still_fits_a_revision_and_a_practice_block():
    """The reason the floor is 45: both of the planner's short blocks fit, so a
    student who says 45 minutes gets a 45-minute plan, not an empty one."""
    budget = choose_budget(planner.STATED_MIN_BUDGET, [])
    assert planner.MINUTES["revise"] <= budget and planner.MINUTES["practice"] <= budget
    (spec,) = plan(chapters=[chapter(1, mastery=0.2, attempts=9)], budget=budget)
    assert spec.mode == "practice" and spec.minutes <= budget


def test_onboarding_and_the_planner_agree_on_the_shortest_day():
    from apps.api.engine_serializers import MIN_DAILY_MINUTES
    assert MIN_DAILY_MINUTES == planner.STATED_MIN_BUDGET


# ------------------------------------------------------ the burnout guard (new)


def test_an_open_overload_flag_cuts_the_day_to_sixty_percent():
    assert effective_budget(180, {"overload"}) == 108
    assert effective_budget(360, {"overload"}) == 216
    assert planner.OVERLOAD_FACTOR == 0.6


def test_an_overloaded_day_has_no_new_material_and_fits_the_lighter_budget():
    chapters = [
        chapter(1, "Weak A", mastery=0.1, attempts=9),
        chapter(2, "Weak B", mastery=0.2, attempts=9),
        chapter(3, "Fresh", attempts=0),
    ]
    normal = plan(chapters=chapters, budget=180)
    light = plan(chapters=chapters, budget=180, flags={"overload"})
    assert modes(normal) == ["practice", "practice", "learn"]          # 150 of 180
    assert modes(light) == ["practice", "practice"]                    # 90 of 108
    assert sum(s.minutes for s in light) <= 108


def test_overload_drops_learn_even_when_it_would_fit():
    specs = plan(chapters=[chapter(3, "Fresh", attempts=0)], budget=360, flags={"overload"})
    assert specs == []


def test_an_open_disengagement_flag_makes_a_short_day():
    assert effective_budget(360, {"disengagement"}) == planner.SHORT_DAY_MINUTES == 90
    assert effective_budget(60, {"disengagement"}) == 60        # never longer than it was
    specs = plan(
        chapters=[chapter(1, mastery=0.1, attempts=9), chapter(2, mastery=0.2, attempts=9)],
        revisions=[revision(3), revision(4)],
        budget=360, flags={"disengagement"},
    )
    assert sum(s.minutes for s in specs) <= 90
    assert modes(specs) == ["revise", "revise"]


def test_a_short_day_may_still_start_something_new():
    """Disengagement shortens the day; unlike overload it does not forbid learning."""
    assert modes(plan(chapters=[chapter(1, attempts=0)], flags={"disengagement"})) == ["learn"]


def test_both_flags_together_take_the_stricter_of_each():
    assert effective_budget(360, {"overload", "disengagement"}) == 90
    assert plan(chapters=[chapter(1, attempts=0)], flags={"overload", "disengagement"}) == []


@pytest.mark.parametrize("flags, note", [
    (set(), None),
    ({"weak_topic"}, None),
    ({"subject_imbalance"}, None),
    ({"overload"}, planner.NOTE_LIGHTER),
    ({"disengagement"}, planner.NOTE_SHORT),
    ({"overload", "disengagement"}, planner.NOTE_SHORT_AND_LIGHT),
])
def test_a_lighter_day_says_so_and_an_ordinary_one_says_nothing(flags, note):
    assert plan_note(flags) == note


@pytest.mark.parametrize("note", [planner.NOTE_LIGHTER, planner.NOTE_SHORT, planner.NOTE_SHORT_AND_LIGHT])
def test_the_notes_never_name_a_flag_or_a_risk(note):
    """Students are minors, reading this alone. The note says what is
    different about today, never what the system concluded about them."""
    lowered = note.lower()
    for word in ("overload", "disengage", "flag", "risk", "burnout", "burn out", "detector",
                 "critical", "warning", "imbalance", "struggl", "falling", "worr", "mentor"):
        assert word not in lowered, f"{word!r} in {note!r}"
    assert note.endswith(".") and len(note) < 200


@pytest.mark.parametrize("flags, minutes, has_learn, honest", [
    ({"overload"}, 75, False, planner.NOTE_LIGHTER),       # fits 108, no learn: true
    ({"overload"}, 135, False, None),                      # made before the flag: too long
    ({"overload"}, 90, True, None),                        # has new material: not "nothing new"
    ({"disengagement"}, 90, True, planner.NOTE_SHORT),
    ({"disengagement"}, 135, False, None),
    ({"overload", "disengagement"}, 75, False, planner.NOTE_SHORT_AND_LIGHT),
    ({"overload", "disengagement"}, 75, True, planner.NOTE_SHORT),
])
def test_an_existing_plan_is_only_described_as_lighter_if_it_is(flags, minutes, has_learn, honest):
    assert note_for_existing(flags, budget=180, minutes=minutes, has_learn=has_learn) == honest


# ------------------------------------------------- the neglected subject (new)


def test_a_neglected_subjects_weak_chapters_take_the_practice_slots_first():
    chapters = [
        chapter(1, "Kinematics", mastery=0.10, attempts=9, subject="Physics"),
        chapter(2, "Limits", mastery=0.15, attempts=9, subject="Maths"),
        chapter(3, "Hydrocarbons", mastery=0.40, attempts=12, subject="Chemistry"),
    ]
    assert [s.topic_id for s in plan(chapters=chapters)] == [1, 2]       # weakest first, as before
    first, second = plan(chapters=chapters, neglected="Chemistry")
    assert (first.topic_id, first.reason_code) == (3, "subject_balance")
    assert (second.topic_id, second.reason_code) == (1, "weak_topic")


def test_the_subject_reason_says_why_in_plain_words():
    (spec,) = plan(chapters=[chapter(1, mastery=0.4, attempts=12, subject="Chemistry")],
                   neglected="Chemistry")
    assert spec.reason_text == (
        "Chemistry is costing you more marks than the time it gets, so it comes "
        "first: 40% over 12 questions"
    )


def test_a_neglected_subject_does_not_make_a_strong_chapter_weak():
    """The flag reorders weak chapters; it does not lower the line."""
    specs = plan(chapters=[chapter(1, mastery=0.7, attempts=12, subject="Chemistry")],
                 neglected="Chemistry")
    assert specs == []


def test_neglected_subject_chapters_must_still_be_taught():
    specs = plan(chapters=[chapter(1, mastery=0.2, attempts=12, subject="Chemistry", taught=None)],
                 neglected="Chemistry")
    assert specs == []


# ------------------------------------------------------ fading chapters (new)


def test_a_fading_chapter_is_revised_after_due_revisions_and_before_practice():
    specs = plan(
        chapters=[
            chapter(1, "Weak", mastery=0.2, attempts=9),
            chapter(2, "Fading", retention=0.3, touched=DAY - dt.timedelta(days=12), mastery=0.8),
        ],
        revisions=[revision(3, name="Due")],
    )
    assert [(s.topic_id, s.mode, s.reason_code) for s in specs] == [
        (3, "revise", "revision_r1"), (2, "revise", "low_retention"), (1, "practice", "weak_topic"),
    ]
    assert specs[1].reason_text == "You last worked on this 12 days ago — a short revision now keeps it fresh"


def seen(tid, name, retention):
    """A chapter attempted and known well — only its retention can plan it."""
    return chapter(tid, name, retention=retention, mastery=0.9, attempts=8)


def test_due_and_fading_revisions_share_one_cap_of_two():
    specs = plan(
        chapters=[seen(i, f"Fading {i}", 0.1 * i) for i in (1, 2, 3)],
        revisions=[revision(9)],
    )
    assert [(s.topic_id, s.reason_code) for s in specs] == [(9, "revision_r1"), (1, "low_retention")]


def test_the_fastest_fading_chapter_goes_first():
    specs = plan(chapters=[seen(1, "Slow", 0.45), seen(2, "Fast", 0.05), seen(3, "Mid", 0.25)])
    assert [s.topic_id for s in specs] == [2, 3]


@pytest.mark.parametrize("retention, planned", [(0.49, True), (0.5, False), (0.9, False), (None, False)])
def test_the_fading_line_is_half_and_never_seen_is_not_fading(retention, planned):
    assert bool(plan(chapters=[chapter(1, retention=retention, mastery=0.9, attempts=9)])) is planned


def test_a_fading_chapter_with_its_revision_due_is_revised_once():
    specs = plan(chapters=[chapter(1, retention=0.1)], revisions=[revision(1)])
    assert [(s.topic_id, s.reason_code) for s in specs] == [(1, "revision_r1")]


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
    # `note` is always present and null on an ordinary (here: empty) day.
    assert response.json() == {
        "date": str(timezone.localdate()), "generated": False, "blocks": [], "note": None,
    }


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


# ------------------------------------- the new rules, end to end (new)


def raise_flag(student, ftype, *, resolved=False, evidence=None):
    return Flag.objects.create(
        institute=student.institute, student=student, type=ftype, severity=Flag.HIGH,
        headline="for the mentor", evidence=evidence or {}, raised_at=timezone.now(),
        resolved_at=timezone.now() if resolved else None,
        outcome=Flag.UNKNOWN if resolved else "",
    )


def test_the_minutes_i_gave_at_onboarding_size_my_plan(pupil):
    for days_ago in range(1, 6):                       # logs alone would allow 300
        f.study(pupil.student, pupil.weak, 300, timezone.now() - dt.timedelta(days=days_ago))
    pupil.student.daily_minutes = 100
    pupil.student.save(update_fields=["daily_minutes"])
    blocks = generate(pupil.client).json()["blocks"]
    assert [b["mode"] for b in blocks] == ["revise", "practice"]        # 75 of 100
    assert sum(b["minutes"] for b in blocks) <= 100


def test_an_open_overload_flag_gives_a_lighter_day_with_a_gentle_note(pupil):
    raise_flag(pupil.student, "overload")
    body = generate(pupil.client).json()
    assert [b["mode"] for b in body["blocks"]] == ["revise", "practice"]   # no learn
    assert body["note"] == planner.NOTE_LIGHTER


def test_an_open_disengagement_flag_gives_a_short_day(pupil):
    raise_flag(pupil.student, "disengagement")
    body = generate(pupil.client).json()
    assert sum(b["minutes"] for b in body["blocks"]) <= 90
    assert body["note"] == planner.NOTE_SHORT


def test_no_note_on_a_day_with_nothing_to_plan(cohort):
    s = f.make_student(cohort, "Newcomer", roll_no="N-2")
    raise_flag(s, "disengagement")
    client = APIClient()
    client.force_login(f.make_student_user(s, "newcomer2"))
    body = generate(client).json()
    assert body["blocks"] == [] and body["note"] is None


def test_a_resolved_flag_changes_nothing(pupil):
    raise_flag(pupil.student, "overload", resolved=True)
    body = generate(pupil.client).json()
    assert [b["mode"] for b in body["blocks"]] == ["revise", "practice", "learn"]
    assert body["note"] is None


def test_a_classmates_flag_changes_nothing(pupil, cohort):
    raise_flag(f.make_student(cohort, "Bhavna Rao", roll_no="B-2"), "overload")
    body = generate(pupil.client).json()
    assert body["note"] is None and len(body["blocks"]) == 3


def test_the_imbalance_flags_subject_is_read_from_its_evidence(pupil, cohort):
    physics_weak = cohort.chapter("Laws of Motion")
    TopicState.objects.create(institute=cohort.institute, student=pupil.student, topic=physics_weak,
                              mastery=0.05, attempts_n=20, correct_n=1)
    ChapterStatus.objects.create(institute=cohort.institute, batch=cohort.batch,
                                 topic=physics_weak, taught_at=LONG_AGO)
    raise_flag(pupil.student, "subject_imbalance", evidence={"subject": "Chemistry", "gap_pts": 31.0})
    practice = [b for b in generate(pupil.client).json()["blocks"] if b["mode"] == "practice"]
    assert [b["topic_name"] for b in practice] == ["Thermodynamics", "Laws of Motion"]
    assert practice[0]["reason_text"].startswith("Chemistry is costing you more marks")


def test_a_fading_chapter_in_the_store_becomes_a_revise_block(pupil, cohort):
    TopicState.objects.create(
        institute=cohort.institute, student=pupil.student, topic=cohort.chapter("Matrices"),
        mastery=0.9, attempts_n=10, retention=0.2,
        last_seen=timezone.now() - dt.timedelta(days=12),
    )
    blocks = generate(pupil.client).json()["blocks"]
    assert [(b["topic_name"], b["reason_code"]) for b in blocks][:2] == [
        ("Limits", "revision_r1"), ("Matrices", "low_retention"),
    ]
    assert "12 days ago" in blocks[1]["reason_text"]


def test_an_existing_plan_is_not_called_lighter_after_the_fact(pupil):
    generate(pupil.client)                               # an ordinary three-block day
    raise_flag(pupil.student, "overload")
    again = generate(pupil.client)
    assert again.status_code == 200 and again.json()["note"] is None
    rebuilt = generate(pupil.client, replace=True).json()
    assert rebuilt["note"] == planner.NOTE_LIGHTER
    assert "learn" not in [b["mode"] for b in rebuilt["blocks"]]


def test_the_plan_never_shows_the_student_a_flag(pupil):
    raise_flag(pupil.student, "overload", evidence={"hours_change_pct": 30})
    raise_flag(pupil.student, "subject_imbalance", evidence={"subject": "Chemistry"})
    text = generate(pupil.client).content.decode().lower()
    for word in ("overload", "subject_imbalance", "flag", "risk", "severity", "hours_change"):
        assert word not in text


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
