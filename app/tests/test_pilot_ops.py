"""Pilot preparation: backups, the readiness check, and the demo passwords.

`backup_db` is tested with `subprocess` and `shutil.which` replaced — there is
no `pg_dump` here — so what is asserted is the command it builds and what it
does with the result: the password only ever in the child's environment, a
failed dump leaving no file, a timestamped custom-format archive otherwise.

`pilot_check` is tested rule by rule (each check is a small function) and once
end to end. `rotate_demo_passwords` against real accounts, with the fast
hasher.
"""

from __future__ import annotations

import datetime as dt
import io
import os
import types
from pathlib import Path

import pytest
from django.contrib.auth.hashers import check_password, make_password
from django.core.management import CommandError, call_command
from django.db import connections
from django.utils import timezone

import apps.derived.models as derived_models
from apps.ingestion.models import QuestionTopicMap
from apps.tenancy.management.commands import backup_db, pilot_check
from apps.tenancy.management.commands import rotate_demo_passwords as rotate
from apps.tenancy.models import User
from tests import factories as f

pytestmark = pytest.mark.usefixtures("fast_password_hasher")

SECRET = "s3cret-db-pw"


# =================================================================== backup_db


class FakeRun:
    """Stands in for `subprocess.run`: records each call, plays a script."""

    def __init__(self, *results):
        self.results = list(results) or [{}]
        self.calls: list[dict] = []

    def __call__(self, command, **kwargs):
        self.calls.append({"command": list(command), **kwargs})
        script = self.results[min(len(self.calls) - 1, len(self.results) - 1)]
        archive = script.get("archive", b"PGDMP\x01custom-archive")
        if command[1:2] != ["--list"] and "--list" not in command:
            if kwargs.get("stdout") not in (None, -3) and hasattr(kwargs["stdout"], "write"):
                kwargs["stdout"].write(archive)                       # docker: archive on stdout
            for part in command:
                if str(part).startswith("--file="):
                    Path(str(part)[len("--file="):]).write_bytes(archive)   # local: --file
        return types.SimpleNamespace(
            returncode=script.get("returncode", 0),
            stdout=script.get("stdout", b""),
            stderr=script.get("stderr", b""),
        )


@pytest.fixture
def db_password(monkeypatch):
    monkeypatch.setitem(connections["default"].settings_dict, "PASSWORD", SECRET)
    return SECRET


def tools(monkeypatch, **paths):
    monkeypatch.setattr(backup_db.shutil, "which", lambda name: paths.get(name))


def run_backup(*args):
    out, err = io.StringIO(), io.StringIO()
    call_command("backup_db", *args, stdout=out, stderr=err)
    return out.getvalue() + err.getvalue()


def test_a_local_pg_dump_writes_a_timestamped_custom_archive(monkeypatch, tmp_path, db_password):
    tools(monkeypatch, pg_dump="/usr/bin/pg_dump")
    fake = FakeRun()
    monkeypatch.setattr(backup_db.subprocess, "run", fake)

    printed = run_backup("--out", str(tmp_path))

    [dump] = list(tmp_path.glob("*.dump"))
    name = connections["default"].settings_dict["NAME"]
    assert dump.name.startswith(f"{name}-") and len(dump.stem) == len(name) + 16
    assert dump.read_bytes().startswith(b"PGDMP")
    assert not list(tmp_path.glob("*.partial")), "the partial name must be renamed away"
    [call] = fake.calls
    assert "--format=custom" in call["command"] and "--no-password" in call["command"]
    # The password travels in the environment, never on the command line.
    assert call["env"]["PGPASSWORD"] == SECRET
    assert not any(SECRET in str(part) for part in call["command"])
    assert SECRET not in printed and "Backup written" in printed


def test_without_pg_dump_it_goes_through_the_container(monkeypatch, tmp_path, settings, db_password):
    settings.DB_CONTAINER = "pilot_db"
    tools(monkeypatch, docker="/usr/bin/docker")
    fake = FakeRun()
    monkeypatch.setattr(backup_db.subprocess, "run", fake)

    run_backup("--out", str(tmp_path))

    command = fake.calls[0]["command"]
    assert command[:2] == ["/usr/bin/docker", "exec"] and "pilot_db" in command
    assert "pg_dump" in command and "--format=custom" in command
    # `-e PGPASSWORD` with no value: docker reads it from its own environment.
    i = command.index("-e")
    assert command[i + 1] == "PGPASSWORD"
    assert not any(SECRET in str(part) for part in command)
    assert fake.calls[0]["env"]["PGPASSWORD"] == SECRET
    assert list(tmp_path.glob("*.dump"))[0].read_bytes().startswith(b"PGDMP")


