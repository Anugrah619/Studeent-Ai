"""Issuing, and re-issuing, a student's login.

The institute provides the credentials: a student signs in with their **roll
number** and a **temporary password** someone hands them, and must replace it
before they can do anything else (`User.must_change_password`, enforced in
`apps.api.middleware`). This module is the only place accounts are created or
reset, so the HTTP endpoints and the bulk management command cannot drift.

TWO VERBS, ON PURPOSE
    `issue_account` creates and refuses if one exists. `reset_password`
    replaces a password and refuses if there is no account. A single
    "make sure they can log in" call would be tidier and worse: a mentor who
    re-sent it for a student who had already chosen their own password would
    silently overwrite it and lock them out. Two verbs make that a visible
    decision.

THE TEMPORARY PASSWORD
    Random, from an alphabet without the characters people misread on a
    printed slip (no 0/O, 1/I/L), eight symbols in two groups: about 40 bits.
    That is too little to be a long-term secret and plenty for something that
    lives until the first sign-in, behind a login throttle, with a forced
    change. Staff may supply their own instead (`password=`); it is held to a
    minimum length only, since it is replaced immediately.

WHAT IS NOT HERE
    No password is stored or logged in plain text. The caller gets the
    plaintext back exactly once, from the function that made it, and is
    responsible for showing it once and not caching it.
"""

from __future__ import annotations

import secrets

from django.db import transaction

from apps.tenancy.models import Student, User

#: No I, L, O, 0 or 1 — the characters that cost a student a wasted attempt
#: when read off paper.
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

MIN_CUSTOM_PASSWORD = 6
MAX_PASSWORD = 128


class AccountExists(Exception):
    """The student already has a login. Use `reset_password`."""


class NoAccount(Exception):
    """The student has no login yet. Use `issue_account`."""


class WeakInitialPassword(ValueError):
    """A staff-supplied initial password is too short to be worth issuing."""


def temporary_password() -> str:
    chars = "".join(secrets.choice(ALPHABET) for _ in range(8))
    return f"{chars[:4]}-{chars[4:]}"


def _initial_password(password: str | None) -> str:
    if password is None:
        return temporary_password()
    if len(password) < MIN_CUSTOM_PASSWORD:
        raise WeakInitialPassword(
            f"An initial password needs at least {MIN_CUSTOM_PASSWORD} characters."
        )
    if len(password) > MAX_PASSWORD:
        raise WeakInitialPassword(f"An initial password is at most {MAX_PASSWORD} characters.")
    return password


def _free_username(student: Student) -> str:
    """A username nobody can be confused with.

    Students sign in by roll number, so this is never typed. It exists
    because the user table requires one that is unique. Derived from the
    student's id, which is stable, and extended on the vanishing chance a
    staff account already took it.
    """
    base = f"stu-{student.pk}"
    username = base
    while User.objects.filter(username=username).exists():
        username = f"{base}-{secrets.token_hex(2)}"
    return username


@transaction.atomic
def issue_account(student: Student, *, password: str | None = None) -> tuple[User, str]:
    """Create the student's login. Returns the user and the plaintext password."""
    if student.user_id is not None:
        raise AccountExists(student.roll_no)
    plaintext = _initial_password(password)
    user = User.objects.create_user(
        username=_free_username(student),
        password=plaintext,
        # The name is here so Django's similarity validator can reject a new
        # password that is just the student's name with a number on it.
        first_name=student.name[:150],
        must_change_password=True,
    )
    student.user = user
    student.save(update_fields=["user"])
    return user, plaintext


@transaction.atomic
def reset_password(student: Student, *, password: str | None = None) -> tuple[User, str]:
    """Replace the password with a new temporary one and demand a change.

    Changing a password invalidates every session the account already holds
    (Django derives the session hash from the password), so a reset also signs
    out anyone using the old one — which is what a reset after a lost phone is
    for. The account is re-activated, since "let them back in" is the usual
    reason for a reset.
    """
    if student.user_id is None:
        raise NoAccount(student.roll_no)
    plaintext = _initial_password(password)
    user = student.user
    user.set_password(plaintext)
    user.must_change_password = True
    user.is_active = True
    user.save(update_fields=["password", "must_change_password", "is_active"])
    return user, plaintext
