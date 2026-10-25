"""The nightly refresh (`run_nightly`), its scheduler, and the receipts it leaves.

What is pinned here: the four steps run in order, per institute, under RLS;
each institute leaves a `JobRun`; one failing institute never stops the next;
a failed step is rolled back whole; the scheduler never runs an institute
twice on a day it already succeeded; and the dashboard reports when the
numbers were last refreshed.
"""

from __future__ import annotations

import datetime as dt
import io

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone
from rest_framework.test import APIClient

from apps.derived.management.commands import scheduler as scheduler_cmd
from apps.derived.models import JobRun, PlanBlock, TopicState
from apps.derived.services import detectors, nightly, planner, revisions
from apps.events.models import RevisionEvent
from apps.tenancy.models import User
from tests import factories as f

pytestmark = pytest.mark.usefixtures("fast_password_hasher")


@pytest.fixture
def town(cohort, other_cohort):
    """Two institutes, each with one active student who has something to plan,
    and one who has left."""
    today = timezone.localdate()
    out = {}
    for c in (cohort, other_cohort):
        c.batch.exam_date = today + dt.timedelta(days=200)
        c.batch.save(update_fields=["exam_date"])
        s = f.make_student(c, "Active", roll_no=f"A-{c.institute.id}")
        gone = f.make_student(c, "Gone", roll_no=f"G-{c.institute.id}",
                              exited_at=today - dt.timedelta(days=30))
        f.record(s, c.chapter("Thermodynamics"), "wwwwwcwwc", ts=timezone.now() - dt.timedelta(days=3))
        f.teach(c, c.chapter("Thermodynamics"), on=today - dt.timedelta(days=60))
        f.teach(c, c.chapter("Kinematics"), on=today)                       # earns an R1
        out[c.institute.id] = (c, s, gone)
    return out


def receipts(institute_id=None):
    qs = JobRun.objects.all()
    if institute_id is not None:
        qs = qs.filter(institute_id=institute_id)
    return list(qs.order_by("id"))


# ------------------------------------------------------------- run_nightly


def test_run_nightly_runs_every_step_for_every_institute(town):
    call_command("run_nightly", stdout=io.StringIO())

    for inst_id, (c, s, gone) in town.items():
        (run,) = receipts(inst_id)
        assert run.status == JobRun.OK and run.error == "" and run.kind == JobRun.NIGHTLY
        assert run.started_at <= run.finished_at
        assert set(run.stats) >= {"as_of", "features", "revisions", "detectors", "plans", "timings_ms"}
        # 1 features: recomputed, retention included.
        state = TopicState.objects.get(student=s, topic=c.chapter("Thermodynamics"))
        assert state.mastery is not None and state.retention is not None
        # 2 revisions: the chapter taught today earned its R1.
        assert RevisionEvent.objects.filter(student=s, topic=c.chapter("Kinematics"), cycle=1).exists()
        assert run.stats["revisions"]["created"] >= 1
        # 3 detectors ran over every student.
        assert run.stats["detectors"]["evaluated"] > 0
        # 4 plans, for the active student only.
        assert PlanBlock.objects.filter(student=s, date=timezone.localdate()).exists()
        assert not PlanBlock.objects.filter(student=gone).exists()
        assert run.stats["plans"]["students"] == 1


def test_the_steps_run_in_order_each_reading_the_one_before(town, monkeypatch):
    """Detectors on a stale store raise confident flags about last month, and
    plans read tonight's flags — so the order is part of the contract."""
    from apps.derived.services import features

    calls = []

    def spy(module, name):
        real = getattr(module, name)

        def wrapper(*args, **kwargs):
            calls.append(name)
            return real(*args, **kwargs)

        monkeypatch.setattr(module, name, wrapper)

    spy(features, "recompute")
    spy(revisions, "schedule_revisions")
    spy(detectors, "run_detectors")
    spy(planner, "generate_for_student")
    c, _, _ = next(iter(town.values()))
    nightly.run_for_institute(c.institute)
    assert calls == ["recompute", "schedule_revisions", "run_detectors", "generate_for_student"]


