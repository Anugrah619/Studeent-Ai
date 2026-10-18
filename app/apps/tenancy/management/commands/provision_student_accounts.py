"""Issue logins to students in bulk, and print the credentials once.

    python manage.py provision_student_accounts --institute aarambh
    python manage.py provision_student_accounts --institute aarambh --batch Alpha
    python manage.py provision_student_accounts --institute aarambh --roll A-1041 --roll A-1042
    python manage.py provision_student_accounts --institute aarambh --out slips.csv

Writes `roll_no,name,batch,temporary_password` as CSV, to stdout or `--out`.
**That is the only copy of the temporary passwords.** They are stored hashed
and cannot be shown again; lose the file and the remedy is a reset per student.
Print the slips, hand them out, delete the file.

WHY A COMMAND AND NOT AN ENDPOINT
    Each account costs one full password hash — about a second with Django's
    default hasher, which is the point of it. Sixty students is a minute of
    CPU: fine in a terminal, wrong inside a web request that a proxy will time
    out. Issuing a *single* login is an endpoint
    (`POST /api/students/{id}/account/`); doing a whole batch properly wants a
    background job, and there is no job runner yet.

Students who already have a login are skipped and listed, never reset: a
re-run after adding five new joiners must not lock out the hundred who have
already chosen their passwords. Students who have left (`exited_at`) are
skipped too. The command is safe to run twice.
"""

from __future__ import annotations

import csv
import sys

from django.core.management.base import BaseCommand, CommandError

from apps.tenancy.models import Institute, Student
from apps.tenancy.rls import tenant_scope
from apps.tenancy.services import accounts


class Command(BaseCommand):
    help = "Issue logins (roll number + temporary password) to students that have none."

    def add_arguments(self, parser):
        parser.add_argument("--institute", required=True, help="Institute id or slug.")
        parser.add_argument("--batch", default=None, help="Batch name or id.")
        parser.add_argument(
            "--roll", action="append", default=None,
            help="Only this roll number. Repeatable.",
        )
        parser.add_argument(
            "--out", default=None,
            help="Write the credentials CSV here instead of stdout.",
        )

    def handle(self, *args, **opts):
        institute = self._institute(opts["institute"])
        with tenant_scope(institute.id):
            students = self._students(institute, opts["batch"], opts["roll"])
            issued, skipped = [], []
            for student in students:
                if student.user_id is not None:
                    skipped.append((student, "already has a login"))
                    continue
                if student.exited_at is not None:
                    skipped.append((student, "has left the institute"))
                    continue
                _, plaintext = accounts.issue_account(student)
                issued.append((student, plaintext))

        out = open(opts["out"], "w", newline="", encoding="utf-8") if opts["out"] else sys.stdout
        try:
            writer = csv.writer(out)
            writer.writerow(["roll_no", "name", "batch", "temporary_password"])
            for student, plaintext in issued:
                writer.writerow([student.roll_no, student.name, student.batch.name, plaintext])
        finally:
            if opts["out"]:
                out.close()

        # Progress goes to stderr so stdout stays a clean CSV that can be piped.
        err = self.stderr.write
        err(self.style.SUCCESS(f"{len(issued)} login(s) issued for {institute.name}."))
        for student, why in skipped:
            err(f"  skipped {student.roll_no} {student.name}: {why}")
        if opts["out"]:
            err(f"Credentials written to {opts['out']} — the only copy. Hand out, then delete.")

    # ------------------------------------------------------------ helpers

    def _institute(self, ref: str) -> Institute:
        qs = Institute.objects.filter(pk=int(ref)) if ref.isdigit() else Institute.objects.filter(slug=ref)
        institute = qs.first()
        if institute is None:
            raise CommandError(f"No institute {ref!r}.")
        return institute

    def _students(self, institute, batch, rolls):
        qs = Student.objects.filter(institute=institute).select_related("batch", "user")
        if batch:
            qs = qs.filter(batch_id=int(batch)) if batch.isdigit() else qs.filter(batch__name=batch)
        if rolls:
            qs = qs.filter(roll_no__in=rolls)
        students = list(qs.order_by("batch__name", "roll_no"))
        if not students:
            raise CommandError("No students match.")
        return students
