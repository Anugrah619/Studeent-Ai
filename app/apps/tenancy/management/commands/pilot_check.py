"""Is this installation ready to put in front of a real institute?

    python manage.py pilot_check
    python manage.py pilot_check --strict      # exit 1 on any blocking failure

One line per check — ✓ passed, ✗ blocking, ! warning, – skipped — so it can be
read top to bottom before a pilot starts and run again by a scheduler after.
`--strict` exits non-zero when anything blocking failed; warnings never fail it.

WHAT IS BLOCKING, AND WHY
    Blocking means "a real student's data is at risk, or the product's central
    claim cannot be made": debug pages on, a weak secret key, every host
    allowed, a client-written `X-Forwarded-For` trusted, a staff account still
    on the demo password, no reasoning key, no recent backup, no recent nightly
    run. Warnings are true and worth fixing but survivable for a single-server
    pilot: a per-process cache, hosts that are only loopback, unreviewed
    answer-key disagreements.

NOTHING HERE CHANGES ANYTHING
    Passwords are compared with `hashers.check_password`, not
    `User.check_password`, because the latter re-saves an account whose hash
    needs upgrading — a check must not write. It does cost one password hash
    per staff account (about a second each with Django's default hasher).
"""

from __future__ import annotations

import dataclasses
import datetime as dt
from pathlib import Path

from django.conf import settings
from django.contrib.auth.hashers import check_password
from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError
from django.utils import timezone

#: The password `seed_demo` gives every staff account.
DEMO_PASSWORD = "demo12345"

#: A daily job, plus slack for one late run.
MAX_BACKUP_AGE_HOURS = 26
MAX_NIGHTLY_AGE_HOURS = 26

LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "[::1]", "::1"}
PER_PROCESS_CACHES = {
    "django.core.cache.backends.locmem.LocMemCache",
    "django.core.cache.backends.dummy.DummyCache",
}

PASS, FAIL, WARN, SKIP = "pass", "fail", "warn", "skip"
MARKS = {PASS: "✓", FAIL: "✗", WARN: "!", SKIP: "–"}
ASCII_MARKS = {PASS: "[ok]", FAIL: "[FAIL]", WARN: "[warn]", SKIP: "[skip]"}


@dataclasses.dataclass
class Check:
    name: str
    status: str
    detail: str = ""


# ---------------------------------------------------------------- the checks
# Small functions over explicit inputs, so each rule is testable on its own.


def check_debug(debug: bool) -> Check:
    if debug:
        return Check("DEBUG is off", FAIL,
                     "DEBUG is on: error pages show settings, SQL and stack traces to anyone.")
    return Check("DEBUG is off", PASS)


def check_secret_key(key: str) -> Check:
    """Django's own deployment test (`security.W009`), plus the placeholder."""
    name = "SECRET_KEY is strong"
    if not key or key.startswith("django-insecure") or key == "generate-your-own":
        return Check(name, FAIL, "SECRET_KEY is a placeholder or Django's insecure default.")
    if len(key) < 50 or len(set(key)) < 5:
        return Check(name, FAIL, "SECRET_KEY must be at least 50 characters with 5+ distinct ones.")
    return Check(name, PASS)


def check_allowed_hosts(hosts: list[str]) -> Check:
    name = "ALLOWED_HOSTS is specific"
    if not hosts:
        return Check(name, FAIL, "ALLOWED_HOSTS is empty; with DEBUG off nothing will be served.")
    if "*" in hosts:
        return Check(name, FAIL, "ALLOWED_HOSTS contains '*': any Host header is accepted.")
    if set(hosts) <= LOOPBACK_HOSTS:
        return Check(name, WARN, "Only loopback hosts — fine on one machine; add the pilot's "
                                 "hostname before anyone else connects.")
    return Check(name, PASS, ", ".join(hosts))


def check_num_proxies(value) -> Check:
    name = "NUM_PROXIES is set deliberately"
    if value is None:
        return Check(name, FAIL, "NUM_PROXIES is unset, so DRF believes X-Forwarded-For as the "
                                 "client wrote it and every throttle can be walked around.")
    if not isinstance(value, int) or value < 0:
        return Check(name, FAIL, f"NUM_PROXIES must be a whole number >= 0, not {value!r}.")
    if value > 2:
        return Check(name, WARN, f"NUM_PROXIES is {value}; more than two proxies is unusual. "
                                 "Too high a number lets a client choose its own address.")
    where = "clients are identified by socket address" if value == 0 else \
        f"the client is the address {value} proxy hop(s) back"
    return Check(name, PASS, f"{value}: {where}.")


def check_cache(backend: str) -> Check:
    name = "Cache is shared between workers"
    if backend in PER_PROCESS_CACHES:
        return Check(name, WARN, f"{backend.rsplit('.', 1)[-1]} is per-process: login and upload "
                                 "throttles are counted per worker. Fine for one worker only.")
    return Check(name, PASS, backend.rsplit(".", 1)[-1])


def check_demo_passwords(usernames: list[str]) -> Check:
    name = "No staff account uses the demo password"
    if usernames:
        shown = ", ".join(usernames[:10]) + (f" and {len(usernames) - 10} more" if len(usernames) > 10 else "")
        return Check(name, FAIL, f"{len(usernames)} still on it: {shown}. "
                                 "Run `manage.py rotate_demo_passwords`.")
    return Check(name, PASS)


def check_gemini_key(key: str) -> Check:
    name = "Reasoning key (GEMINI_API_KEY) is set"
    if not key:
        return Check(name, FAIL, "Without it no new diagnosis can be made; only cached ones replay.")
    return Check(name, PASS)