def test_a_failed_dump_leaves_no_file_and_never_shows_the_password(monkeypatch, tmp_path, db_password):
    tools(monkeypatch, pg_dump="/usr/bin/pg_dump")
    leaky = f'pg_dump: error: connection to server failed: password "{SECRET}" rejected'.encode()
    monkeypatch.setattr(backup_db.subprocess, "run", FakeRun({"returncode": 1, "stderr": leaky}))
    with pytest.raises(CommandError) as exc:
        run_backup("--out", str(tmp_path))
    assert SECRET not in str(exc.value) and "***" in str(exc.value)
    assert list(tmp_path.iterdir()) == [], "a failed backup must not look like a backup"


def test_verify_lists_the_archive(monkeypatch, tmp_path, db_password):
    tools(monkeypatch, pg_dump="/usr/bin/pg_dump", pg_restore="/usr/bin/pg_restore")
    listing = (b";\n; Archive created at 2026-10-24\n;\n"
               b"215; 1259 16390 TABLE public tenancy_student sai\n"
               b"3301; 0 16390 TABLE DATA public tenancy_student sai\n"
               b"3302; 0 16400 TABLE DATA public events_attempt sai\n"
               b"3400; 3256 16500 POLICY public events_attempt tenant_isolation sai\n")
    fake = FakeRun({}, {"stdout": listing})
    monkeypatch.setattr(backup_db.subprocess, "run", fake)

    printed = run_backup("--out", str(tmp_path), "--verify")

    assert fake.calls[1]["command"][:2] == ["/usr/bin/pg_restore", "--list"]
    assert "4 archive entries" in printed and "2 tables with data" in printed
    assert "1 row-level-security policies" in printed


def test_with_neither_tool_it_says_so(monkeypatch, tmp_path):
    tools(monkeypatch)
    with pytest.raises(CommandError, match="Neither pg_dump nor docker"):
        run_backup("--out", str(tmp_path))


# ================================================================ pilot_check


@pytest.mark.parametrize("value, status", [(True, "fail"), (False, "pass")])
def test_debug(value, status):
    assert pilot_check.check_debug(value).status == status


@pytest.mark.parametrize("key, status", [
    ("django-insecure-" + "x" * 60, "fail"),
    ("generate-your-own", "fail"),
    ("short-but-random-9f8e", "fail"),
    ("a" * 60, "fail"),                                   # long, but one character
    ("k3$9vQ!m2Lp#8xZr@7tWc^5nYb&1hJd*4gFs(6eKa)0uTqRi%Gz", "pass"),
])
def test_secret_key(key, status):
    assert pilot_check.check_secret_key(key).status == status


@pytest.mark.parametrize("hosts, status", [
    ([], "fail"), (["*"], "fail"), (["pilot.example.in", "*"], "fail"),
    (["localhost", "127.0.0.1"], "warn"), (["pilot.example.in"], "pass"),
])
def test_allowed_hosts(hosts, status):
    assert pilot_check.check_allowed_hosts(hosts).status == status


@pytest.mark.parametrize("value, status", [
    (None, "fail"), (-1, "fail"), ("1", "fail"), (0, "pass"), (1, "pass"), (5, "warn"),
])
def test_num_proxies(value, status):
    assert pilot_check.check_num_proxies(value).status == status


@pytest.mark.parametrize("backend, status", [
    ("django.core.cache.backends.locmem.LocMemCache", "warn"),
    ("django.core.cache.backends.dummy.DummyCache", "warn"),
    ("django.core.cache.backends.redis.RedisCache", "pass"),
])
def test_cache(backend, status):
    assert pilot_check.check_cache(backend).status == status


def test_backup_age(tmp_path):
    now = timezone.now()
    assert pilot_check.check_backup(tmp_path / "missing", now).status == "fail"
    assert pilot_check.check_backup(tmp_path, now).status == "fail"           # empty
    dump = tmp_path / "student_ai-20261024-020000.dump"
    dump.write_bytes(b"PGDMP")
    assert pilot_check.check_backup(tmp_path, now).status == "pass"
    old = (now - dt.timedelta(hours=pilot_check.MAX_BACKUP_AGE_HOURS + 1)).timestamp()
    os.utime(dump, (old, old))
    assert pilot_check.check_backup(tmp_path, now).status == "fail"
    (tmp_path / "student_ai-x.dump.partial").write_bytes(b"half")            # not a backup
    assert pilot_check.check_backup(tmp_path, now).status == "fail"


