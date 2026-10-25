"""Replace the demo password on every staff account still using it, and print the new ones once.

    python manage.py rotate_demo_passwords --dry-run
    python manage.py rotate_demo_passwords --institute aarambh --out staff.csv
    python manage.py rotate_demo_passwords

`seed_demo` gives every mentor the password `demo12345`, and `pilot_check`
blocks a pilot while any account still has it. This gives each such account a
random password and sets `must_change_password`, so the first sign-in forces a
new one (`PasswordChangeRequiredMiddleware` refuses every other route until it
is changed). Changing the password also signs the account out everywhere.

Writes `username,name,role,institute,temporary_password` as CSV, to stdout or
`--out` — **the only copy**, exactly as `provision_student_accounts` does for
students. Hand each one over, then delete the file.

WHO COUNTS AS STAFF
    Every active account that is not a student's: mentors, directors (staff
    accounts with no mentor link) and superusers. A superuser on the demo
    password is the worst case, not an exception. With `--institute`, only
    that institute's mentors — a director or superuser belongs to no
    institute, so is rotated only by a run without it.

Accounts on any other password are never touched: this is safe to run twice,
and the second run changes nothing.

THE NEW PASSWORD
    Sixteen characters from `accounts.ALPHABET` (no 0/O, 1/I/L), two
    `accounts.temporary_password()`s joined — about 79 bits. Longer than a
    student's slip on purpose: a staff account reads every student in the
    institute.
"""

from __future__ import annotations

import csv

from django.contrib.auth.hashers import check_password
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.tenancy.models import Institute, User
from apps.tenancy.services import accounts

from .pilot_check import DEMO_PASSWORD


def staff_password() -> str:
    return f"{accounts.temporary_password()}-{accounts.temporary_password()}"


def _role(user: User) -> str:
    if getattr(user, "mentor", None) is not None:
        return "mentor"
    if user.is_superuser:
        return "superuser"
    return "director" if user.is_staff else "staff"


class Command(BaseCommand):
    help = (
        "Give every staff account still on the demo password a random one, set "
        "must_change_password, and print the new passwords once as CSV."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--institute", default=None,
            help="Institute id or slug: only its mentors. Omit for every staff account.",
        )
        parser.add_argument("--out", default=None,
                            help="Write the credentials CSV here instead of stdout.")
        parser.add_argument("--dry-run", action="store_true",
                            help="List the accounts that would change; change nothing.")

    def handle(self, *args, **opts):
        users = self._candidates(opts["institute"])
        on_demo = [
            u for u in users
            if u.has_usable_password() and check_password(DEMO_PASSWORD, u.password)
        ]
        err = self.stderr.write

        if opts["dry_run"]:
            for user in on_demo:
                err(f"  would rotate {user.username} ({_role(user)})")
            err(f"{len(on_demo)} account(s) on the demo password; nothing changed (dry run).")
            return

        issued = []
        with transaction.atomic():
            for user in on_demo:
                plaintext = staff_password()
                user.set_password(plaintext)
                user.must_change_password = True
                user.save(update_fields=["password", "must_change_password"])
                issued.append((user, plaintext))

        if issued:
            # `self.stdout` rather than `sys.stdout`, so `call_command(stdout=…)`
            # captures the CSV like any other output. csv ends every row with
            # "\r\n", so the wrapper adds no line ending of its own.
            out = open(opts["out"], "w", newline="", encoding="utf-8") if opts["out"] else self.stdout
            try:
                writer = csv.writer(out)
                writer.writerow(["username", "name", "role", "institute", "temporary_password"])
                for user, plaintext in issued:
                    mentor = getattr(user, "mentor", None)
                    writer.writerow([
                        user.username, user.get_full_name() or (mentor.name if mentor else ""),
                        _role(user), mentor.institute.slug if mentor else "", plaintext,
                    ])
            finally:
                if opts["out"]:
                    out.close()

        # Progress to stderr, so stdout stays a CSV that can be piped.
        err(self.style.SUCCESS(f"{len(issued)} staff password(s) rotated."))
        skipped = len(users) - len(on_demo)
        if skipped:
            err(f"  {skipped} other staff account(s) are not on the demo password; untouched.")
        if issued and opts["out"]:
            err(f"Credentials written to {opts['out']} — the only copy. Hand out, then delete.")

    def _candidates(self, ref: str | None) -> list[User]:
        qs = User.objects.filter(is_active=True, student__isnull=True).select_related(
            "mentor__institute"
        )
        if ref:
            institute = (
                Institute.objects.filter(pk=int(ref)) if ref.isdigit()
                else Institute.objects.filter(slug=ref)
            ).first()
            if institute is None:
                raise CommandError(f"No institute {ref!r}.")
            qs = qs.filter(mentor__institute=institute)
        return list(qs.order_by("username"))
