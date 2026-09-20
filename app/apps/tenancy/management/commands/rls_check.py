"""Prove row-level security is actually isolating tenants.

    manage.py rls_check

Four things get checked, in order of how badly they fail:

  1. COVERAGE  - every table with an institute_id has RLS enabled, FORCEd,
                 and a tenant_isolation policy. Catches the case where
                 someone adds a table and forgets. Also catches ENABLE
                 without FORCE, which is the failure that looks fine.
  2. READ      - set app.institute_id to A, count; to B, count; unset,
                 count. If A and B come back the same, RLS is not running.
  3. WRITE     - a row belonging to the wrong institute must be rejected by
                 WITH CHECK, and a cross-tenant UPDATE must touch 0 rows.
  4. FAIL-OPEN - the unset case must return 0, not everything.

Exit code is non-zero if any check fails, so it can sit in CI.

`--verbose-sql` prints the per-table detail instead of only the summary.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

from apps.tenancy.rls import RLS_ROLE, SETTING

# Sampled for the read test. One from each app, so a per-app mistake shows.
SAMPLE_TABLES = [
    "tenancy_student",
    "tenancy_batch",
    "events_attempt",
    "events_studylog",
    "ingestion_questiontopicmap",
    "derived_topicstate",
    "derived_flag",
    "syllabus_topic",
]

# Sampled tables reached through an owning row rather than their own column.
NO_INSTITUTE_COLUMN = {"syllabus_topic", "derived_intervention"}

TENANT_COLUMN_SQL = """
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
       EXISTS (SELECT 1 FROM pg_policy p
               WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND a.attname = 'institute_id' AND NOT a.attisdropped
ORDER BY c.relname
"""

OK, BAD = "  ok  ", " FAIL "


class Command(BaseCommand):
    help = "Verify Postgres row-level security is enforcing tenant isolation."

    def add_arguments(self, parser):
        parser.add_argument(
            "--verbose-sql", action="store_true",
            help="Show per-table counts rather than just the summary.",
        )

    # ------------------------------------------------------------ helpers

    def _rows(self, sql, params=None):
        with connection.cursor() as cur:
            cur.execute(sql, params or [])
            return cur.fetchall()

    def _one(self, sql, params=None):
        return self._rows(sql, params)[0][0]

    def _counts(self, tables):
        return {t: self._one(f"SELECT count(*) FROM {t}") for t in tables}

    def _set_tenant(self, value):
        with connection.cursor() as cur:
            cur.execute("SELECT set_config(%s, %s, false)", [SETTING, value])

    def line(self, ok, text):
        style = self.style.SUCCESS if ok else self.style.ERROR
        self.stdout.write(f"[{style(OK if ok else BAD)}] {text}")
        if not ok:
            self.failed = True

    # --------------------------------------------------------------- main

    def handle(self, *args, **opts):
        self.failed = False
        self.verbose = opts["verbose_sql"]

        self.stdout.write(self.style.MIGRATE_HEADING("\n== connection =="))
        who, is_super, bypass = self._rows(
            "SELECT current_user, rolsuper, rolbypassrls "
            "FROM pg_roles WHERE rolname = current_user"
        )[0]
        self.stdout.write(
            f"    connected as {who!r}  superuser={is_super}  bypassrls={bypass}"
        )
        if is_super or bypass:
            self.stdout.write(
                "    -> this role bypasses RLS outright, which is why the app "
                f"drops to {RLS_ROLE!r} per request.\n"
                "      The test below does the same thing with SET ROLE."
            )

        institutes = self._rows(
            "SELECT id, name FROM tenancy_institute ORDER BY id"
        )
        if len(institutes) < 2:
            raise CommandError(
                "Need at least two institutes to prove isolation; found "
                f"{len(institutes)}. Seed the demo data first."
            )

        self.check_coverage()

        unscoped = self._counts(SAMPLE_TABLES)

        # Everything from here runs as the unprivileged role.
        with connection.cursor() as cur:
            cur.execute(f"SET ROLE {RLS_ROLE}")
        try:
            self.check_reads(institutes, unscoped)
            self.check_unset_is_closed()
            self.check_writes(institutes)
        finally:
            with connection.cursor() as cur:
                cur.execute("SELECT set_config(%s, '', false)", [SETTING])
                cur.execute("RESET ROLE")

        self.stdout.write("")
        if self.failed:
            raise CommandError("RLS is NOT enforcing isolation. See failures above.")
        self.stdout.write(self.style.SUCCESS(
            "RLS verified: tenants are isolated, unset fails closed, "
            "cross-tenant writes are rejected.\n"
        ))

    # ------------------------------------------------------------- checks

    def check_coverage(self):
        self.stdout.write(self.style.MIGRATE_HEADING("\n== 1. coverage =="))
        rows = self._rows(TENANT_COLUMN_SQL)
        bad = [r for r in rows if not (r[1] and r[2] and r[3])]
        for name, enabled, forced, policy in rows:
            if self.verbose or not (enabled and forced and policy):
                flags = f"enabled={enabled} forced={forced} policy={policy}"
                self.line(enabled and forced and policy, f"{name:<32} {flags}")
        self.line(
            not bad,
            f"{len(rows) - len(bad)}/{len(rows)} tables with institute_id are "
            "RLS-enabled, FORCEd, and carry tenant_isolation",
        )

        # Tables with no institute_id that still hold tenant data.
        for t in ("syllabus_topic", "derived_intervention", "tenancy_institute"):
            enabled, forced, policy = self._rows(
                "SELECT c.relrowsecurity, c.relforcerowsecurity, "
                "EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid) "
                "FROM pg_class c WHERE c.relname = %s", [t],
            )[0]
            self.line(
                enabled and forced and policy,
                f"{t:<32} covered by an indirect policy (no institute_id column)",
            )

    def check_reads(self, institutes, unscoped):
        """Three assertions per table, because a count alone proves little.

        PARTITION  sum of the per-tenant counts equals the unscoped count.
                   Too many rows means a leak; too few means the policy is
                   eating rows nobody can see, which is its own bug.
        DISJOINT   while scoped to A, no row carrying a different
                   institute_id is reachable — a direct statement of the
                   property we care about, not an inference from a total.
        FILTERING  the visible set actually shrinks somewhere. Without this
                   a policy of `USING (true)` would pass the other two.

        Identity, not just cardinality, is compared via an md5 over the
        visible ids: two tenants can hold the same *number* of rows (both
        institutes here have exactly 71 topics) and a count test would call
        that a pass while the policy leaked.
        """
        self.stdout.write(self.style.MIGRATE_HEADING("\n== 2. read isolation =="))
        per_institute, digests, strangers = {}, {}, {}

        for inst_id, name in institutes:
            self._set_tenant(str(inst_id))
            per_institute[inst_id] = self._counts(SAMPLE_TABLES)
            digests[inst_id] = {
                t: self._one(
                    f"SELECT coalesce(md5(string_agg(id::text, ',' ORDER BY id)), '-') "
                    f"FROM {t}"
                )
                for t in SAMPLE_TABLES
            }
            strangers[inst_id] = {
                t: self._one(
                    f"SELECT count(*) FROM {t} WHERE institute_id <> %s", [inst_id]
                )
                for t in SAMPLE_TABLES
                if t not in NO_INSTITUTE_COLUMN
            }
            self.stdout.write(f"\n    app.institute_id = {inst_id}  ({name})")
            for t in SAMPLE_TABLES:
                self.stdout.write(
                    f"        {t:<30} {per_institute[inst_id][t]:>7}"
                    f"   (unscoped {unscoped[t]})"
                    f"   rows[{digests[inst_id][t][:8]}]"
                )

        self.stdout.write("")
        ids = [i for i, _ in institutes]
        for t in SAMPLE_TABLES:
            seen = [per_institute[i][t] for i in ids]
            seen_digests = [digests[i][t] for i in ids]
            foreign = [strangers[i].get(t, 0) for i in ids]

            partitions = sum(seen) == unscoped[t]
            # Non-empty tenants must not be looking at the same rows.
            nonempty = [d for d in seen_digests if d != "-"]
            distinct = len(set(nonempty)) == len(nonempty)
            filtering = any(s < unscoped[t] for s in seen)
            disjoint = not any(foreign)

            notes = []
            if not partitions:
                notes.append(f"partition sum {sum(seen)} != {unscoped[t]}")
            if not distinct:
                notes.append("two tenants see an IDENTICAL row set")
            if not filtering:
                notes.append("no tenant sees fewer rows than unscoped")
            if not disjoint:
                notes.append(f"foreign-institute rows visible: {foreign}")

            self.line(
                partitions and distinct and filtering and disjoint,
                f"{t:<30} per-tenant {seen} of {unscoped[t]}"
                + ("" if not notes else "  <- " + "; ".join(notes)),
            )

    def check_unset_is_closed(self):
        self.stdout.write(self.style.MIGRATE_HEADING(
            "\n== 3. unset setting fails closed =="
        ))
        self._set_tenant("")
        empty = self._counts(SAMPLE_TABLES)
        leaked = {t: n for t, n in empty.items() if n != 0}
        self.line(
            not leaked,
            "with app.institute_id unset every tenant table reads 0 rows"
            + (f"  leaked: {leaked}" if leaked else ""),
        )

    def check_writes(self, institutes):
        self.stdout.write(self.style.MIGRATE_HEADING("\n== 4. write isolation =="))
        a, b = institutes[0][0], institutes[1][0]

        self._set_tenant(str(a))
        # A student that belongs to A is visible; pick one to try to steal.
        row = self._rows(
            "SELECT id, batch_id FROM tenancy_student LIMIT 1"
        )
        if not row:
            self.line(False, "no students visible for institute A - cannot test writes")
            return
        student_id, batch_id = row[0]

        # 4a. INSERT tagged with the *other* institute must be refused.
        try:
            with transaction.atomic():
                self._rows(
                    "INSERT INTO tenancy_student "
                    "(institute_id, batch_id, roll_no, name, target, joined_at) "
                    "VALUES (%s, %s, 'RLS-PROBE', 'RLS probe', '', CURRENT_DATE)",
                    [b, batch_id],
                )
                transaction.set_rollback(True)
            self.line(False, "cross-tenant INSERT was ACCEPTED (WITH CHECK missing)")
        except Exception as exc:  # noqa: BLE001 - we want the message
            refused = "row-level security" in str(exc).lower()
            self.line(refused, f"cross-tenant INSERT refused: {str(exc).splitlines()[0]}")

        # 4b. UPDATE of a row belonging to the other institute hits nothing,
        #     even though the row demonstrably exists.
        self._set_tenant(str(b))
        with transaction.atomic():
            with connection.cursor() as cur:
                cur.execute(
                    "UPDATE tenancy_student SET target = 'stolen' WHERE id = %s",
                    [student_id],
                )
                touched = cur.rowcount
            transaction.set_rollback(True)
        self.line(
            touched == 0,
            f"UPDATE of institute-{a} student {student_id} while scoped to "
            f"institute {b} touched {touched} rows",
        )

        # 4c. ...and the row is definitely there when scoped correctly.
        self._set_tenant(str(a))
        visible = self._one(
            "SELECT count(*) FROM tenancy_student WHERE id = %s", [student_id]
        )
        self.line(
            visible == 1,
            f"the same row is visible to institute {a} (count={visible}), so 4b "
            "was isolation and not a missing row",
        )
