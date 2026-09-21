"""Evaluate the detector catalogue and raise flags.

    python manage.py run_detectors                        # every institute
    python manage.py run_detectors --dry-run              # evaluate, write nothing
    python manage.py run_detectors --only subject_imbalance --explain "Aarav Mehta"
    python manage.py run_detectors --tier 0
    python manage.py run_detectors --as-of 2026-09-20T12:00

`--dry-run` is the one to reach for first. It prints every detector that
would fire, and — crucially — every one the cooldown *would have*
suppressed and why. On a console that already has flags in it, that
distinction is the difference between "the detector is broken" and "the
detector is working and the mentor already knows".

`--explain <name or id>` prints the full evidence dict for one student,
which is the answer to a director asking "why was this flagged?" and the
fastest way to tune a threshold.

Run `recompute_features` first: every detector reads the feature store,
and a stale store produces confident flags about last month.
"""

from __future__ import annotations

import datetime as dt
import json
import time

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.derived.services import detectors as det
from apps.tenancy.models import Institute, Student
from apps.tenancy.rls import tenant_scope

SEVERITY_ORDER = ["critical", "high", "watch", "improving"]


class Command(BaseCommand):
    help = "Run the detector catalogue over the feature store and raise flags."

    def add_arguments(self, parser):
        parser.add_argument("--institute", action="append", default=None)
        parser.add_argument("--student", action="append", type=int, default=None)
        parser.add_argument("--as-of", default=None)
        parser.add_argument(
            "--only", action="append", default=None, help="Detector type. Repeatable."
        )
        parser.add_argument("--tier", type=int, choices=[0, 1], default=None)
        parser.add_argument(
            "--dry-run", action="store_true", help="Evaluate and print; write nothing."
        )
        parser.add_argument(
            "--ignore-cooldown",
            action="store_true",
            help="Evaluate as if no flag had ever been raised. Implies --dry-run "
            "unless you really mean it.",
        )
        parser.add_argument(
            "--explain",
            default=None,
            help="Student id or name. Print full evidence for every detector.",
        )
        parser.add_argument("--list", action="store_true", help="Show the catalogue and exit.")
        parser.add_argument("--no-rls", action="store_true")

    def handle(self, *args, **opts):
        if opts["list"]:
            return self._list()

        as_of = self._as_of(opts["as_of"])
        institutes = self._institutes(opts["institute"])
        only = opts["only"]
        if only:
            unknown = set(only) - set(det.REGISTRY)
            if unknown:
                raise CommandError(
                    f"Unknown detector(s): {', '.join(sorted(unknown))}. "
                    f"Known: {', '.join(sorted(det.REGISTRY))}"
                )

        student_ids = opts["student"]
        explain_ids = None
        if opts["explain"]:
            explain_ids = self._resolve_student(opts["explain"])
            student_ids = student_ids or explain_ids

        dry = opts["dry_run"]
        self.stdout.write(
            f"as_of={as_of.isoformat()}  detectors="
            f"{len(only) if only else len(det.REGISTRY)}"
            + ("  [DRY RUN — nothing will be written]" if dry else "")
        )

        totals = {"raised": 0, "suppressed": 0, "evaluated": 0}
        by_type: dict[str, int] = {}
        for inst in institutes:
            started = time.perf_counter()
            with self._scope(inst.id, opts["no_rls"]):
                run = det.run_detectors(
                    inst.id,
                    student_ids,
                    as_of,
                    only=only,
                    tier=opts["tier"],
                    dry_run=dry,
                    ignore_cooldown=opts["ignore_cooldown"],
                )
                if explain_ids:
                    self._explain(run, explain_ids)
            elapsed = (time.perf_counter() - started) * 1000

            totals["raised"] += run.raised
            totals["suppressed"] += run.suppressed
            totals["evaluated"] += run.evaluated
            for k, v in run.by_type().items():
                by_type[k] = by_type.get(k, 0) + v

            self.stdout.write(
                f"  {inst.name:<24} students={run.students:<4} "
                f"raised={run.raised:<4} suppressed={run.suppressed:<4} "
                f"{elapsed:7.0f} ms"
            )
            if not explain_ids:
                self._summarise(run)

        self.stdout.write("")
        verb = "would raise" if dry else "raised"
        self.stdout.write(
            self.style.SUCCESS(
                f"  {verb} {totals['raised']} flags from "
                f"{totals['evaluated']} evaluations; "
                f"{totals['suppressed']} suppressed by cooldown"
            )
        )
        for ftype in sorted(by_type, key=lambda t: -by_type[t]):
            self.stdout.write(f"    {by_type[ftype]:>4}  {ftype}")

    # ------------------------------------------------------------ output

    def _summarise(self, run: det.DetectorRun):
        fired = [c for c in run.candidates if c.fired]
        for c in sorted(
            fired,
            key=lambda c: (
                SEVERITY_ORDER.index(c.flag.severity)
                if c.flag.severity in SEVERITY_ORDER
                else 9,
                c.flag.student.name,
            ),
        )[:40]:
            self.stdout.write(
                f"      [{c.flag.severity:<8}] {c.flag.student.name:<20} "
                f"{c.flag.type:<20} {c.flag.headline}"
            )
        held = [c for c in run.candidates if not c.fired]
        for c in held[:12]:
            self.stdout.write(
                self.style.WARNING(
                    f"      [suppressed] {c.flag.student.name:<20} "
                    f"{c.flag.type:<20} {c.suppressed_by}"
                )
            )
        if len(held) > 12:
            self.stdout.write(
                self.style.WARNING(f"      ... and {len(held) - 12} more suppressed")
            )

    def _explain(self, run: det.DetectorRun, ids: list[int]):
        wanted = set(ids)
        if not run.students:
            return  # that student is not in this institute; nothing to say
        hits = [c for c in run.candidates if c.flag.student_id in wanted]
        if not hits:
            self.stdout.write(
                self.style.WARNING("      no detector fired for that student")
            )
            return
        for c in hits:
            status = "FIRED" if c.fired else f"SUPPRESSED ({c.suppressed_by})"
            self.stdout.write("")
            self.stdout.write(
                self.style.MIGRATE_HEADING(
                    f"  {c.flag.student.name} · {c.flag.type} "
                    f"[{c.flag.severity}] · {c.detector.rule_version} · {status}"
                )
            )
            self.stdout.write(f"    {c.flag.headline}")
            self.stdout.write("    evidence:")
            for line in json.dumps(c.flag.evidence, indent=2, default=str).splitlines():
                self.stdout.write(f"      {line}")

    def _list(self):
        self.stdout.write("Detector catalogue\n")
        for name in sorted(det.REGISTRY, key=lambda n: (det.REGISTRY[n].tier, n)):
            d = det.REGISTRY[name]
            self.stdout.write(
                f"  tier {d.tier}  {d.type:<22} {d.rule_version}  "
                f"cooldown {d.cooldown_days}d"
            )
            self.stdout.write(f"             evidence: {d.min_evidence}")
            self.stdout.write(f"             baseline: {d.baseline}")

    # ----------------------------------------------------------- helpers

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
        return timezone.make_aware(parsed) if timezone.is_naive(parsed) else parsed

    def _institutes(self, raw):
        if not raw:
            return list(Institute.objects.order_by("id"))
        out = []
        for token in raw:
            qs = (
                Institute.objects.filter(id=int(token))
                if token.isdigit()
                else Institute.objects.filter(slug=token)
            )
            inst = qs.first()
            if inst is None:
                raise CommandError(f"No institute matching {token!r}")
            out.append(inst)
        return out

    def _resolve_student(self, token: str) -> list[int]:
        if token.isdigit():
            ids = list(
                Student.objects.filter(id=int(token)).values_list("id", flat=True)
            )
        else:
            ids = list(
                Student.objects.filter(name__icontains=token).values_list(
                    "id", flat=True
                )
            )
        if not ids:
            raise CommandError(f"No student matching {token!r}")
        return ids