def test_the_nightly_run_never_replaces_a_plan_the_student_already_has(town):
    c, s, _ = next(iter(town.values()))
    mine = f.PlanBlockFactory(student=s, institute=c.institute, topic=c.chapter("Limits"),
                              date=timezone.localdate(), completed=True)
    call_command("run_nightly", "--institute", c.institute.slug, stdout=io.StringIO())
    assert list(PlanBlock.objects.filter(student=s)) == [mine]


def test_running_twice_is_safe(town):
    call_command("run_nightly", stdout=io.StringIO())
    blocks = PlanBlock.objects.count()
    revisions_n = RevisionEvent.objects.count()
    call_command("run_nightly", stdout=io.StringIO())
    assert PlanBlock.objects.count() == blocks
    assert RevisionEvent.objects.count() == revisions_n
    assert len(receipts()) == 4                       # a receipt per run, per institute


def test_one_failing_institute_does_not_stop_the_others(town, monkeypatch):
    bad, good = list(town)
    real = detectors.run_detectors

    def flaky(institute_id, *args, **kwargs):
        if institute_id == bad:
            raise RuntimeError("detector exploded")
        return real(institute_id, *args, **kwargs)

    monkeypatch.setattr(detectors, "run_detectors", flaky)
    with pytest.raises(CommandError):                 # non-zero exit, for cron / Task Scheduler
        call_command("run_nightly", stdout=io.StringIO())

    (failed,) = receipts(bad)
    assert failed.status == JobRun.FAILED
    assert failed.error == "detectors: RuntimeError: detector exploded"
    assert "plans" not in failed.stats                # later steps skipped…
    assert "features" in failed.stats                 # …earlier ones stood
    (ok,) = receipts(good)
    assert ok.status == JobRun.OK
    assert PlanBlock.objects.filter(institute_id=good).exists()
    assert not PlanBlock.objects.filter(institute_id=bad).exists()


def test_a_failed_step_is_rolled_back_whole(town, monkeypatch):
    inst_id, (c, s, _) = next(iter(town.items()))

    def half_then_fail(institute_id, *args, **kwargs):
        RevisionEvent.objects.create(institute_id=institute_id, student=s,
                                     topic=c.chapter("Matrices"), cycle=1,
                                     scheduled_for=timezone.localdate())
        raise RuntimeError("halfway")

    monkeypatch.setattr(revisions, "schedule_revisions", half_then_fail)
    run = nightly.run_for_institute(c.institute)
    assert run.status == JobRun.FAILED and run.error.startswith("revisions: ")
    assert not RevisionEvent.objects.filter(topic=c.chapter("Matrices")).exists()


def test_one_students_plan_failing_is_counted_and_the_rest_are_planned(town, monkeypatch):
    c, s, _ = next(iter(town.values()))
    other = f.make_student(c, "Second", roll_no="S-2")
    real = planner.generate_for_student

    def picky(student, day, **kwargs):
        if student.id == s.id:
            raise RuntimeError("bad data")
        return real(student, day, **kwargs)

    monkeypatch.setattr(planner, "generate_for_student", picky)
    run = nightly.run_for_institute(c.institute)
    assert run.status == JobRun.OK
    assert (run.stats["plans"]["students"], run.stats["plans"]["failed"]) == (2, 1)
    assert PlanBlock.objects.filter(student=other).exists()


def test_as_of_is_passed_through_and_a_past_one_makes_no_plans(town):
    c, s, _ = next(iter(town.values()))
    past = timezone.now() - dt.timedelta(days=10)
    call_command("run_nightly", "--institute", str(c.institute.id), "--as-of", past.isoformat(),
                 stdout=io.StringIO())
    (run,) = receipts(c.institute.id)
    assert run.stats["as_of"] == past.isoformat()
    assert "skipped" in run.stats["plans"]
    assert not PlanBlock.objects.filter(student=s).exists()


def test_the_command_rejects_what_it_cannot_read(town):
    with pytest.raises(CommandError):
        call_command("run_nightly", "--as-of", "yesterday", stdout=io.StringIO())
    with pytest.raises(CommandError):
        call_command("run_nightly", "--institute", "no-such-place", stdout=io.StringIO())


