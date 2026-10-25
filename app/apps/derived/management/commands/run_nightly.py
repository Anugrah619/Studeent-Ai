"""The nightly refresh, for every institute or the ones named.

    python manage.py run_nightly
    python manage.py run_nightly --institute aarambh --institute 2
    python manage.py run_nightly --as-of 2026-10-20T02:00

Per institute, inside `tenant_scope`: recompute the feature store, schedule
revisions, run the detectors, then make today's plan for every active
student (never replacing one that exists). See
`apps/derived/services/nightly.py` for the order and what a failure leaves
behind. Each institute leaves a `JobRun` receipt; one failing does not stop
the rest, and the command exits non-zero if any did, so a cron job or Task
Scheduler entry shows the failure.

To run it every night without a terminal open, either keep
`manage.py scheduler` running, or schedule this command itself — see
`manage.py scheduler --help`.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.derived.models import JobRun
from apps.derived.services import nightly
from apps.tenancy.models import Institute


class Command(BaseCommand):
    help = (
        "Nightly refresh: features, revisions, detectors, then plans, per institute. "
        "Records a JobRun per institute."
    )

    def add_arguments(self, parser):
        parser.add_argument("--institute", action="append", default=None,
                            help="Institute id or slug. Repeatable. Default: all.")
        parser.add_argument("--as-of", default=None,
                            help="ISO timestamp to treat as 'now'. Plans are only made "
                                 "when it falls on today or the coming week.")

    def handle(self, *args, **opts):
        as_of = self._as_of(opts["as_of"])
        results = nightly.run_nightly(self._institutes(opts["institute"]), as_of=as_of)

        failed = 0
        for inst, run in results:
            if run is None or run.status != JobRun.OK:
                failed += 1
                why = run.error if run is not None else "could not run (see the log)"
                self.stdout.write(self.style.ERROR(f"  {inst.name:<24} FAILED  {why}"))
                continue
            s = run.stats
            self.stdout.write(
                f"  {inst.name:<24} ok  "
                f"topic+student rows={s['features']['rows_written']}  "
                f"revisions={s['revisions']['created']}  "
                f"flags={s['detectors']['raised']}  "
                f"plans={s['plans'].get('generated', 0)}  "
                f"{sum(s['timings_ms'].values())} ms"
            )
        self.stdout.write(
            self.style.SUCCESS(f"{len(results) - failed} institute(s) refreshed as of {as_of:%Y-%m-%d %H:%M}.")
            if not failed else
            self.style.WARNING(f"{failed} of {len(results)} institute(s) failed.")
        )
        if failed:
            raise CommandError(f"{failed} institute(s) failed; see JobRun.error and the log.")

    def _as_of(self, raw):
        if not raw:
            return timezone.now()
        parsed = parse_datetime(raw)
        if parsed is None:
            raise CommandError(f"--as-of is not an ISO timestamp: {raw!r}")
        return timezone.make_aware(parsed) if timezone.is_naive(parsed) else parsed

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
