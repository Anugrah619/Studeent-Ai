"""Row-level-security primitives — the one place that talks to `app.institute_id`.

Import from here rather than issuing `SET ROLE` / `set_config` by hand, so
there is exactly one definition of what "scoped to an institute" means.

    from apps.tenancy.rls import tenant_scope, bypass_rls, current_tenant

WHEN THERE IS NO REQUEST (management commands, django-q2 jobs, pytest)
    Nothing sets `app.institute_id`, and the policies fail closed — every
    tenant table reads as EMPTY. That is intentional, but it is also the
    thing most likely to waste an afternoon, because the symptom is
    "the database looks empty" rather than an error.

    Two supported ways out, in order of preference:

    1. Run as a BYPASSRLS role. This is what happens today: DATABASE_URL
       points at `sai`, which is SUPERUSER/BYPASSRLS, so `manage.py`,
       `pytest` and the seeders see everything with no ceremony and no
       code change. Cross-tenant work (nightly recompute, replay, the
       rebuild-from-events command) is *supposed* to be cross-tenant, so
       this is the right default for the async path.

    2. Scope explicitly when a job is genuinely per-tenant:

           with tenant_scope(institute.id):
               recompute(...)

       This also works from a BYPASSRLS role, because tenant_scope drops
       to the unprivileged role for the duration of the block.

    The rule of thumb: the *request* path is always scoped by middleware;
    the *job* path is unscoped unless it opts in.
"""

from __future__ import annotations

import contextlib
import logging

from django.db import connection

logger = logging.getLogger(__name__)

#: NOLOGIN, NOSUPERUSER, NOBYPASSRLS. Created by migration tenancy/0003.
RLS_ROLE = "student_ai_rls"

#: The Postgres session setting the tenant_isolation policies read.
SETTING = "app.institute_id"


def current_tenant() -> int | None:
    """Institute the *connection* is currently bound to, straight from Postgres."""
    with connection.cursor() as cur:
        cur.execute("SELECT NULLIF(current_setting(%s, true), '')::bigint", [SETTING])
        return cur.fetchone()[0]


def set_tenant(institute_id: int | None, *, drop_privileges: bool = True) -> None:
    """Bind the current connection to one institute.

    `institute_id=None` binds it to *no* institute, which under the
    fail-closed policies means every tenant table reads as empty.

    `drop_privileges` issues `SET ROLE student_ai_rls`. Leave it on. The
    dev/CI role is a superuser, and a superuser bypasses RLS outright --
    `FORCE ROW LEVEL SECURITY` closes the table-*owner* loophole, not the
    superuser one. Without the role switch the policies are decorative.
    """
    with connection.cursor() as cur:
        if drop_privileges:
            cur.execute(f"SET ROLE {RLS_ROLE}")
        cur.execute(
            "SELECT set_config(%s, %s, false)",
            [SETTING, "" if institute_id is None else str(institute_id)],
        )


def clear_tenant() -> None:
    """Hand the connection back the way we found it.

    Must run even on the error path: with CONN_MAX_AGE > 0 the connection
    is reused, and a leaked SET ROLE would scope the *next* caller to the
    previous tenant.
    """
    with connection.cursor() as cur:
        cur.execute("SELECT set_config(%s, '', false)", [SETTING])
        cur.execute("RESET ROLE")


@contextlib.contextmanager
def tenant_scope(institute_id: int | None):
    """Run a block as one institute, with RLS actually enforced.

        with tenant_scope(inst.id):
            Student.objects.count()   # only this institute's students

    Use it in per-tenant jobs and in tests that assert isolation. Nesting
    is not supported -- the block always exits to *unscoped*, not to the
    enclosing scope.
    """
    set_tenant(institute_id)
    try:
        yield
    finally:
        clear_tenant()


@contextlib.contextmanager
def bypass_rls():
    """Run a block unscoped, whatever the connection was doing before.

    Only legitimate for genuinely cross-tenant work: nightly recompute,
    rebuild-from-events, cohort analytics across institutes. Requires the
    connection's *session* role to be SUPERUSER or BYPASSRLS -- if the app
    connects as an unprivileged login role this raises nothing but also
    grants nothing, so check `rls_check` output before relying on it.
    """
    clear_tenant()
    try:
        yield
    finally:
        pass