def test_done_today_counts_only_successful_runs_started_today(town):
    inst_id = next(iter(town))
    assert nightly.done_today(inst_id) is False
    JobRun.objects.create(institute_id=inst_id, started_at=timezone.now(),
                          finished_at=timezone.now(), status=JobRun.FAILED)
    assert nightly.done_today(inst_id) is False
    yesterday = timezone.now() - dt.timedelta(days=1)
    JobRun.objects.create(institute_id=inst_id, started_at=yesterday, finished_at=yesterday,
                          status=JobRun.OK)
    assert nightly.done_today(inst_id) is False
    JobRun.objects.create(institute_id=inst_id, started_at=timezone.now(),
                          finished_at=timezone.now(), status=JobRun.OK)
    assert nightly.done_today(inst_id) is True
    assert nightly.done_today(list(town)[1]) is False


# --------------------------------------------------------------- scheduler


class Clock:
    """Stands in for `Command._now` / `_sleep`. Today's date, a chosen time."""

    def __init__(self, hour: int, minute: int = 0, stop_after: int = 1):
        self.when = timezone.localtime().replace(hour=hour, minute=minute, second=0, microsecond=0)
        self.sleeps = 0
        self.stop_after = stop_after

    def now(self):
        return self.when

    def sleep(self, seconds):
        assert seconds == scheduler_cmd.POLL_SECONDS
        self.sleeps += 1
        if self.sleeps >= self.stop_after:
            raise KeyboardInterrupt


def use_clock(monkeypatch, clock: Clock):
    monkeypatch.setattr(scheduler_cmd.Command, "_now", lambda self: clock.now())
    monkeypatch.setattr(scheduler_cmd.Command, "_sleep", lambda self, seconds: clock.sleep(seconds))


def test_once_runs_when_due_and_not_again_the_same_day(town, monkeypatch):
    use_clock(monkeypatch, Clock(23, 50))
    call_command("scheduler", "--once", "--at", "02:00", stdout=io.StringIO())
    assert len(receipts()) == 2

    out = io.StringIO()
    call_command("scheduler", "--once", "--at", "02:00", stdout=out)
    assert len(receipts()) == 2, "an institute was run twice on the same day"
    assert "nothing to do" in out.getvalue()


def test_once_does_nothing_before_the_run_time(town, monkeypatch):
    use_clock(monkeypatch, Clock(1, 59))
    out = io.StringIO()
    call_command("scheduler", "--once", "--at", "02:00", stdout=out)
    assert receipts() == [] and "not due yet" in out.getvalue()


def test_a_failed_institute_is_retried_on_the_next_start_and_only_it(town, monkeypatch):
    bad, good = list(town)
    real = detectors.run_detectors
    state = {"broken": True}

    def flaky(institute_id, *args, **kwargs):
        if institute_id == bad and state["broken"]:
            raise RuntimeError("down")
        return real(institute_id, *args, **kwargs)

    monkeypatch.setattr(detectors, "run_detectors", flaky)
    use_clock(monkeypatch, Clock(23, 0))
    call_command("scheduler", "--once", "--at", "02:00", stdout=io.StringIO())
    state["broken"] = False
    call_command("scheduler", "--once", "--at", "02:00", stdout=io.StringIO())

    assert [r.status for r in receipts(bad)] == [JobRun.FAILED, JobRun.OK]
    assert [r.status for r in receipts(good)] == [JobRun.OK]


def test_the_loop_runs_once_a_day_and_stops_cleanly_on_ctrl_c(town, monkeypatch):
    clock = Clock(3, 0, stop_after=3)                 # three wake-ups, then Ctrl-C
    use_clock(monkeypatch, clock)
    out = io.StringIO()
    call_command("scheduler", "--at", "02:00", stdout=out)
    assert clock.sleeps == 3
    assert len(receipts()) == 2
    assert "scheduler stopped." in out.getvalue()


def test_the_loop_does_not_hammer_a_failing_institute_every_minute(town, monkeypatch):
    bad = next(iter(town))
    real = detectors.run_detectors

    def flaky(institute_id, *args, **kwargs):
        if institute_id == bad:
            raise RuntimeError("down")
        return real(institute_id, *args, **kwargs)

    monkeypatch.setattr(detectors, "run_detectors", flaky)
    use_clock(monkeypatch, Clock(4, 0, stop_after=4))
    call_command("scheduler", "--at", "02:00", stdout=io.StringIO())
    assert len(receipts(bad)) == 1


