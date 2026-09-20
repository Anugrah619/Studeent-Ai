"""Row-level security — tenant isolation enforced by Postgres, not Python.

Read this before changing anything about tenancy.

WHY IN THE DATABASE
    One forgotten `.filter(institute=...)` in one view leaks a competing
    institute's students. That is a business-ending bug, and it is the
    kind of bug code review misses. With RLS the same mistake returns
    zero rows instead of the wrong rows.

THE THREE PIECES, AND WHY ALL THREE ARE NEEDED

    1. ENABLE ROW LEVEL SECURITY   — turns policies on.
    2. FORCE ROW LEVEL SECURITY    — makes them apply to the *table owner*
       too. Django connects as the owner, so without FORCE every policy
       below exists, looks correct in `\\d+`, and does nothing at all.
    3. A role that is neither SUPERUSER nor BYPASSRLS. FORCE does not help
       against those — a superuser skips RLS entirely. The dev/CI role
       `sai` IS a superuser, which is why the app drops to `student_ai_rls`
       via SET ROLE on every tenant request (see apps/tenancy/middleware.py).

HOW THE UNSET SETTING IS HANDLED — fail closed
    `current_setting('app.institute_id', true)` returns NULL when nothing
    set it. `institute_id = NULL` is NULL, which is not TRUE, so the row is
    filtered out: **an unset tenant sees nothing**, rather than everything.
    We chose this over a permissive `IS NULL OR ...` fallback because a
    permissive fallback turns "middleware didn't run" — a config mistake —
    into a silent cross-tenant leak, which is exactly the failure mode RLS
    exists to prevent.

    The cost of failing closed is that anything legitimately cross-tenant
    (migrations, seeders, the nightly recompute, `manage.py shell`) must run
    as a BYPASSRLS/superuser role. That is deliberate: those paths are
    operator-run and few, and it is far better for them to need an explicit
    privileged role than for the request path to need an explicit filter.

PRODUCTION TOPOLOGY
    Policies are granted TO PUBLIC, so they apply to whatever role connects.
    Two supported shapes:
      · dev/here  — connect as owner `sai`, middleware SET ROLE student_ai_rls
      · prod      — connect as a dedicated NOLOGIN-less, NOBYPASSRLS login
                    role; middleware's SET ROLE then becomes a no-op upgrade
                    that costs one statement and changes nothing.

PROOF
    `manage.py rls_check` sets app.institute_id to each institute in turn
    and asserts the counts differ and sum to the unscoped total.
"""

from django.db import migrations

# Every table carrying institute_id. Verified against pg_attribute, not
# guessed: see the query in the docstring of rls_check.
TENANT_TABLES = [
    "tenancy_mentor",
    "tenancy_batch",
    "tenancy_student",
    "syllabus_syllabusversion",
    "events_attempt",
    "events_studylog",
    "events_confidencerating",
    "events_revisionevent",
    "events_chapterstatus",
    "ingestion_testpaper",
    "ingestion_columnmappingprofile",
    "ingestion_ingestbatch",
    "ingestion_questiontopicmap",
    "derived_topicstate",
    "derived_studentstate",
    "derived_flag",
    "derived_planblock",
]

# Tables with no institute_id of their own that still hold tenant data.
# Reached through an owning row; the policy is an EXISTS against it.
#   syllabus_topic       — chapter names/weights are the institute's own IP
#   derived_intervention — what a named mentor said to a named student
DERIVED_SCOPE = {
    "syllabus_topic": (
        "EXISTS (SELECT 1 FROM syllabus_syllabusversion v "
        "WHERE v.id = syllabus_topic.syllabus_id "
        "AND v.institute_id = app_current_institute())"
    ),
    "derived_intervention": (
        "EXISTS (SELECT 1 FROM derived_flag f "
        "WHERE f.id = derived_intervention.flag_id "
        "AND f.institute_id = app_current_institute())"
    ),
}

APP_ROLE = "student_ai_rls"