def check_disagreements(unreviewed: int) -> Check:
    name = "Answer-key disagreements reviewed"
    if unreviewed:
        return Check(name, WARN, f"{unreviewed} unreviewed — GET /api/review/disagreements/"
                                 "?status=unreviewed.")
    return Check(name, PASS)


def latest_backup(directory: Path) -> Path | None:
    if not directory.is_dir():
        return None
    dumps = [p for p in directory.glob("*.dump") if p.is_file()]
    return max(dumps, key=lambda p: p.stat().st_mtime) if dumps else None


def check_backup(directory: Path, now: dt.datetime) -> Check:
    name = "A recent backup exists"
    newest = latest_backup(directory)
    if newest is None:
        return Check(name, FAIL, f"No backup in {directory}. Run `manage.py backup_db --verify`.")
    taken = dt.datetime.fromtimestamp(newest.stat().st_mtime, tz=dt.timezone.utc)
    hours = (now - taken).total_seconds() / 3600
    if hours > MAX_BACKUP_AGE_HOURS:
        return Check(name, FAIL, f"Newest is {newest.name}, {hours:.0f} hours old "
                                 f"(limit {MAX_BACKUP_AGE_HOURS}).")
    return Check(name, PASS, f"{newest.name}, {hours:.1f} hours old.")


def check_nightly(now: dt.datetime) -> Check:
    """The last nightly run, from `apps.derived.models.JobRun` — if that exists yet.

    Imported here rather than at module level: the model is newer than this
    command, and a deployment without it should skip the check, not fail to
    import the command.
    """
    name = "The nightly job ran recently"
    try:
        from apps.derived.models import JobRun
    except ImportError:
        return Check(name, SKIP, "No JobRun model in this build; nightly runs are not recorded.")
    try:
        last = (
            JobRun.objects.filter(finished_at__isnull=False)
            .order_by("-finished_at").first()
        )
    except DatabaseError:
        return Check(name, SKIP, "The JobRun table is not migrated yet.")
    if last is None:
        return Check(name, FAIL, "No nightly run has ever finished.")
    status = str(getattr(last, "status", "") or "")
    hours = (now - last.finished_at).total_seconds() / 3600
    if any(word in status.lower() for word in ("fail", "error")):
        return Check(name, FAIL, f"The last run ({hours:.0f} hours ago) ended '{status}'.")
    if hours > MAX_NIGHTLY_AGE_HOURS:
        return Check(name, FAIL, f"The last run finished {hours:.0f} hours ago "
                                 f"(limit {MAX_NIGHTLY_AGE_HOURS}).")
    return Check(name, PASS, f"Finished {hours:.1f} hours ago" + (f", '{status}'." if status else "."))


def staff_on_demo_password() -> list[str]:
    """Active non-student accounts whose password is still `DEMO_PASSWORD`."""
    from apps.tenancy.models import User

    return [
        user.username
        for user in User.objects.filter(is_active=True, student__isnull=True).order_by("username")
        if user.has_usable_password() and check_password(DEMO_PASSWORD, user.password)
    ]


def run_checks(now: dt.datetime | None = None) -> list[Check]:
    from apps.ingestion.services.review import unreviewed_count

    now = now or timezone.now()
    caches = getattr(settings, "CACHES", {}) or {}
    backend = (caches.get("default") or {}).get(
        "BACKEND", "django.core.cache.backends.locmem.LocMemCache"
    )
    return [
        check_debug(settings.DEBUG),
        check_secret_key(settings.SECRET_KEY),
        check_allowed_hosts(list(settings.ALLOWED_HOSTS)),
        check_num_proxies(settings.REST_FRAMEWORK.get("NUM_PROXIES")),
        check_cache(backend),
        check_demo_passwords(staff_on_demo_password()),
        check_gemini_key(getattr(settings, "GEMINI_API_KEY", "")),
        check_disagreements(unreviewed_count()),
        check_backup(Path(settings.BACKUP_DIR), now),
        check_nightly(now),
    ]


class Command(BaseCommand):
    help = (
        "Pilot readiness: one ✓/✗ line per check (DEBUG, SECRET_KEY, ALLOWED_HOSTS, "
        "NUM_PROXIES, cache, demo passwords, Gemini key, answer-key disagreements, "
        "backup age, nightly run). --strict exits non-zero on a blocking failure."
    )

    def add_arguments(self, parser):
        parser.add_argument("--strict", action="store_true",
                            help="Exit with status 1 if any blocking check fails.")

    def handle(self, *args, **opts):
        marks = self._marks()
        checks = run_checks()
        for c in checks:
            line = f"{marks[c.status]} {c.name}" + (f" — {c.detail}" if c.detail else "")
            style = {FAIL: self.style.ERROR, WARN: self.style.WARNING,
                     PASS: self.style.SUCCESS}.get(c.status, str)
            self.stdout.write(style(line))

        failed = [c for c in checks if c.status == FAIL]
        warned = [c for c in checks if c.status == WARN]
        summary = (
            f"{len(checks) - len(failed) - len(warned)} passed, {len(failed)} blocking, "
            f"{len(warned)} warning(s)."
        )
        self.stdout.write(summary)
        if failed and opts["strict"]:
            raise CommandError(f"Not ready for a pilot: {len(failed)} blocking check(s) failed.")

    def _marks(self) -> dict[str, str]:
        """✓ and ✗ where the terminal can print them, `[ok]`/`[FAIL]` where it cannot.

        A Windows console redirected to a file is often cp1252, and a readiness
        check that crashes on its own tick mark is not much of a check.
        """
        encoding = getattr(getattr(self.stdout, "_out", None), "encoding", None) or "utf-8"
        try:
            "".join(MARKS.values()).encode(encoding)
        except (UnicodeEncodeError, LookupError):
            return ASCII_MARKS
        return MARKS
