"""Shared fixtures.

pytest-django builds its **own** database (`test_student_ai`) and runs
every migration into it, including `tenancy/0003_row_level_security`. So
RLS is live in the test database, and the seeded dev data is never
touched by this suite -- nothing here reads or writes it.

The test connection is `sai`, which is SUPERUSER/BYPASSRLS, so tests see
everything *unless* they enter `tenant_scope()`. That is the behaviour we
want for fixtures, and it is also the trap: an RLS test that forgets
`tenant_scope` passes without proving anything. See `tests/test_rls.py`.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from tests import factories as f


@pytest.fixture
def cohort(db):
    """One institute with a full syllabus tree, a batch and a mentor."""
    return f.build_cohort(name="Aarambh Classes", slug="aarambh-test")


@pytest.fixture
def other_cohort(db):
    """A second institute. Exists so isolation has something to isolate from."""
    return f.build_cohort(name="Pinnacle Academy", slug="pinnacle-test")


@pytest.fixture
def anon_client(db):
    return APIClient()


@pytest.fixture
def mentor_client(cohort):
    """A logged-in mentor. Goes through the real middleware, so the
    connection is scoped by `TenantMiddleware` exactly as in production."""
    user = f.make_mentor_user(cohort, username="mentor-fixture")
    client = APIClient()
    client.force_login(user)
    return client
