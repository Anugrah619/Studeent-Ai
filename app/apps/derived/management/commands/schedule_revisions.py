"""Schedule the next revision cycle for every chapter that has earned one.

    python manage.py schedule_revisions                       # every institute
    python manage.py schedule_revisions --institute aarambh
    python manage.py schedule_revisions --student 12 --student 14
    python manage.py schedule_revisions --date 2026-10-20     # as if today were…

The rules are in `apps/derived/services/revisions.py`: R1 the day after a
chapter is first met, R2 a week after R1 is done, R3 a month after R2, never
past the batch's exam, nothing into the past. Append-only and idempotent —
running it twice writes nothing the second time — so it is safe to run by
hand on top of the nightly job (`run_nightly`), which also runs it.

RLS: each institute runs inside `tenant_scope()`, like `recompute_features`.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from django.utils.dateparse import parse_date

from apps.derived.services import revisions
from apps.tenancy.models import Institute
from apps.tenancy.rls import tenant_scope


class Command(BaseCommand):
    help = "Schedule due revision cycles (R1/R2/R3) from the event log. Idempotent."

    def add_arguments(self, parser):
        parser.add_argument("--institute", action="append", default=None,
                            help="Institute id or slug. Repeatable. Default: all.")
        parser.add_argument("--student", action="append", type=int, default=None,
                            help="Limit to these student ids. Repeatable.")
        parser.add_argument("--date", default=None,
                            help="YYYY-MM-DD to treat as today. Default: today.")

    def handle(self, *args, **opts):
        today = timezone.localdate()
        if opts["date"]:
            try:
                today = parse_date(opts["date"])
            except ValueError:
                today = None
            if today is None:
                raise CommandError("--date must be a calendar date written YYYY-MM-DD.")

        created = 0
        for inst in self._institutes(opts["institute"]):
            with tenant_scope(inst.id):
                counts = revisions.schedule_revisions(inst.id, opts["student"], today)
            created += counts["created"]
            by_cycle = " ".join(f"R{c}={n}" for c, n in counts["by_cycle"].items())
            self.stdout.write(
                f"  {inst.name:<24} students={counts['students']:<4} "
                f"created={counts['created']:<5} {by_cycle}  "
                f"capped_at_exam={counts[revisions.CAPPED]} "
                f"no_time_before_exam={counts[revisions.NO_TIME]} "
                f"stale={counts[revisions.STALE]}"
            )
        self.stdout.write(self.style.SUCCESS(f"{created} revision(s) scheduled as of {today}."))

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
