"""The revision scheduler: R1/R2/R3, deadline-aware, append-only.

The rules are a pure function (`next_revision`), so most of this file says in
one line what a chapter's next revision should be given its history. The
database tests then check what the function cannot: where "first exposure"
comes from, that a run is idempotent and never edits a row, who is in scope,
and the two hooks that schedule on the spot.
"""

from __future__ import annotations

import datetime as dt
import io

import pytest
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.derived.services import revisions as rv
from apps.derived.services.revisions import ChapterHistory, next_revision, schedule_revisions
from apps.events.models import RevisionEvent
from tests import factories as f

pytestmark = pytest.mark.usefixtures("fast_password_hasher")

TODAY = dt.date(2026, 9, 20)
FAR_EXAM = dt.date(2027, 4, 4)


def days(n: int) -> dt.timedelta:
    return dt.timedelta(days=n)


def decide(first=None, cycles=None, *, today=TODAY, exam=FAR_EXAM):
    return next_revision(ChapterHistory(first, cycles or {}), today=today, exam_date=exam)


def at(day: dt.date, hour: int = 10) -> dt.datetime:
    return timezone.make_aware(dt.datetime.combine(day, dt.time(hour, 0)))


# ------------------------------------------------------------- the rules


def test_cycle_one_is_due_the_day_after_first_exposure():
    d = decide(first=TODAY)
    assert (d.outcome, d.cycle, d.scheduled_for) == (rv.SCHEDULED, 1, TODAY + days(1))


@pytest.mark.parametrize("done_cycle, interval", [(1, 7), (2, 30)])
def test_the_next_cycle_is_its_interval_after_the_previous_one_was_done(done_cycle, interval):
    done_on = TODAY - days(1)
    history = {c: done_on - days(40) for c in range(1, done_cycle)}
    history[done_cycle] = done_on
    d = decide(first=TODAY - days(90), cycles=history)
    assert d.cycle == done_cycle + 1
    assert d.scheduled_for == done_on + days(interval)


def test_the_intervals_are_the_documented_constants():
    assert rv.INTERVAL_DAYS == {1: 1, 2: 7, 3: 30}
    assert rv.MAX_CYCLES == 3


def test_a_cycle_not_yet_done_holds_back_the_next_one():
    """An undone R1 is a backlog, and the backlog is the signal. Stacking R2
    on top of it would bury it."""
    assert decide(first=TODAY - days(5), cycles={1: None}).outcome == rv.PENDING
    assert decide(cycles={1: TODAY - days(9), 2: None}).outcome == rv.PENDING


def test_three_cycles_at_most():
    d = decide(cycles={1: TODAY - days(60), 2: TODAY - days(50), 3: TODAY - days(1)})
    assert d.outcome == rv.COMPLETE and d.scheduled_for is None


def test_the_highest_cycle_governs_even_with_a_gap():
    """A seeded R2 with no R1 row is followed by R3, not by a back-filled R1."""
    d = decide(cycles={2: TODAY - days(2)})
    assert (d.cycle, d.scheduled_for) == (3, TODAY - days(2) + days(30))


def test_nothing_is_scheduled_into_the_past():
    """A late scheduler is not the student's debt: the revision is due today."""
    d = decide(first=TODAY - days(4))
    assert (d.cycle, d.scheduled_for) == (1, TODAY)
    d = decide(cycles={1: TODAY - days(20)})                # R2 ideally 13 days ago
    assert (d.cycle, d.scheduled_for) == (2, TODAY)


@pytest.mark.parametrize("age, outcome", [
    (rv.FIRST_CYCLE_GRACE_DAYS, rv.SCHEDULED),
    (rv.FIRST_CYCLE_GRACE_DAYS + 1, rv.STALE),
    (120, rv.STALE),
])
def test_an_old_first_exposure_earns_no_r1(age, outcome):
    """Otherwise the first run over real data schedules every chapter taught
    since the start of term, all due today."""
    assert decide(first=TODAY - days(age)).outcome == outcome


def test_the_grace_window_is_a_week():
    assert rv.FIRST_CYCLE_GRACE_DAYS == 7


def test_a_revision_that_would_overshoot_the_exam_lands_the_day_before_it():
    exam = TODAY + days(10)
    d = decide(cycles={1: TODAY, 2: TODAY}, exam=exam)       # R3 ideally +30
    assert (d.outcome, d.cycle, d.scheduled_for) == (rv.CAPPED, 3, exam - days(1))
    assert d.writes


def test_a_revision_that_fits_before_the_exam_is_not_capped():
    exam = TODAY + days(8)                                    # R2 at +7 is the day before
    d = decide(cycles={1: TODAY}, exam=exam)
    assert (d.outcome, d.scheduled_for) == (rv.SCHEDULED, TODAY + days(7))


