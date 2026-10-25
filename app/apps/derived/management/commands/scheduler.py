"""Keep the nightly refresh running: `run_nightly` once a day, at NIGHTLY_AT.

    python manage.py scheduler                 # runs until Ctrl-C
    python manage.py scheduler --at 03:30      # override settings.NIGHTLY_AT
    python manage.py scheduler --once          # check once, run if due, exit

A deliberately small loop rather than Celery beat or django-q2: one process,
no broker, nothing to install. Every minute it asks one question — is it
past today's run time, and is there an institute without a successful
nightly run today? — and if so runs `run_nightly` for those institutes.

THE THREE PROMISES
    * **Never twice in a day.** An institute with an `ok` `JobRun` started
      today is skipped, so restarting the scheduler, or running it next to a
      hand-run `run_nightly`, cannot double-run anyone. (An institute whose
      run *failed* is tried again only when the scheduler is next started, or
      the next day — a failure that repeats every minute would only bury the
      first error under copies of itself.)
    * **Catches up.** Started after the run time — a laptop that was asleep
      at 02:00 — it runs straight away for whoever has not been refreshed
      today, instead of waiting until tomorrow.
    * **Ctrl-C safe.** Stopping it between runs is clean. Stopping it in the
      middle of a run rolls back the step in progress (each step is a
      transaction) and leaves no `JobRun` for that institute, so the next
      start redoes it.

THE ALTERNATIVE: LET THE OPERATING SYSTEM SCHEDULE IT
    This loop needs a terminal (or a service wrapper) kept open. If that is
    awkward, do not run it at all and schedule `run_nightly` directly — it is
    idempotent and records the same `JobRun` receipts:

    Windows Task Scheduler (one line, run once in an admin prompt):
        schtasks /Create /SC DAILY /ST 02:00 /TN "StudentAI nightly" /TR
            "C:\\path\\to\\app\\.venv\\Scripts\\python.exe
             C:\\path\\to\\app\\manage.py run_nightly"

    cron (Linux/macOS), `crontab -e`:
        0 2 * * *  cd /path/to/app && .venv/bin/python manage.py run_nightly >> nightly.log 2>&1

    Either way `run_nightly` exits non-zero when an institute failed, which
    is what both tools show as a failed run.
"""

from __future__ import annotations

import datetime as dt
import logging
import time

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.derived.models import JobRun
from apps.derived.services import nightly
from apps.tenancy.models import Institute

logger = logging.getLogger(__name__)

#: How often the loop wakes to ask whether the run is due.
POLL_SECONDS = 60


def parse_at(raw: str) -> dt.time:
    """`"HH:MM"` (24-hour, local time) as a `time`. ValueError otherwise."""
    try:
        hours, minutes = raw.strip().split(":")
        if len(hours) not in (1, 2) or len(minutes) != 2:
            raise ValueError
        return dt.time(int(hours), int(minutes))
    except (AttributeError, TypeError, ValueError):
        raise ValueError(f"{raw!r} is not a 24-hour time written HH:MM") from None


def is_due(now: dt.datetime, at: dt.time) -> bool:
    """Whether today's run time has arrived (local time). Pure."""
    return now.time() >= at


class Command(BaseCommand):
    help = (
        "Long-running: run `run_nightly` once a day at settings.NIGHTLY_AT (env NIGHTLY_AT, "
        "default 02:00 local), never twice in a day for an institute that already has a "
        "successful JobRun, catching up straight away if started late. Ctrl-C to stop. "
        "ALTERNATIVE: don't keep this running at all; schedule `manage.py run_nightly` "
        "daily with Windows Task Scheduler (schtasks /Create /SC DAILY /ST 02:00 /TN "
        "\"StudentAI nightly\" /TR \"<python.exe> <app>\\manage.py run_nightly\") or cron "
        "(0 2 * * * cd <app> && python manage.py run_nightly). It is idempotent and records "
        "the same JobRun receipts."
    )

    def add_arguments(self, parser):
        parser.add_argument("--at", default=None,
                            help="HH:MM local time to run at. Default: settings.NIGHTLY_AT.")
        parser.add_argument("--once", action="store_true",
                            help="Check once: run if due and not yet done today, then exit.")
        parser.add_argument("--institute", action="append", default=None,
                            help="Institute id or slug. Repeatable. Default: all.")

    # Seams for tests: the clock and the sleep.
    def _now(self) -> dt.datetime:
        return timezone.localtime()

    def _sleep(self, seconds: float) -> None:
        time.sleep(seconds)

    def handle(self, *args, **opts):
        raw = opts["at"] or getattr(settings, "NIGHTLY_AT", "02:00")
        try:
            at = parse_at(raw)
        except ValueError as exc:
            raise CommandError(f"NIGHTLY_AT / --at: {exc}") from None
        refs = opts["institute"]
        self._institutes(refs)                 # fail fast on a typo, not at 02:00

        if opts["once"]:
            if is_due(self._now(), at):
                self._run(refs)
            else:
                self._say(f"not due yet: the nightly run is at {at:%H:%M}.")
            return

        self._say(f"scheduler started; nightly run at {at:%H:%M} local. Ctrl-C to stop.")
        attempted_on: dt.date | None = None
        try:
            while True:
                now = self._now()
                if is_due(now, at) and attempted_on != now.date():
                    attempted_on = now.date()
                    self._run(refs)
                self._sleep(POLL_SECONDS)
        except KeyboardInterrupt:
            self._say("scheduler stopped.")

    def _run(self, refs) -> None:
        results = nightly.run_nightly(self._institutes(refs), skip_done_today=True)
        if not results:
            self._say("nothing to do: every institute has already been refreshed today.")
            return
        for inst, run in results:
            if run is not None and run.status == JobRun.OK:
                self._say(f"{inst.name}: ok")
            else:
                why = run.error if run is not None else "could not run (see the log)"
                self._say(f"{inst.name}: FAILED - {why}", error=True)

    def _say(self, message: str, *, error: bool = False) -> None:
        # Plain ASCII on purpose: under Task Scheduler or cron this lands in a
        # redirected file in whatever encoding the machine defaults to.
        line = f"[{self._now():%Y-%m-%d %H:%M:%S}] {message}"
        (logger.error if error else logger.info)(message)
        self.stdout.write(self.style.ERROR(line) if error else line)

    def _institutes(self, refs):
        if not refs:
            return list(Institute.objects.order_by("id"))
        out = []
        for token in refs:
            qs = (Institute.objects.filter(id=int(token)) if token.isdigit()
                  else Institute.objects.filter(slug=token))
            inst = qs.first()
            if inst is None:
                raise CommandError(f"No institute matching {token!r}")
            out.append(inst)
        return out
