"""Put `reasoning_reasoningtrace` behind row-level security.

Caught by `tests/test_rls.py::test_every_table_with_institute_id_is_policed`,
which sweeps for tables carrying `institute_id` without an enforced policy.
That test existed precisely so a new tenant-scoped table could not slip in
unprotected, and this is the first time it has earned its keep.

The gap matters more here than on most tables: a reasoning trace holds the
full de-identified payload *and* the model's written analysis of one
student. Leaking it across tenants would hand a competing institute a
narrative account of another institute's students.

Mirrors `tenancy/0003_row_level_security` exactly — ENABLE, FORCE (the
table owner bypasses RLS without it), and a policy keyed on the same
STABLE function so the planner still treats it as an indexable constant.
"""

from django.db import migrations

APP_ROLE = "student_ai_rls"
TABLE = "reasoning_reasoningtrace"

FORWARD = f"""
ALTER TABLE {TABLE} ENABLE ROW LEVEL SECURITY;
ALTER TABLE {TABLE} FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON {TABLE}
    USING (institute_id = app_current_institute())
    WITH CHECK (institute_id = app_current_institute());

GRANT SELECT, INSERT, UPDATE, DELETE ON {TABLE} TO {APP_ROLE};
"""

BACKWARD = f"""
DROP POLICY IF EXISTS tenant_isolation ON {TABLE};
ALTER TABLE {TABLE} NO FORCE ROW LEVEL SECURITY;
ALTER TABLE {TABLE} DISABLE ROW LEVEL SECURITY;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("reasoning", "0001_initial"),
        ("tenancy", "0003_row_level_security"),
    ]

    operations = [migrations.RunSQL(FORWARD, BACKWARD)]
