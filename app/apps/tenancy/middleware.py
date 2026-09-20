"""Tenant middleware — binds each request's connection to one institute.

This is the other half of migration `tenancy/0003_row_level_security`. The
policies there read `app.institute_id` off the session; this is what puts
it there.

Two statements are issued per tenant request:

    SET ROLE student_ai_rls;
    SELECT set_config('app.institute_id', '<id>', false);

`SET ROLE` is the load-bearing one and is easy to talk yourself out of.
The dev/CI database role is a SUPERUSER, and a superuser bypasses RLS
outright — FORCE ROW LEVEL SECURITY only closes the *owner* loophole, not
the superuser one. Dropping to a NOSUPERUSER, NOBYPASSRLS role for the
duration of the request is what makes the policies actually run. In a
deployment where the app already connects as an unprivileged role it is a
harmless no-op.

Both are reset in a `finally`, because with CONN_MAX_AGE > 0 the connection
is handed to the next request.

Who gets scoped
    mentor / student        → their institute, RLS active
    authenticated, neither  → institute '' → RLS active, matches nothing
    Django superuser        → not scoped. The admin is the back-office for
                              mapping review and tenant management and is
                              cross-tenant by design; see ADMIN NOTE below.
    anonymous               → not scoped, because nothing tenant-bearing is
                              reachable: DRF defaults to IsAuthenticated and
                              the admin requires a staff login.

ADMIN NOTE
    Leaving superusers unscoped is a deliberate, documented escalation, not
    an oversight. Staff users who are *not* superusers are scoped normally,
    so an institute-side back-office account sees only its own institute.
"""

from __future__ import annotations

import logging

from apps.tenancy.rls import RLS_ROLE, SETTING, clear_tenant, set_tenant  # noqa: F401

logger = logging.getLogger(__name__)


def institute_for(user) -> int | None:
    """The institute this user belongs to, or None if they belong to none."""
    if user is None or not user.is_authenticated:
        return None
    mentor = getattr(user, "mentor", None)
    if mentor is not None:
        return mentor.institute_id
    student = getattr(user, "student", None)
    if student is not None:
        return student.institute_id
    return None


class TenantMiddleware:
    """Set `app.institute_id` for the duration of the request."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = getattr(request, "user", None)

        # AuthenticationMiddleware makes request.user lazy; touching
        # .is_authenticated is what resolves it, and that query must happen
        # before we drop privileges — auth_user_custom has no policy, but
        # the mentor/student lookups below read tenant tables.
        scoped = bool(user is not None and user.is_authenticated and not user.is_superuser)
        institute_id = institute_for(user) if user is not None else None

        if not scoped:
            # Not a tenant request. Still publish the setting when we know
            # it, so anything reading it downstream sees the truth.
            request.institute_id = institute_id
            return self.get_response(request)

        request.institute_id = institute_id
        if institute_id is None:
            logger.warning(
                "User %s is authenticated but belongs to no institute; "
                "scoping their connection to nothing.",
                getattr(user, "pk", "?"),
            )

        set_tenant(institute_id)
        try:
            return self.get_response(request)
        finally:
            # Not optional. Under CONN_MAX_AGE > 0 this connection is
            # reused, and a leaked SET ROLE would scope the *next* request
            # to the previous tenant.
            try:
                clear_tenant()
            except Exception:  # pragma: no cover - connection already dead
                logger.exception("Failed to reset tenant on connection")