@pytest.mark.parametrize("exam", [TODAY, TODAY - days(1), TODAY - days(90)])
def test_once_the_exam_is_today_or_past_nothing_is_scheduled(exam):
    assert decide(first=TODAY, exam=exam).outcome == rv.NO_TIME
    assert decide(cycles={1: TODAY - days(1)}, exam=exam).outcome == rv.NO_TIME


def test_no_revision_on_the_same_day_as_its_anchor():
    """Exam tomorrow and the chapter met today: the only day left is today,
    and revising on the day you met something is not spaced repetition."""
    assert decide(first=TODAY, exam=TODAY + days(1)).outcome == rv.NO_TIME
    assert decide(cycles={1: TODAY}, exam=TODAY + days(1)).outcome == rv.NO_TIME


def test_no_exam_date_means_no_deadline():
    d = decide(cycles={1: TODAY, 2: TODAY}, exam=None)
    assert d.scheduled_for == TODAY + days(30)


def test_never_seen_is_never_scheduled():
    assert decide().outcome == rv.NO_EXPOSURE


# ------------------------------------------------- first exposure, from the DB


@pytest.fixture
def pupil(cohort):
    cohort.batch.exam_date = FAR_EXAM
    cohort.batch.save(update_fields=["exam_date"])
    return f.make_student(cohort, "Aarav Mehta", roll_no="A-1")


def rows(student, **filters):
    return {
        (r.topic.name, r.cycle): r.scheduled_for
        for r in RevisionEvent.objects.filter(student=student, **filters).select_related("topic")
    }


def test_first_exposure_is_the_earliest_of_log_attempt_and_class(cohort, pupil):
    """Each source is the earliest for exactly one chapter, so dropping any
    one of them moves that chapter's R1 to tomorrow."""
    c = cohort.chapter
    yesterday = TODAY - days(1)
    f.record(pupil, c("Kinematics"), "cw", ts=at(yesterday))           # attempt first
    f.study(pupil, c("Kinematics"), 30, at(TODAY))
    f.study(pupil, c("Laws of Motion"), 30, at(yesterday))            # log first
    f.record(pupil, c("Laws of Motion"), "c", ts=at(TODAY))
    f.teach(cohort, c("Magnetism"), on=yesterday)                      # class first
    f.study(pupil, c("Magnetism"), 30, at(TODAY))
    f.study(pupil, c("Limits"), 30, at(TODAY))                         # only today
    f.teach(cohort, c("Matrices"), on=TODAY + days(3))                 # not taught yet

    counts = schedule_revisions(cohort.institute.id, today=TODAY)

    assert rows(pupil) == {
        ("Kinematics", 1): TODAY,
        ("Laws of Motion", 1): TODAY,
        ("Magnetism", 1): TODAY,
        ("Limits", 1): TODAY + days(1),
    }
    assert counts["created"] == 4 and counts["by_cycle"] == {"1": 4, "2": 0, "3": 0}


def test_the_class_date_counts_even_against_a_recent_log(cohort, pupil):
    """Taught a month ago and logged today is a chapter met a month ago."""
    f.teach(cohort, cohort.chapter("Current Electricity"), on=TODAY - days(30))
    f.study(pupil, cohort.chapter("Current Electricity"), 30, at(TODAY))
    counts = schedule_revisions(cohort.institute.id, today=TODAY)
    assert rows(pupil) == {}
    assert counts[rv.STALE] == 1


def test_a_class_date_is_exposure_for_every_student_in_the_batch(cohort, pupil):
    other = f.make_student(cohort, "Bhavna Rao", roll_no="B-1")
    f.teach(cohort, cohort.chapter("Hydrocarbons"), on=TODAY)
    schedule_revisions(cohort.institute.id, today=TODAY)
    assert rows(pupil) == rows(other) == {("Hydrocarbons", 1): TODAY + days(1)}


def test_next_cycles_follow_completed_ones_in_the_database(cohort, pupil):
    c = cohort.chapter
    f.revision(pupil, c("Kinematics"), 1, TODAY - days(3), done_at=at(TODAY - days(2)))
    f.revision(pupil, c("Limits"), 1, TODAY - days(20), done_at=at(TODAY - days(19)))
    f.revision(pupil, c("Limits"), 2, TODAY - days(12), done_at=at(TODAY - days(2)))
    f.revision(pupil, c("Matrices"), 1, TODAY - days(1))                # still pending

    schedule_revisions(cohort.institute.id, today=TODAY)

    new = rows(pupil, done_at__isnull=True)
    assert new[("Kinematics", 2)] == TODAY - days(2) + days(7)
    assert new[("Limits", 3)] == TODAY - days(2) + days(30)
    assert ("Matrices", 2) not in new


