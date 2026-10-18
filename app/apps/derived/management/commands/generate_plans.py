"""Build today's study plan for every active student.

    python manage.py generate_plans
    python manage.py generate_plans --institute aarambh
    python manage.py generate_plans --date 2026-10-20
    python manage.py generate_plans --replace          # rebuild; ticks are kept

This is the nightly job once there is something to run it nightly. Students
can also build their own on demand (`POST /api/my/plan/generate/`); both call
`planner.generate_for_student`, which is idempotent, so running this and then a
student pressing the button yields one plan, not two.

Run `recompute_features` first: the plan reads mastery and revision state from
the feature store, and a stale store plans last week's priorities.
"""

from __future__ import annotations

import datetime as dt
import time

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from django.utils.dateparse import parse_date

from apps.derived.services import planner
from apps.tenancy.models import Institute, Student
from apps.tenancy.rls import tenant_scope


class Command(BaseCommand):
    help = "Generate the day plan for every active student."

    def add_arguments(self, parser):
        parser.add_argument("--institute", action="append", default=None,
                            help="Institute id or slug. Repeatable. Default: all.")
        parser.add_argument("--date", default=None, help="YYYY-MM-DD. Default: today.")
        parser.add_argument("--replace", action="store_true",
                            help="Rebuild existing plans (completed blocks are kept).")

    def handle(self, *args, **opts):
        today = timezone.localdate()
        day = parse_date(opts["date"]) if opts["date"] else today
        if day is None:
            raise CommandError("--date must be YYYY-MM-DD.")
        if not today <= day <= today + dt.timedelta(days=planner.MAX_DAYS_AHEAD):
            raise CommandError(
                f"--date must be today or up to {planner.MAX_DAYS_AHEAD} days ahead."
            )

        institutes = self._institutes(opts["institute"])
        total_students = total_blocks = empty = 0
        for institute in institutes:
            started = time.perf_counter()
            made = 0
            with tenant_scope(institute.id):
                students = Student.objects.filter(institute=institute, exited_at__isnull=True)
                for student in students.select_related("batch"):
                    blocks, generated = planner.generate_for_student(
                        student, day, replace=opts["replace"]
                    )
                    total_students += 1
                    made += len(blocks) if generated else 0
                    total_blocks += len(blocks) if generated else 0
                    empty += 0 if blocks else 1
            self.stdout.write(
                f"  {institute.name:<24} blocks made={made:<5} "
                f"{(time.perf_counter() - started) * 1000:7.0f} ms"
            )

        self.stdout.write(self.style.SUCCESS(
            f"{total_blocks} block(s) for {total_students} student(s) on {day}."
        ))
        if empty:
            self.stdout.write(
                f"  {empty} student(s) have nothing to plan yet (no taught chapters "
                "with evidence, no revisions due)."
            )

    def _institutes(self, refs):
        qs = Institute.objects.all()
        if refs:
            ids = [int(r) for r in refs if r.isdigit()]
            slugs = [r for r in refs if not r.isdigit()]
            qs = qs.filter(pk__in=ids) | qs.filter(slug__in=slugs)
        institutes = list(qs.distinct().order_by("name"))
        if not institutes:
            raise CommandError("No institutes match.")
        return institutes