class FakeJobRun:
    """Shaped like engine's `JobRun`: `finished_at` and `status`."""

    latest = None

    class objects:  # noqa: N801 — mirrors a manager
        @staticmethod
        def filter(**kwargs):
            assert kwargs == {"finished_at__isnull": False}
            return FakeJobRun.objects

        @staticmethod
        def order_by(field):
            assert field == "-finished_at"
            return FakeJobRun.objects

        @staticmethod
        def first():
            return FakeJobRun.latest


def test_the_nightly_check_skips_gracefully_without_the_model(monkeypatch):
    monkeypatch.delattr(derived_models, "JobRun", raising=False)
    assert pilot_check.check_nightly(timezone.now()).status == "skip"


@pytest.mark.parametrize("hours_ago, status, expected", [
    (3, "ok", "pass"), (3, "failed", "fail"), (3, "error: db down", "fail"),
    (pilot_check.MAX_NIGHTLY_AGE_HOURS + 2, "ok", "fail"), (None, None, "fail"),
])
def test_the_nightly_check_reads_the_last_finished_run(monkeypatch, hours_ago, status, expected):
    now = timezone.now()
    FakeJobRun.latest = None if hours_ago is None else types.SimpleNamespace(
        finished_at=now - dt.timedelta(hours=hours_ago), status=status)
    monkeypatch.setattr(derived_models, "JobRun", FakeJobRun, raising=False)
    assert pilot_check.check_nightly(now).status == expected


def demo_staff(cohort, username, password="demo12345", **extra):
    user = f.UserFactory(username=username, password=make_password(password), **extra)
    mentor = f.MentorFactory(institute=cohort.institute, name=username.title())
    mentor.user = user
    mentor.save(update_fields=["user"])
    return user


def test_only_staff_on_the_demo_password_are_named(cohort):
    demo_staff(cohort, "rao")
    demo_staff(cohort, "iyer", password="a-real-password-9")
    f.UserFactory(username="dir", password=make_password("demo12345"), is_staff=True)
    f.UserFactory(username="gone", password=make_password("demo12345"), is_active=False)
    f.make_student_user(f.make_student(cohort, "Kid"), "kid", password="demo12345")
    assert pilot_check.staff_on_demo_password() == ["dir", "rao"]


@pytest.fixture
def ready_settings(db, settings, tmp_path):
    settings.DEBUG = False
    settings.SECRET_KEY = "k3$9vQ!m2Lp#8xZr@7tWc^5nYb&1hJd*4gFs(6eKa)0uTqRi%Gz"
    settings.ALLOWED_HOSTS = ["pilot.example.in"]
    settings.GEMINI_API_KEY = "configured"
    settings.BACKUP_DIR = tmp_path
    (tmp_path / "student_ai-20261024-020000.dump").write_bytes(b"PGDMP")
    return settings


def run_check(*args, encoding=None):
    if encoding:
        raw = io.BytesIO()
        out = io.TextIOWrapper(raw, encoding=encoding)
        call_command("pilot_check", *args, stdout=out, no_color=True)
        out.flush()
        return raw.getvalue().decode(encoding)
    out = io.StringIO()
    call_command("pilot_check", *args, stdout=out, no_color=True)
    return out.getvalue()


def test_a_ready_installation_passes_strict_with_warnings_only(ready_settings, monkeypatch, cohort):
    monkeypatch.setattr(pilot_check, "check_nightly",
                        lambda now: pilot_check.Check("The nightly job ran recently", "pass"))
    paper = f.make_paper(cohort, "JEE 2026", dt.date(2026, 4, 2))
    QuestionTopicMap.objects.create(institute=cohort.institute, test_paper=paper, question_id="Q9",
                                    verification="disagreed")
    printed = run_check("--strict")                        # does not raise
    assert "✓ DEBUG is off" in printed
    assert "! Answer-key disagreements reviewed — 1 unreviewed" in printed
    assert "! Cache is shared between workers" in printed   # the test cache is per-process
    assert "0 blocking" in printed


