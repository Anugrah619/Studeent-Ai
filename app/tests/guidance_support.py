"""Shared helpers for the guidance tests. Not a test module.

`RecordingGemini` is `tests/test_gemini_client.py::FakeGemini` with one
addition that the guidance tests need: it keeps *what was sent* — the
payload as JSON and the system prompt — so a PII scan can be run on the
bytes that would actually have left the building, not on a dict that was
built nearby.
"""

from __future__ import annotations

import json
import types

from rest_framework.test import APIClient

from apps.reasoning.services import gemini


class ApiError(Exception):
    """Shaped like the SDK's errors: a numeric `code`, and a message."""

    def __init__(self, code: int, message: str = "the server said no"):
        super().__init__(message)
        self.code = code


class RecordingGemini:
    """Stands in for `genai.Client`, answers a script, records every call.

    Each script entry is a dict (returned as JSON), a raw string, or an
    exception to raise; the last entry repeats for every later call.
    """

    def __init__(self, *script):
        self._script = list(script) or [ApiError(503, "no capacity")]
        self.calls: list[dict] = []
        self.models = self

    def generate_content(self, *, model, contents, config):
        self.calls.append({
            "model": model,
            "payload": json.loads(contents),
            "body": contents,
            "system_prompt": config.system_instruction,
        })
        step = self._script[min(len(self.calls) - 1, len(self._script) - 1)]
        if isinstance(step, BaseException):
            raise step
        text = step if isinstance(step, str) else json.dumps(step)
        return types.SimpleNamespace(
            text=text,
            usage_metadata=types.SimpleNamespace(prompt_token_count=900,
                                                 candidates_token_count=60),
        )


def use(monkeypatch, client) -> None:
    """Open the network guard in `conftest` onto this client and nothing else.

    `None` is "no API key configured": `gemini.reason` then replays a cached
    trace or raises `NoCredentialsAndNoCache`, without any network.
    """
    monkeypatch.setattr(gemini, "_client", lambda: client)


def login(user) -> APIClient:
    client = APIClient()
    client.force_login(user)
    return client


def identifiers(student, cohort) -> dict[str, str]:
    """Everything about this student that must never reach Google.

    The same list as `test_reasoning_payload.identifiers`, plus the login
    username and email, which a student's own account carries.
    """
    user = student.user
    out = {
        "full name": student.name,
        "given name": student.name.split()[0],
        "family name": student.name.split()[-1],
        "roll number": student.roll_no,
        "stated target": student.target,
        "mentor name": cohort.mentor.name,
        "mentor given name": cohort.mentor.name.split()[0],
        "mentor email": cohort.mentor.email,
        "institute name": cohort.institute.name,
        "institute slug": cohort.institute.slug,
        "institute city": cohort.institute.city,
        "personal date": student.joined_at.isoformat(),
    }
    if user is not None:
        out["username"] = user.get_username()
        out["account email"] = user.email
    return out


def find_pii(payload, secrets: dict[str, str]) -> list[str]:
    """Names of every identifier that survives into the serialised payload.

    Serialising the whole object is the point — every field, present and
    future, nested at any depth, is covered by one assertion. See
    `test_reasoning_payload.find_pii`, which this mirrors exactly.
    """
    blob = json.dumps(payload, default=str, ensure_ascii=False).lower()
    return sorted(
        label for label, value in secrets.items() if value and value.lower() in blob
    )