def test_the_exam_date_of_the_students_own_batch_is_the_deadline(cohort, pupil):
    cohort.batch.exam_date = TODAY + days(5)
    cohort.batch.save(update_fields=["exam_date"])
    f.revision(pupil, cohort.chapter("Kinematics"), 1, TODAY - days(3), done_at=at(TODAY - days(1)))
    counts = schedule_revisions(cohort.institute.id, today=TODAY)
    assert rows(pupil, cycle=2) == {("Kinematics", 2): TODAY + days(4)}
    assert counts[rv.CAPPED] == 1


def test_after_the_exam_nothing_more_is_scheduled(cohort, pupil):
    cohort.batch.exam_date = TODAY - days(1)
    cohort.batch.save(update_fields=["exam_date"])
    f.study(pupil, cohort.chapter("Limits"), 30, at(TODAY))
    f.revision(pupil, cohort.chapter("Kinematics"), 1, TODAY - days(3), done_at=at(TODAY - days(2)))
    counts = schedule_revisions(cohort.institute.id, today=TODAY)
    assert counts["created"] == 0 and counts[rv.NO_TIME] == 2


# ------------------------------------------------ append-only and idempotent


def test_running_twice_writes_nothing_the_second_time(cohort, pupil):
    f.study(pupil, cohort.chapter("Limits"), 30, at(TODAY))
    f.revision(pupil, cohort.chapter("Kinematics"), 1, TODAY - days(3), done_at=at(TODAY - days(2)))
    first = schedule_revisions(cohort.institute.id, today=TODAY)
    snapshot = sorted(RevisionEvent.objects.values_list("id", "topic_id", "cycle", "scheduled_for", "done_at"))

    second = schedule_revisions(cohort.institute.id, today=TODAY)

    assert first["created"] == 2 and second["created"] == 0
    assert sorted(RevisionEvent.objects.values_list(
        "id", "topic_id", "cycle", "scheduled_for", "done_at")) == snapshot


def test_an_existing_row_is_never_modified(cohort, pupil):
    done = f.revision(pupil, cohort.chapter("Kinematics"), 1, TODAY - days(30),
                      done_at=at(TODAY - days(25)))
    pending = f.revision(pupil, cohort.chapter("Limits"), 1, TODAY - days(9))
    before = {r.id: (r.scheduled_for, r.done_at, r.cycle)
              for r in RevisionEvent.objects.filter(id__in=[done.id, pending.id])}

    schedule_revisions(cohort.institute.id, today=TODAY)

    after = {r.id: (r.scheduled_for, r.done_at, r.cycle)
             for r in RevisionEvent.objects.filter(id__in=[done.id, pending.id])}
    assert after == before
    assert RevisionEvent.objects.filter(student=pupil, topic=cohort.chapter("Limits")).count() == 1


def test_the_output_is_determined_by_today(cohort, pupil):
    f.study(pupil, cohort.chapter("Limits"), 30, at(TODAY - days(2)))
    f.revision(pupil, cohort.chapter("Kinematics"), 1, TODAY - days(3), done_at=at(TODAY - days(2)))

    def run(today):
        schedule_revisions(cohort.institute.id, today=today)
        made = rows(pupil, done_at__isnull=True)
        RevisionEvent.objects.filter(student=pupil, done_at__isnull=True).delete()
        return made

    assert run(TODAY) == run(TODAY)
    assert run(TODAY) != run(TODAY + days(3))           # a later today clamps R1 later


# ---------------------------------------------------------------- the scope


def test_students_who_have_left_are_not_scheduled(cohort, pupil):
    gone = f.make_student(cohort, "Left Early", roll_no="L-1", exited_at=TODAY - days(10))
    f.teach(cohort, cohort.chapter("Limits"), on=TODAY)
    counts = schedule_revisions(cohort.institute.id, today=TODAY)
    assert rows(gone) == {} and rows(pupil) != {}
    assert counts["students"] == 1


def test_scope_is_the_institute_the_students_and_the_chapters_asked_for(cohort, other_cohort, pupil):
    friend = f.make_student(cohort, "Bhavna Rao", roll_no="B-1")
    stranger = f.make_student(other_cohort, "Elsewhere", roll_no="E-1")
    for s in (pupil, friend):
        f.study(s, cohort.chapter("Limits"), 30, at(TODAY))
        f.study(s, cohort.chapter("Matrices"), 30, at(TODAY))
    f.study(stranger, other_cohort.chapter("Limits"), 30, at(TODAY))

    schedule_revisions(cohort.institute.id, [pupil.id], today=TODAY,
                       topic_ids=[cohort.chapter("Limits").id])

    assert rows(pupil) == {("Limits", 1): TODAY + days(1)}
    assert rows(friend) == {} and rows(stranger) == {}


