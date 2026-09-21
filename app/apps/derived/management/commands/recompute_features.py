"""Rebuild the feature store from the event log.

    python manage.py recompute_features                      # every institute
    python manage.py recompute_features --institute aarambh
    python manage.py recompute_features --student 1 --student 2
    python manage.py recompute_features --as-of 2026-08-30T12:00
    python manage.py recompute_features --rebuild            # drop first

This is the nightly job and the after-ingest job. Both are the same code
path, because the only difference between them is `--student`.

Two flags worth knowing:

`--as-of` fixes the clock. Everything date-relative in the feature store
reads it instead of `timezone.now()`, so two runs with the same `--as-of`
over the same events produce byte-identical rows. That is what makes the
rebuild-equivalence test (TECHNICAL_DOC.md §14) an equality assertion
rather than an approximation.

`--rebuild` deletes the derived rows in scope before recomputing, which
proves the stronger claim: derived state is not merely refreshable, it is
disposable. If `--rebuild` and a plain run disagree, the incremental path
has a bug and the nightly pass is the thing that should be trusted.

RLS: each institute is processed inside `tenant_scope()`, so the
connection drops to the unprivileged role and a cross-tenant write is
refused by Postgres rather than merely absent from the WHERE clause.
"""

from __future__ import annotations

import datetime as dt
import time

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.derived.models import StudentState, TopicState
from apps.derived.services import features
from apps.tenancy.models import Institute
from apps.tenancy.rls import tenant_scope


class Command(BaseCommand):
    help = "Recompute TopicState and StudentState from the event tables."

    def add_arguments(self, parser):
        parser.add_argument(
            "--institute",
            action="append",
            default=None,
            help="Institute id or slug. Repeatable. Default: all institutes.",
        )
        parser.add_argument(
            "--student",
            action="append",
            type=int,
            default=None,
            help="Limit to these student ids. Repeatable.",
        )
        parser.add_argument(
            "--as-of",
            default=None,
            help="ISO timestamp to treat as 'now'. Makes the run reproducible.",
        )
        parser.add_argument(
            "--only",
            choices=["topic", "student"],
            default=None,
            help="Run only one of the two passes.",
        )
        parser.add_argument(
            "--rebuild",
            action="store_true",
            help="Delete derived rows in scope first, then recompute from events.",
        )
        parser.add_argument(
            "--no-rls",
            action="store_true",
            help="Skip tenant_scope. Only for debugging a permissions problem.",
        )

    def handle(self, *args, **opts):
        as_of = self._as_of(opts["as_of"])
        institutes = self._institutes(opts["institute"])
        student_ids = opts["student"]

        self.stdout.write(
            f"feature version {features.FEATURE_VERSION}  "
            f"as_of={as_of.isoformat()}  institutes={len(institutes)}"
        )

        grand = {"written": 0, "deleted": 0, "reported": 0, "withheld": 0}
        for inst in institutes:
            started = time.perf_counter()
            with self._scope(inst.id, opts["no_rls"]):
                if opts["rebuild"]:
                    self._drop(inst.id, student_ids, opts["only"])
                if opts["only"] == "student":
                    stats = features.recompute_student_state(inst.id, student_ids, as_of)
                elif opts["only"] == "topic":
                    stats = features.recompute_topic_state(inst.id, student_ids, as_of)
                else:
                    stats = features.recompute(inst.id, student_ids, as_of)
            elapsed = (time.perf_counter() - started) * 1000

            grand["written"] += stats.rows_written
            grand["deleted"] += stats.rows_deleted
            grand["reported"] += stats.mastery_reported
            grand["withheld"] += stats.mastery_withheld
            self.stdout.write(
                f"  {inst.name:<24} students={stats.students:<4} "
                f"rows={stats.rows_written:<6} deleted={stats.rows_deleted:<4} "
                f"{elapsed:7.0f} ms"
            )

        withheld = grand["withheld"]
        total_mastery = grand["reported"] + withheld
        share = f"{withheld / total_mastery:.0%}" if total_mastery else "n/a"
        self.stdout.write("")
        self.stdout.write(
            self.style.SUCCESS(
                f"  {grand['written']:,} rows written, {grand['deleted']:,} deleted"
            )
        )
        self.stdout.write(
            f"  mastery reported on {grand['reported']:,} topic states, "
            f"withheld on {withheld:,} ({share}) below the "
            f"{features.EVIDENCE_FLOOR}-attempt evidence floor"
        )

    # ------------------------------------------------------------ helpers

    def _scope(self, institute_id: int, no_rls: bool):
        if no_rls:
            import contextlib

            return contextlib.nullcontext()
        return tenant_scope(institute_id)

    def _as_of(self, raw: str | None) -> dt.datetime:
        if not raw:
            return timezone.now()
        parsed = parse_datetime(raw)
        if parsed is None:
            raise CommandError(f"--as-of is not an ISO timestamp: {raw!r}")
        if timezone.is_naive(parsed):
            parsed = timezone.make_aware(parsed)
        return parsed

    def _institutes(self, raw: list[str] | None) -> list[Institute]:
        if not raw:
            return list(Institute.objects.order_by("id"))
        found = []
        for token in raw:
            qs = Institute.objects.filter(slug=token)
            if token.isdigit():
                qs = Institute.objects.filter(id=int(token))
            inst = qs.first()
            if inst is None:
                raise CommandError(f"No institute matching {token!r}")
            found.append(inst)
        return found

    def _drop(self, institute_id: int, student_ids, only):
        topic_qs = TopicState.objects.filter(institute_id=institute_id)
        student_qs = StudentState.objects.filter(institute_id=institute_id)
        if student_ids:
            topic_qs = topic_qs.filter(student_id__in=student_ids)
            student_qs = student_qs.filter(student_id__in=student_ids)
        if only != "student":
            self.stdout.write(f"  dropped {topic_qs.delete()[0]:,} topic states")
        if only != "topic":
            self.stdout.write(f"  dropped {student_qs.delete()[0]:,} student states")