# ---------------------------------------------------------------- forward

FORWARD_PREAMBLE = f"""
-- The role the request path runs as. NOLOGIN on purpose: it is only ever
-- reached by SET ROLE from a connection that already authenticated, so
-- there is no second password to store, rotate, or leak.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
        CREATE ROLE {APP_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    ELSE
        ALTER ROLE {APP_ROLE} NOSUPERUSER NOBYPASSRLS;
    END IF;
EXCEPTION WHEN insufficient_privilege THEN
    RAISE WARNING 'Could not create role {APP_ROLE}: %. '
                  'Create it by hand, then re-run manage.py rls_check.', SQLERRM;
END $$;

-- A non-superuser owner needs membership to SET ROLE. A superuser already
-- can, and the GRANT is a harmless no-op.
DO $$
BEGIN
    EXECUTE format('GRANT {APP_ROLE} TO %I', current_user);
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Could not grant {APP_ROLE} to %: %', current_user, SQLERRM;
END $$;

GRANT USAGE ON SCHEMA public TO {APP_ROLE};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {APP_ROLE};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {APP_ROLE};

-- So that tables added by future migrations are covered without anyone
-- having to remember this file exists.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {APP_ROLE};
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO {APP_ROLE};

-- One place that knows how the tenant is read off the session, so a change
-- of mechanism does not mean editing 19 policies.
--
-- STABLE, not VOLATILE: evaluated once per statement, so the planner can
-- still treat `institute_id = app_current_institute()` as an indexable
-- constant comparison rather than a per-row call.
CREATE OR REPLACE FUNCTION app_current_institute() RETURNS bigint
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
    SET search_path = pg_catalog
AS $$
    SELECT NULLIF(current_setting('app.institute_id', true), '')::bigint
$$;

COMMENT ON FUNCTION app_current_institute() IS
    'Tenant for the current session. NULL when unset, which makes every '
    'tenant_isolation policy match zero rows (fail closed).';
"""


def _policy(table: str, expr: str) -> str:
    return f"""
ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
-- Without FORCE the owner silently bypasses the policy below, and Django
-- connects as the owner. This line is the whole point.
ALTER TABLE {table} FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON {table};
CREATE POLICY tenant_isolation ON {table}
    FOR ALL
    USING ({expr})
    WITH CHECK ({expr});
"""


FORWARD_SQL = (
    FORWARD_PREAMBLE
    # The tenant root itself: an institute may see its own row and no other.
    + _policy("tenancy_institute", "id = app_current_institute()")
    + "".join(
        _policy(t, "institute_id = app_current_institute()") for t in TENANT_TABLES
    )
    + "".join(_policy(t, expr) for t, expr in DERIVED_SCOPE.items())
)


# ---------------------------------------------------------------- reverse

ALL_POLICED = ["tenancy_institute", *TENANT_TABLES, *DERIVED_SCOPE]

REVERSE_SQL = "".join(
    f"""
DROP POLICY IF EXISTS tenant_isolation ON {t};
ALTER TABLE {t} NO FORCE ROW LEVEL SECURITY;
ALTER TABLE {t} DISABLE ROW LEVEL SECURITY;
"""
    for t in ALL_POLICED
) + f"""
DROP FUNCTION IF EXISTS app_current_institute();
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM {APP_ROLE};
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE USAGE, SELECT ON SEQUENCES FROM {APP_ROLE};
-- The role itself is left in place: it is cluster-wide, may be referenced by
-- another database, and dropping it fails noisily if anything still depends
-- on it. Drop it by hand if you really mean to.
"""


class Migration(migrations.Migration):
    """Runs after every table that carries institute_id exists."""

    dependencies = [
        ("tenancy", "0002_institute_batch_mentor_student"),
        ("syllabus", "0002_initial"),
        ("events", "0003_initial"),
        ("ingestion", "0002_initial"),
        ("derived", "0002_initial"),
    ]

    operations = [
        migrations.RunSQL(sql=FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