def test_counts_say_what_was_held_back(cohort, pupil):
    counts = schedule_revisions(cohort.institute.id, today=TODAY)
    assert set(counts) == {
        "students", "created", "by_cycle", rv.CAPPED, rv.NO_TIME, rv.STALE, rv.PENDING, rv.COMPLETE,
    }
    f.revision(pupil, cohort.chapter("Limits"), 1, TODAY - days(1))
    for cycle in (1, 2, 3):
        f.revision(pupil, cohort.chapter("Matrices"), cycle, TODAY - days(9), done_at=at(TODAY - days(9)))
    counts = schedule_revisions(cohort.institute.id, today=TODAY)
    assert (counts[rv.PENDING], counts[rv.COMPLETE], counts["created"]) == (1, 1, 0)


def test_the_command_runs_each_institute_under_rls(cohort, pupil):
    f.study(pupil, cohort.chapter("Limits"), 30, at(TODAY))
    out = io.StringIO()
    call_command("schedule_revisions", "--institute", cohort.institute.slug,
                 "--student", str(pupil.id), "--date", TODAY.isoformat(), stdout=out)
    assert rows(pupil) == {("Limits", 1): TODAY + days(1)}
    assert "1 revision(s) scheduled" in out.getvalue()


def test_the_command_refuses_a_bad_date(cohort):
    from django.core.management.base import CommandError

    with pytest.raises(CommandError):
        call_command("schedule_revisions", "--date", "2026-13-45", stdout=io.StringIO())


# ------------------------------------------------------------- the hooks


@pytest.fixture
def app(cohort):
    """A signed-in student whose exam is comfortably ahead of the real clock."""
    cohort.batch.exam_date = timezone.localdate() + days(200)
    cohort.batch.save(update_fields=["exam_date"])
    s = f.make_student(cohort, "Aarav Mehta", roll_no="A-1")
    client = APIClient()
    client.force_login(f.make_student_user(s, "aarav"))
    return s, client


def test_completing_r1_schedules_r2_a_week_later(cohort, app):
    student, client = app
    today = timezone.localdate()
    r1 = f.revision(student, cohort.chapter("Limits"), 1, today - days(1))
    assert client.post(f"/api/my/revisions/{r1.id}/complete/").status_code == 200
    assert rows(student, done_at__isnull=True) == {("Limits", 2): today + days(7)}


def test_completing_twice_schedules_once(cohort, app):
    student, client = app
    r1 = f.revision(student, cohort.chapter("Limits"), 1, timezone.localdate())
    for _ in range(2):
        client.post(f"/api/my/revisions/{r1.id}/complete/")
    assert RevisionEvent.objects.filter(student=student, cycle=2).count() == 1


def test_completing_r3_schedules_nothing_more(cohort, app):
    student, client = app
    today = timezone.localdate()
    for cycle in (1, 2):
        f.revision(student, cohort.chapter("Limits"), cycle, today - days(40), done_at=at(today - days(40)))
    r3 = f.revision(student, cohort.chapter("Limits"), 3, today)
    client.post(f"/api/my/revisions/{r3.id}/complete/")
    assert RevisionEvent.objects.filter(student=student).count() == 3


def log_study(client, topic, **extra):
    body = {"topic": topic.id, "minutes": 30, "mode": "learn",
            "ts": timezone.now().isoformat(), **extra}
    return client.post("/api/my/study-logs/", body, format="json")


def test_logging_a_first_exposure_schedules_r1_for_tomorrow(cohort, app):
    student, client = app
    assert log_study(client, cohort.chapter("Matrices")).status_code == 201
    assert rows(student) == {("Matrices", 1): timezone.localdate() + days(1)}


def test_logging_a_chapter_met_long_ago_schedules_nothing(cohort, app):
    student, client = app
    f.teach(cohort, cohort.chapter("Matrices"), on=timezone.localdate() - days(60))
    assert log_study(client, cohort.chapter("Matrices")).status_code == 201
    assert rows(student) == {}


def test_logging_schedules_only_the_chapter_logged(cohort, app):
    """The nightly run handles the rest; a hook that swept every chapter
    would make one log write the whole day's schedule."""
    student, client = app
    f.teach(cohort, cohort.chapter("Limits"), on=timezone.localdate())
    log_study(client, cohort.chapter("Matrices"))
    assert set(rows(student)) == {("Matrices", 1)}


def test_a_scheduling_failure_never_fails_the_students_write(cohort, app, monkeypatch):
    student, client = app

    def boom(*args, **kwargs):
        raise RuntimeError("scheduler down")

    monkeypatch.setattr(rv, "schedule_revisions", boom)
    assert log_study(client, cohort.chapter("Matrices")).status_code == 201
    assert student.study_logs.count() == 1
    r1 = f.revision(student, cohort.chapter("Limits"), 1, timezone.localdate())
    assert client.post(f"/api/my/revisions/{r1.id}/complete/").status_code == 200
