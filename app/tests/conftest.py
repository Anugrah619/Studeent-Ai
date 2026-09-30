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

from apps.reasoning.services import gemini as _gemini
from tests import factories as f

#: The genuine `_client`, captured before `no_gemini_network` replaces it.
#: One test needs it, to prove that with no key configured it declines to
#: build a client -- a path that returns None before the SDK is even
#: imported, so it cannot reach the network either.
REAL_GEMINI_CLIENT = _gemini._client


@pytest.fixture(autouse=True)
def no_gemini_network(monkeypatch):
    """No test may reach Google. Not one, not ever.

    `app/.env` carries a **real** API key, and pytest loads the same
    settings module the server does -- so a reasoning test that forgets to
    mock would quietly spend live free-tier quota (500 requests/day, shared
    with the demo), take seconds per call, flake on Google's capacity, and
    fail outright in CI where no key exists.

    So the module boundary is closed by default and opened per test:
    `apps.reasoning.services.gemini._client` is the one function that
    builds an SDK client, and here it explodes instead. A test that wants a
    client re-patches it with a fake; a later `monkeypatch.setattr` in the
    test body simply wins.
    """

    def _forbidden():
        raise AssertionError(
            "A test tried to build a real Gemini client. Patch "
            "apps.reasoning.services.gemini._client with a fake instead — "
            "see tests/test_gemini_client.py::FakeGemini."
        )

    monkeypatch.setattr(_gemini, "_client", _forbidden)


@pytest.fixture
def real_gemini_client():
    """The unpatched `gemini._client`, for the no-credentials test only."""
    return REAL_GEMINI_CLIENT


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
