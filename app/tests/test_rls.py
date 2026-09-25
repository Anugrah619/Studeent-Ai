"""Row-level security -- tested so that it actually fails when it breaks.

THE TRAP THIS FILE EXISTS TO AVOID
    `DATABASE_URL` points at `sai`, which is SUPERUSER **and** BYPASSRLS.
    Postgres skips row-level security entirely for such a role. So the
    obvious test --

        log in as institute A, count students, assert it is fewer than
        the total

    -- passes vacuously. It proves nothing today and it keeps passing
    after somebody breaks isolation tomorrow. `test_the_naive_test_is_vacuous`
    below demonstrates that failure mode on purpose, so the reason for
    everything else in this file is written down in executable form.

    Meaningful tests must either go through `tenant_scope()` (which issues
    `SET ROLE student_ai_rls` -- NOLOGIN, NOSUPERUSER, NOBYPASSRLS) or
    through the real request path, where `TenantMiddleware` does it.

WHAT IS ASSERTED, AND WHY ALL FOUR
    Counts alone are not proof. Both institutes in the seeded database see
    exactly 71 `syllabus_topic` rows, and a policy of `USING (true)` would
    pass a "the numbers differ" assertion on that table. So, per table:

    PARTITION   the per-tenant counts sum to the unscoped total
    DISJOINT    while scoped to A, no row with another institute_id is
                reachable at all -- the property stated directly
    IDENTITY    the visible primary-key sets do not overlap, which is what
                catches the same-cardinality case
    FAIL-CLOSED with no tenant set, every tenant table reads zero

AND THE META-TEST
    `test_isolation_breaks_when_the_policy_is_dropped` drops
    `tenant_isolation` inside the test transaction and asserts the checks
    above start failing. Without it, this file could be asserting nothing
    and nobody would know. The DDL is rolled back with the transaction.
"""

from __future__ import annotations

import pytest
from django.db import connection, transaction

from apps.derived.models import TopicState
from apps.events.models import Attempt
from apps.tenancy.models import Student
from apps.tenancy.rls import RLS_ROLE, current_tenant, tenant_scope

from tests import factories as f

pytestmark = [pytest.mark.django_db, pytest.mark.rls]


# --------------------------------------------------------------- helpers


def visible_ids(model) -> set[int]:
    return set(model.objects.values_list("id", flat=True))


def foreign_rows(model, institute_id: int) -> int:
    """Rows carrying a *different* institute_id that are still reachable."""
    return model.objects.exclude(institute_id=institute_id).count()


@pytest.fixture
def two_tenants(cohort, other_cohort):
    """Two institutes holding the **same number** of students.

    Equal cardinality on purpose: it is the shape that makes a count-only
    assertion pass against a broken policy.
    """
    for i in range(3):
        a = f.make_student(cohort, f"A{i}", roll_no=f"A{i}")
        b = f.make_student(other_cohort, f"B{i}", roll_no=f"B{i}")
        f.record(a, cohort.chapter("Thermodynamics"), "ccww")
        f.record(b, other_cohort.chapter("Thermodynamics"), "ccww")
    return cohort, other_cohort


# ----------------------------------------------------------- the trap


def test_the_naive_test_is_vacuous(two_tenants):
    """The connection's own role bypasses RLS, so an unscoped test is a lie.

    This is not a test of the product; it is a test of the *test suite*.
    If someone ever points `DATABASE_URL` at a non-superuser role this
    will fail, and the right response is to celebrate and delete it.
    """
    a, b = two_tenants
    with connection.cursor() as cur:
        cur.execute(
            "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
        )
        is_super, bypass = cur.fetchone()
    assert is_super or bypass, (
        "The test role no longer bypasses RLS. Every assertion in this file "
        "that relies on tenant_scope() is still correct, but the warning "
        "this test encodes is obsolete."
    )

    # Setting the tenant *without* dropping privileges changes nothing:
    # all six students stay visible, so "count is smaller" would be false
    # here and a test written the other way round would be meaningless.
    assert Student.objects.count() == 6
    assert foreign_rows(Student, a.institute.id) == 3


# ------------------------------------------------------------- reads


def test_reads_partition_between_tenants(two_tenants):
    a, b = two_tenants
    unscoped = Student.objects.count()

    with tenant_scope(a.institute.id):
        a_ids = visible_ids(Student)
        a_foreign = foreign_rows(Student, a.institute.id)
    with tenant_scope(b.institute.id):
        b_ids = visible_ids(Student)
        b_foreign = foreign_rows(Student, b.institute.id)

    assert len(a_ids) + len(b_ids) == unscoped == 6, "counts must partition the total"
    assert a_foreign == 0 and b_foreign == 0, "a foreign-institute row was reachable"
    assert not (a_ids & b_ids), "two tenants can see the same row"
    assert len(a_ids) == len(b_ids) == 3, (
        "equal cardinality is the point of this fixture -- identity, not "
        "counting, is what proves isolation here"
    )