def test_the_loop_waits_for_the_run_time(town, monkeypatch):
    use_clock(monkeypatch, Clock(1, 0, stop_after=2))
    call_command("scheduler", "--at", "02:00", stdout=io.StringIO())
    assert receipts() == []


@pytest.mark.parametrize("raw", ["25:00", "2pm", "", "02:5", "aa:bb"])
def test_a_bad_run_time_is_refused_up_front(town, raw, settings):
    settings.NIGHTLY_AT = raw
    with pytest.raises(CommandError):
        call_command("scheduler", "--once", stdout=io.StringIO())


def test_the_run_time_comes_from_settings_by_default(town, monkeypatch, settings):
    settings.NIGHTLY_AT = "23:59"
    use_clock(monkeypatch, Clock(23, 0))
    call_command("scheduler", "--once", stdout=io.StringIO())
    assert receipts() == []
    settings.NIGHTLY_AT = "22:30"
    call_command("scheduler", "--once", stdout=io.StringIO())
    assert len(receipts()) == 2


@pytest.mark.parametrize("raw, expected", [
    ("02:00", dt.time(2, 0)), ("2:00", dt.time(2, 0)), ("23:59", dt.time(23, 59)),
])
def test_parse_at(raw, expected):
    assert scheduler_cmd.parse_at(raw) == expected


def test_is_due():
    noon = timezone.localtime().replace(hour=12, minute=0)
    assert scheduler_cmd.is_due(noon, dt.time(2, 0))
    assert scheduler_cmd.is_due(noon, dt.time(12, 0))
    assert not scheduler_cmd.is_due(noon, dt.time(12, 1))


def test_the_default_run_time_and_the_documented_alternative():
    from django.conf import settings

    assert scheduler_cmd.parse_at(settings.NIGHTLY_AT)
    help_text = scheduler_cmd.Command.help
    assert "Task Scheduler" in help_text and "cron" in help_text and "run_nightly" in help_text


# ------------------------------------------------- the dashboard's freshness


def summary(client, **params):
    response = client.get("/api/dashboard/summary/", params)
    assert response.status_code == 200, response.content
    return response.json()


def test_the_dashboard_says_when_the_numbers_were_last_refreshed(town, cohort, mentor_client):
    assert summary(mentor_client)["last_refreshed_at"] is None

    call_command("run_nightly", "--institute", cohort.institute.slug, stdout=io.StringIO())
    (run,) = receipts(cohort.institute.id)
    stamp = summary(mentor_client)["last_refreshed_at"]
    assert stamp is not None
    assert dt.datetime.fromisoformat(stamp.replace("Z", "+00:00")) == run.finished_at


def test_a_failed_run_does_not_freshen_the_dashboard(town, cohort, mentor_client):
    ok_at = timezone.now() - dt.timedelta(days=2)
    JobRun.objects.create(institute=cohort.institute, started_at=ok_at, finished_at=ok_at,
                          status=JobRun.OK)
    JobRun.objects.create(institute=cohort.institute, started_at=timezone.now(),
                          finished_at=timezone.now(), status=JobRun.FAILED, error="x: boom")
    stamp = summary(mentor_client)["last_refreshed_at"]
    assert dt.datetime.fromisoformat(stamp.replace("Z", "+00:00")) == ok_at


def test_another_institutes_run_is_not_this_ones_freshness(town, cohort, other_cohort, mentor_client):
    JobRun.objects.create(institute=other_cohort.institute, started_at=timezone.now(),
                          finished_at=timezone.now(), status=JobRun.OK)
    assert summary(mentor_client)["last_refreshed_at"] is None


def test_freshness_is_institute_wide_under_a_batch_filter(town, cohort, mentor_client):
    JobRun.objects.create(institute=cohort.institute, started_at=timezone.now(),
                          finished_at=timezone.now(), status=JobRun.OK)
    scoped = summary(mentor_client, batch=cohort.batch.id)
    assert scoped["batch_id"] == cohort.batch.id and scoped["last_refreshed_at"] is not None


def test_the_empty_summary_carries_the_field_too(db):
    staff = User.objects.create_user("director-x", password="pw-for-tests", is_staff=True)
    client = APIClient()
    client.force_login(staff)
    body = summary(client)
    assert body["total_students"] == 0 and body["last_refreshed_at"] is None