def test_a_demo_password_blocks_a_strict_check(ready_settings, monkeypatch, cohort):
    monkeypatch.setattr(pilot_check, "check_nightly",
                        lambda now: pilot_check.Check("The nightly job ran recently", "pass"))
    demo_staff(cohort, "aarambh.rao")
    printed = run_check()                                  # without --strict: a report, exit 0
    assert "✗ No staff account uses the demo password — 1 still on it: aarambh.rao" in printed
    with pytest.raises(CommandError, match="1 blocking"):
        run_check("--strict")

    call_command("rotate_demo_passwords", stdout=io.StringIO(), stderr=io.StringIO())
    assert "0 blocking" in run_check("--strict")


def test_a_terminal_that_cannot_print_ticks_gets_ascii(ready_settings, monkeypatch):
    monkeypatch.setattr(pilot_check, "check_nightly",
                        lambda now: pilot_check.Check("The nightly job ran recently", "pass"))
    printed = run_check(encoding="cp1252")
    assert "[ok] DEBUG is off" in printed and "✓" not in printed


# ====================================================== rotate_demo_passwords


@pytest.fixture
def staff(cohort, other_cohort):
    return types.SimpleNamespace(
        rao=demo_staff(cohort, "aarambh.rao"),
        mehta=demo_staff(cohort, "aarambh.mehta"),
        iyer=demo_staff(cohort, "aarambh.iyer", password="chosen-long-password"),
        elsewhere=demo_staff(other_cohort, "pinnacle.rao"),
        director=f.UserFactory(username="director", password=make_password("demo12345"),
                               is_staff=True),
        student=f.make_student_user(f.make_student(cohort, "Kid"), "kid", password="demo12345"),
    )


def rotate_cmd(*args):
    out, err = io.StringIO(), io.StringIO()
    call_command("rotate_demo_passwords", *args, stdout=out, stderr=err)
    return out.getvalue(), err.getvalue()


def credentials(csv_text: str) -> dict[str, dict]:
    import csv

    return {row["username"]: row for row in csv.DictReader(io.StringIO(csv_text))}


def test_a_dry_run_changes_nothing(staff):
    before = {u.pk: u.password for u in User.objects.all()}
    out, err = rotate_cmd("--dry-run")
    assert out == "" and "4 account(s) on the demo password" in err
    assert {u.pk: u.password for u in User.objects.all()} == before


def test_one_institute_rotates_only_its_own_mentors(staff, cohort):
    out, err = rotate_cmd("--institute", cohort.institute.slug)
    issued = credentials(out)
    assert set(issued) == {"aarambh.rao", "aarambh.mehta"}
    row = issued["aarambh.rao"]
    assert (row["role"], row["institute"]) == ("mentor", cohort.institute.slug)

    staff.rao.refresh_from_db()
    assert staff.rao.must_change_password
    assert check_password(row["temporary_password"], staff.rao.password)
    assert not check_password("demo12345", staff.rao.password)
    assert len(row["temporary_password"].replace("-", "")) == 16

    # Untouched: a chosen password, another institute, a director, a student.
    for user in (staff.iyer, staff.elsewhere, staff.director, staff.student):
        before = user.password
        user.refresh_from_db()
        assert user.password == before and not user.must_change_password, user.username


def test_without_an_institute_every_staff_account_is_rotated_and_a_rerun_does_nothing(staff):
    issued = credentials(rotate_cmd()[0])
    assert set(issued) == {"aarambh.rao", "aarambh.mehta", "pinnacle.rao", "director"}
    assert issued["director"]["role"] == "director"
    staff.student.refresh_from_db()
    assert check_password("demo12345", staff.student.password), "students are not staff"

    out, err = rotate_cmd()
    assert out == "" and "0 staff password(s) rotated" in err


def test_the_new_passwords_can_go_to_a_file(staff, cohort, tmp_path):
    target = tmp_path / "staff.csv"
    out, err = rotate_cmd("--institute", str(cohort.institute.id), "--out", str(target))
    assert out == "" and "the only copy" in err
    assert set(credentials(target.read_text(encoding="utf-8"))) == {"aarambh.rao", "aarambh.mehta"}


def test_an_unknown_institute_is_an_error(staff):
    with pytest.raises(CommandError, match="No institute"):
        rotate_cmd("--institute", "nowhere")


def test_the_staff_password_is_long_and_unambiguous():
    password = rotate.staff_password()
    assert len(password) == 19 and password.count("-") == 3
    assert not set(password.replace("-", "")) & set("01ILO")