def test_reads_are_isolated_on_the_event_tables(two_tenants):
    """Not only `tenancy_student`. A per-app mistake shows up here."""
    a, b = two_tenants
    with tenant_scope(a.institute.id):
        assert Attempt.objects.count() == 12
        assert foreign_rows(Attempt, a.institute.id) == 0
    with tenant_scope(b.institute.id):
        assert Attempt.objects.count() == 12
        assert foreign_rows(Attempt, b.institute.id) == 0
    assert Attempt.objects.count() == 24


def test_unset_tenant_fails_closed(two_tenants):
    """No request, no tenant, no rows. The symptom is emptiness, not an error."""
    with tenant_scope(None):
        assert current_tenant() is None
        assert Student.objects.count() == 0
        assert Attempt.objects.count() == 0
        assert TopicState.objects.count() == 0


def test_scope_is_released_on_the_error_path(two_tenants):
    """`tenant_scope` must RESET ROLE in a `finally`.

    With CONN_MAX_AGE > 0 the connection is handed to the next request, so
    a leaked SET ROLE would scope somebody else to the previous tenant.
    """
    a, _ = two_tenants
    with pytest.raises(RuntimeError):
        with tenant_scope(a.institute.id):
            raise RuntimeError("boom")
    assert current_tenant() is None
    with connection.cursor() as cur:
        cur.execute("SELECT current_user")
        assert cur.fetchone()[0] != RLS_ROLE
    assert Student.objects.count() == 6


# ------------------------------------------------------------ writes


def test_cross_tenant_insert_is_refused(two_tenants):
    """WITH CHECK, not just USING. A leak by INSERT is still a leak."""
    a, b = two_tenants
    with tenant_scope(a.institute.id), pytest.raises(Exception) as exc:
        with transaction.atomic():
            Student.objects.create(
                institute_id=b.institute.id, batch=b.batch,
                roll_no="STOLEN", name="RLS probe", joined_at=a.batch.exam_date,
            )
    assert "row-level security" in str(exc.value).lower()


def test_cross_tenant_update_touches_nothing(two_tenants):
    a, b = two_tenants
    victim = Student.objects.filter(institute_id=a.institute.id).first()

    with tenant_scope(b.institute.id):
        touched = Student.objects.filter(id=victim.id).update(target="stolen")
    assert touched == 0

    with tenant_scope(a.institute.id):
        assert Student.objects.filter(id=victim.id).count() == 1, (
            "the row must exist for institute A, or the update above proved "
            "nothing but a missing row"
        )
    victim.refresh_from_db()
    assert victim.target != "stolen"


# ------------------------------------------------- the meta-test


def _isolation_holds(institute_id: int, expected_own: int) -> bool:
    """The property under test, as one boolean, so it can be negated.

    Both halves matter. "No foreign rows" alone is satisfied by a table
    that returns nothing at all -- which is what dropping the only policy
    produces, because RLS with no policy is default-deny. A test that
    cannot tell a leak from an outage is not much of a test.
    """
    with tenant_scope(institute_id):
        own = Student.objects.filter(institute_id=institute_id).count()
        foreign = Student.objects.exclude(institute_id=institute_id).count()
    return own == expected_own and foreign == 0


def _immediate_constraints() -> None:
    """Flush deferred FK triggers so DDL is allowed inside the test transaction.

    Django defers constraint checks in tests; Postgres then refuses
    `ALTER TABLE` with "pending trigger events" until they are resolved.
    """
    with connection.cursor() as cur:
        cur.execute("SET CONSTRAINTS ALL IMMEDIATE")


def test_isolation_breaks_when_the_policy_stops_filtering(two_tenants):
    """Proof that the assertions above are not vacuous.

    The policy is replaced with `USING (true)` -- the realistic way this
    breaks, and the one a count-only test would sail straight past. If
    the checks in this file still "passed" against it they would be
    testing nothing.

    All of it is rolled back with the test transaction: Postgres DDL is
    transactional, so the real policy is back before the next test.
    """
    a, b = two_tenants
    assert _isolation_holds(a.institute.id, 3)

    with connection.cursor() as cur:
        cur.execute("DROP POLICY tenant_isolation ON tenancy_student")
        cur.execute(
            "CREATE POLICY tenant_isolation ON tenancy_student FOR ALL "
            "USING (true) WITH CHECK (true)"
        )

    with tenant_scope(a.institute.id):
        leaked = Student.objects.exclude(institute_id=a.institute.id).count()
    assert leaked == 3, "the broken policy did not actually leak; test is inconclusive"
    assert not _isolation_holds(a.institute.id, 3), (
        "isolation still 'held' against a USING (true) policy -- the RLS "
        "tests in this file are not testing anything"
    )

    with connection.cursor() as cur:
        cur.execute("DROP POLICY tenant_isolation ON tenancy_student")
        cur.execute(
            "CREATE POLICY tenant_isolation ON tenancy_student FOR ALL "
            "USING (institute_id = app_current_institute()) "
            "WITH CHECK (institute_id = app_current_institute())"
        )
    assert _isolation_holds(a.institute.id, 3)


