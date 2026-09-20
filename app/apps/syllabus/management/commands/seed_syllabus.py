"""Seed the JEE Main exam and its syllabus tree for an institute.

    python manage.py seed_syllabus --institute aarambh

Idempotent: re-running bumps to a new SyllabusVersion rather than editing
the existing one, which is the same behaviour a real syllabus revision
would trigger.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.syllabus.jee_main_tree import JEE_MAIN
from apps.syllabus.models import Exam, SyllabusVersion, Topic
from apps.tenancy.models import Institute


class Command(BaseCommand):
    help = "Create the JEE Main exam and seed its syllabus tree for an institute."

    def add_arguments(self, parser):
        parser.add_argument("--institute", required=True, help="Institute slug")
        parser.add_argument(
            "--activate", action="store_true", help="Mark the new version active"
        )

    @transaction.atomic
    def handle(self, *args, **opts):
        try:
            institute = Institute.objects.get(slug=opts["institute"])
        except Institute.DoesNotExist:
            raise CommandError(
                f"No institute with slug '{opts['institute']}'. Run seed_demo first."
            )

        exam, _ = Exam.objects.get_or_create(
            code="JEE_MAIN",
            defaults={
                "name": "JEE Main",
                "marks_correct": 4,
                "marks_wrong": -1,
                "total_marks": 300,
            },
        )

        last = (
            SyllabusVersion.objects.filter(institute=institute, exam=exam)
            .order_by("-version")
            .first()
        )
        version = (last.version + 1) if last else 1

        syllabus = SyllabusVersion.objects.create(
            institute=institute,
            exam=exam,
            version=version,
            is_active=opts["activate"] or version == 1,
            note="Seeded from jee_main_tree.py — verify against official NTA PDF",
        )

        if syllabus.is_active:
            SyllabusVersion.objects.filter(
                institute=institute, exam=exam
            ).exclude(pk=syllabus.pk).update(is_active=False)

        counts = {"subject": 0, "unit": 0, "chapter": 0}

        for s_pos, (subject_name, units) in enumerate(JEE_MAIN.items()):
            subject = Topic.objects.create(
                syllabus=syllabus,
                parent=None,
                name=subject_name,
                kind=Topic.SUBJECT,
                position=s_pos,
                weight=100.0,
            )
            counts["subject"] += 1

            for u_pos, (unit_name, chapters) in enumerate(units.items()):
                unit = Topic.objects.create(
                    syllabus=syllabus,
                    parent=subject,
                    name=unit_name,
                    kind=Topic.UNIT,
                    position=u_pos,
                    weight=sum(w for _, w in chapters),
                )
                counts["unit"] += 1

                for c_pos, (chapter_name, weight) in enumerate(chapters):
                    Topic.objects.create(
                        syllabus=syllabus,
                        parent=unit,
                        name=chapter_name,
                        kind=Topic.CHAPTER,
                        position=c_pos,
                        weight=float(weight),
                    )
                    counts["chapter"] += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"{institute.name}: JEE Main syllabus v{version} — "
                f"{counts['subject']} subjects, {counts['unit']} units, "
                f"{counts['chapter']} chapters"
            )
        )
