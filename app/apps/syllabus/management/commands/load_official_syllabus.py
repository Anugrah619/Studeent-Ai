"""Load an official NTA syllabus tree as a NEW, inactive SyllabusVersion.

    python manage.py load_official_syllabus --exam JEE_MAIN --institute aarambh
    python manage.py load_official_syllabus --exam NEET_UG  --institute aarambh

Reads `data/syllabus/<exam>.json` — the tree traced page by page to NTA's PDF,
with each chapter linked to NCERT — and writes it beside whatever the
institute already has. It never edits an existing version, never activates the
new one, and never touches a batch:

  * Existing versions stay exactly as they are. Version 1 is what every demo
    batch, attempt and question is bound to.
  * The new version is created with is_active=False. Two seed commands look up
    `SyllabusVersion.objects.get(institute=..., is_active=True)` without an exam
    filter, so a second active version for the same institute (NEET beside
    JEE) would make them raise. Switching a batch to the official tree is a
    separate, deliberate step.
  * Re-running with an unchanged JSON file is a no-op: the file's SHA-256 is
    written into the version note and checked first.

Exam rows: JEE_MAIN already exists and is checked against the file (a mismatch
stops the load rather than silently re-scoring the demo). NEET_UG is created
from the file's `exam` block, which cites the bulletin pages it came from.

NEET Biology: the JSON keeps NTA's single "Biology" subject. In the database
each Biology chapter is placed under its paper section ("Botany" / "Zoology")
as the subject node, because every subject-level report in the product groups
by the root of the tree. Where an NTA unit has chapters in both sections, the
unit appears under both, with the same name. The JSON records, per chapter,
whether that section follows from NTA's own text or only from convention.

`weight` stays at the model default: real weights are counted from past
papers later, never estimated here.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.syllabus.models import Exam, SyllabusVersion, Topic
from apps.tenancy.models import Institute

DATA_DIR = Path(settings.BASE_DIR).parent / "data" / "syllabus"
FILES = {"JEE_MAIN": "jee_main_2026.json", "NEET_UG": "neet_ug_2026.json"}
NOTE_PREFIX = "Official NTA 2026"


def validate(tree: dict, path: Path) -> list[str]:
    """Every chapter must cite a page and state its NCERT link (list or null)."""
    problems = []
    if not tree.get("subjects"):
        problems.append("no subjects")
    for s in tree.get("subjects", []):
        if not s.get("units"):
            problems.append(f"{s.get('name')}: no units")
        for u in s.get("units", []):
            if not u.get("chapters"):
                problems.append(f"{s['name']} › {u.get('name')}: no chapters")
            for c in u.get("chapters", []):
                where = f"{s['name']} › {u['name']} › {c.get('name')}"
                if not isinstance(c.get("page"), int):
                    problems.append(f"{where}: no page reference")
                if "ncert_ref" not in c:
                    problems.append(f"{where}: ncert_ref missing (use null for none)")
                elif c["ncert_ref"] is not None and not isinstance(c["ncert_ref"], list):
                    problems.append(f"{where}: ncert_ref must be a list or null")
    return problems


def db_subject(subject: dict, chapter: dict) -> str:
    """The subject node a chapter is filed under: its paper section if the
    file assigns one (NEET Biology), otherwise NTA's subject."""
    section = chapter.get("paper_section")
    return section["section"] if section else subject["name"]


class Command(BaseCommand):
    help = "Load an official NTA syllabus (data/syllabus/*.json) as a new, inactive version."

    def add_arguments(self, parser):
        parser.add_argument("--exam", required=True, choices=sorted(FILES))
        parser.add_argument("--institute", required=True, help="Institute slug")
        parser.add_argument("--file", help="Override the JSON path (default: data/syllabus/<exam>.json)")

    @transaction.atomic
    def handle(self, *args, **opts):
        path = Path(opts["file"]) if opts["file"] else DATA_DIR / FILES[opts["exam"]]
        if not path.exists():
            raise CommandError(f"{path} not found")
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        tree = json.loads(raw)

        if tree["exam"]["code"] != opts["exam"]:
            raise CommandError(f"{path.name} is for {tree['exam']['code']}, not {opts['exam']}")
        problems = validate(tree, path)
        if problems:
            raise CommandError("Refusing to load:\n  " + "\n  ".join(problems))

        try:
            institute = Institute.objects.get(slug=opts["institute"])
        except Institute.DoesNotExist:
            raise CommandError(f"No institute with slug '{opts['institute']}'.")

        exam = self._exam(tree["exam"])

        already = SyllabusVersion.objects.filter(
            institute=institute, exam=exam, note__contains=digest[:16]
        ).first()
        if already:
            self.stdout.write(
                f"{institute.name}: {exam.code} {path.name} (sha256 {digest[:16]}) "
                f"is already loaded as v{already.version}. Nothing to do."
            )
            return

        last = (
            SyllabusVersion.objects.filter(institute=institute, exam=exam)
            .order_by("-version").first()
        )
        version = SyllabusVersion.objects.create(
            institute=institute,
            exam=exam,
            version=(last.version + 1) if last else 1,
            is_active=False,
            note=f"{NOTE_PREFIX} · {path.name} · sha256 {digest[:16]}",
        )
        counts = self._load(version, tree)
        self.stdout.write(self.style.SUCCESS(
            f"{institute.name}: {exam.code} v{version.version} ({version.note}) — "
            f"{counts['subject']} subjects, {counts['unit']} units, {counts['chapter']} chapters, "
            f"{counts['linked']} linked to NCERT, {counts['chapter'] - counts['linked']} without. "
            f"Inactive; no batch was changed."
        ))

    def _exam(self, spec: dict) -> Exam:
        want = {
            "marks_correct": spec["marks_correct"],
            "marks_wrong": spec["marks_wrong"],
            "total_marks": spec["total_marks"],
        }
        exam, created = Exam.objects.get_or_create(
            code=spec["code"], defaults={"name": spec["name"], **want}
        )
        if created:
            self.stdout.write(f"Created exam {exam.code}: {want}")
            return exam
        have = {k: getattr(exam, k) for k in want}
        if have != want:
            raise CommandError(
                f"Exam {exam.code} in the database has {have} but the official file says {want}. "
                "Not changing it here — existing scores depend on it."
            )
        return exam

    def _load(self, version: SyllabusVersion, tree: dict) -> dict:
        counts = {"subject": 0, "unit": 0, "chapter": 0, "linked": 0}
        subjects: dict[str, Topic] = {}
        units: dict[tuple[str, str], Topic] = {}

        def subject_node(name: str) -> Topic:
            if name not in subjects:
                subjects[name] = Topic.objects.create(
                    syllabus=version, parent=None, name=name,
                    kind=Topic.SUBJECT, position=len(subjects),
                )
                counts["subject"] += 1
            return subjects[name]

        def unit_node(subject: Topic, name: str) -> Topic:
            key = (subject.name, name)
            if key not in units:
                units[key] = Topic.objects.create(
                    syllabus=version, parent=subject, name=name, kind=Topic.UNIT,
                    position=sum(1 for s, _ in units if s == subject.name),
                )
                counts["unit"] += 1
            return units[key]

        for s in tree["subjects"]:
            for u in s["units"]:
                for c in u["chapters"]:
                    unit = unit_node(subject_node(db_subject(s, c)), u["name"])
                    Topic.objects.create(
                        syllabus=version, parent=unit, name=c["name"], kind=Topic.CHAPTER,
                        position=unit.children.count(), ncert_ref=c["ncert_ref"],
                    )
                    counts["chapter"] += 1
                    counts["linked"] += bool(c["ncert_ref"])
        return counts