def test_isolation_breaks_when_rls_is_disabled_on_the_table(two_tenants):
    """The other way to break it: the policy survives, the switch is off."""
    a, b = two_tenants
    _immediate_constraints()
    with connection.cursor() as cur:
        cur.execute("ALTER TABLE tenancy_student DISABLE ROW LEVEL SECURITY")

    with tenant_scope(a.institute.id):
        assert Student.objects.count() == 6, "disabling RLS did not open the table"
    assert not _isolation_holds(a.institute.id, 3)

    with connection.cursor() as cur:
        cur.execute("ALTER TABLE tenancy_student ENABLE ROW LEVEL SECURITY")
        cur.execute("ALTER TABLE tenancy_student FORCE ROW LEVEL SECURITY")
    assert _isolation_holds(a.institute.id, 3)


def test_dropping_the_only_policy_fails_closed_rather_than_open(two_tenants):
    """Default-deny, stated explicitly.

    RLS with no policy returns nothing. That is the right direction to
    fail in, and it is also why `_isolation_holds` has to check that the
    tenant's own rows are still visible.
    """
    a, _ = two_tenants
    with connection.cursor() as cur:
        cur.execute("DROP POLICY tenant_isolation ON tenancy_student")
    with tenant_scope(a.institute.id):
        assert Student.objects.count() == 0
    assert not _isolation_holds(a.institute.id, 3)


# ------------------------------------------------------- coverage drift


def test_every_table_with_institute_id_is_policed(db):
    """A new tenant table without a policy is a leak waiting to happen.

    Mirrors `manage.py rls_check`'s coverage pass. It fails the moment a
    migration adds an `institute_id` column to a table nobody policed.
    """
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
                   EXISTS (SELECT 1 FROM pg_policy p
                           WHERE p.polrelid = c.oid
                             AND p.polname = 'tenant_isolation')
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_attribute a ON a.attrelid = c.oid
            WHERE n.nspname = 'public' AND c.relkind = 'r'
              AND a.attname = 'institute_id' AND NOT a.attisdropped
            ORDER BY c.relname
            """
        )
        rows = cur.fetchall()

    assert rows, "no tenant tables found -- the query is wrong, not the schema"
    bad = [name for name, enabled, forced, policy in rows if not (enabled and forced and policy)]
    assert not bad, f"tables with institute_id but no enforced policy: {bad}"


def test_indirectly_scoped_tables_are_policed(db):
    """Three tables hold tenant data without carrying `institute_id`."""
    with connection.cursor() as cur:
        for table in ("syllabus_topic", "derived_intervention", "tenancy_institute"):
            cur.execute(
                "SELECT c.relrowsecurity, c.relforcerowsecurity, "
                "EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid) "
                "FROM pg_class c WHERE c.relname = %s",
                [table],
            )
            enabled, forced, policy = cur.fetchone()
            assert enabled and forced and policy, f"{table} is not policed"


def test_topics_are_isolated_despite_having_no_institute_column(two_tenants):
    """`syllabus_topic` is the same-cardinality case, for real.

    Both institutes own exactly 12 chapters plus their units and subjects,
    so the counts are identical and only the identity check can tell a
    working EXISTS policy from `USING (true)`.
    """
    from apps.syllabus.models import Topic

    a, b = two_tenants
    with tenant_scope(a.institute.id):
        a_ids = visible_ids(Topic)
    with tenant_scope(b.institute.id):
        b_ids = visible_ids(Topic)

    assert len(a_ids) == len(b_ids) > 0
    assert not (a_ids & b_ids), "identical counts, overlapping rows -- policy is open"
    assert len(a_ids) + len(b_ids) == Topic.objects.count()


# ------------------------------------------------- the real request path


def test_mentor_sees_only_their_own_institute_over_http(two_tenants, client):
    """End to end, through `TenantMiddleware`, not through `tenant_scope`.

    This is the path a customer actually uses, and it is the one that
    catches "the middleware stopped running" -- which `tenant_scope` tests
    cannot see.
    """
    a, b = two_tenants
    a_user = f.make_mentor_user(a, username="mentor-a")
    b_user = f.make_mentor_user(b, username="mentor-b")

    client.force_login(a_user)
    a_names = {row["name"] for row in client.get("/api/students/").json()["results"]}

    client.force_login(b_user)
    b_names = {row["name"] for row in client.get("/api/students/").json()["results"]}

    assert a_names == {"A0", "A1", "A2"}
    assert b_names == {"B0", "B1", "B2"}
    assert not (a_names & b_names)


def test_the_connection_is_reset_after_a_request(two_tenants, client):
    """A leaked `SET ROLE` would scope the *next* caller to the last tenant."""
    a, _ = two_tenants
    client.force_login(f.make_mentor_user(a, username="mentor-reset"))
    assert client.get("/api/students/").status_code == 200
    assert current_tenant() is None
    assert Student.objects.count() == 6, "the connection is still scoped after the request"
