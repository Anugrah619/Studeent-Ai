"""Sign-in by username *or* by roll number.

A student types the number printed on their ID card and a password the
institute gave them. A mentor or director types the username they were
issued. The login form has one box for both, so one backend has to answer
for both.

WHY ONE BACKEND AND NOT TWO IN A LIST
    Django tries each backend in turn, and `ModelBackend` on an unknown
    username burns a full password hash on a throwaway user, on purpose, so
    that "no such user" and "wrong password" take the same time. Stacking a
    roll-number backend after it would charge every student sign-in two
    hashes — about two seconds with Django's default hasher, which is the
    cost of the hasher by design, not something to tune away. Here the
    candidates are gathered first and each is checked once, and the dummy
    hash is spent only when there was nobody to check.

ROLL NUMBERS ARE NOT GLOBALLY UNIQUE
    `Student` is unique on (institute, batch, roll_no), so two institutes —
    or two batches of one — can both have a student 1041. The password
    settles it: every candidate account is checked and sign-in succeeds only
    if **exactly one** accepts. `institute` (the slug) narrows the search for
    a form that asks for it, but a form that does not still works, and a
    clash resolves silently to whichever student actually knows the password.
    There is no "ambiguous roll number" error, because an unauthenticated
    caller would learn from it which numbers exist in more than one place.

TENANT ISOLATION
    This runs before there is a session, so `TenantMiddleware` has not
    scoped the connection and this reads `tenancy_student` unscoped — the same
    posture as the `User` lookup in `ModelBackend`. It reads only enough to
    find an account to test a password against, and returns nothing to the
    caller beyond success or failure.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend

#: More accounts than this sharing one roll number is not a real situation;
#: the cap exists so a crafted value cannot make a sign-in cost unbounded
#: hashing.
MAX_CANDIDATES = 5


class AccountBackend(ModelBackend):
    """Username for staff, roll number for students; the password decides."""

    def authenticate(self, request, username=None, password=None, institute=None, **kwargs):
        if username is None:
            username = kwargs.get(get_user_model().USERNAME_FIELD)
        if username is None or password is None:
            return None
        username = username.strip()
        if not username:
            return None

        User = get_user_model()
        candidates = []

        by_username = User._default_manager.filter(**{User.USERNAME_FIELD: username}).first()
        if by_username is not None:
            candidates.append(by_username)

        # Imported here: `Student` lives in the same app as `User`, whose
        # models module this backend is loaded alongside.
        from apps.tenancy.models import Student

        students = Student.objects.filter(
            roll_no__iexact=username, user__isnull=False
        ).select_related("user")
        if institute:
            students = students.filter(institute__slug=institute.strip().lower())
        for student in students[:MAX_CANDIDATES]:
            if student.user_id not in {c.pk for c in candidates}:
                candidates.append(student.user)

        if not candidates:
            # Nobody to check: spend the hash anyway, as `ModelBackend` does,
            # so a nonexistent account is not faster to reject.
            User().set_password(password)
            return None

        accepted = [
            user for user in candidates
            if user.check_password(password) and self.user_can_authenticate(user)
        ]
        return accepted[0] if len(accepted) == 1 else None
