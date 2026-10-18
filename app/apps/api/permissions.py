"""Who may call what.

There are two surfaces on this API and a caller belongs to exactly one:

    /api/my/…          the signed-in student's own data. Scoped by *account*:
                       there is no id in the path to tamper with.
    everything else    the console. Scoped by *institute*, and addressed by
                       id: `/api/students/{id}/…` answers for any student the
                       caller's institute holds.

The second kind is correct for a mentor and wrong for a student. Row-level
security and `TenantScopedMixin` both stop at the institute boundary, so a
student who could reach `/api/students/{id}/` would read every classmate's
record, risk score and flags — they share an institute. The tenant checks
cannot see this: it is not a cross-tenant leak, it is the *wrong person in
the right tenant*. That class of bug has a name, broken object-level
authorization (OWASP API Security Top 10, API1:2023), and the fix is an
explicit rule about who may use the console surface at all, which is what
`IsConsoleUser` is.
"""

from rest_framework.permissions import BasePermission

from .auth import STUDENT, role_of


class IsConsoleUser(BasePermission):
    """Everyone except a student account.

    A deny-list of one role, not an allow-list of mentor and director, on
    purpose. An authenticated account attached to nothing (`role is None`)
    already sees an empty institute — `TenantScopedMixin.scoped()` returns
    `none()` for it — so turning that into a 403 would change a documented
    behaviour for no gain. The only thing that must stop is a student
    reading other students.
    """

    message = "This route is for institute staff. Students use /api/my/."

    def has_permission(self, request, view):
        return role_of(request.user) != STUDENT


class IsStudentAccount(BasePermission):
    """The caller is a student with a linked `Student` row.

    For `/api/my/` routes that cannot degrade to an empty answer: writes,
    and singleton reads like the profile. List routes under `/api/my/`
    instead return an empty page for a non-student, which is the behaviour
    `my/plan` documented from the start (a mentor who opens the student
    app has made a navigation mistake, not mounted an attack).
    """

    message = "This route is for student accounts."

    def has_permission(self, request, view):
        return role_of(request.user) == STUDENT
