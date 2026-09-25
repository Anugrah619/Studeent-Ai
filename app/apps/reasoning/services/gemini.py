"""The Gemini client. One place, so the provider stays swappable.

Three rules this module enforces so nothing above it has to remember them:

1. **PII never leaves.** Users are minors, and the free tier may use
   submitted content for training, with human review. Payloads carry an
   opaque `student_ref` and nothing else identifying. Re-identification
   happens locally, after the call.
2. **Every call is traced.** A trace not captured is a training example
   gone forever.
3. **Identical state never regenerates.** The free tier allows 500 requests
   a day; a demo that re-reasons on every page load burns that in an hour.

If no API key is configured the client replays a cached trace when one
exists and otherwise raises. It never fabricates a result — a made-up
diagnosis presented as the model's is the one failure this product cannot
survive.
"""

from __future__ import annotations

import json
import logging
import time

from django.conf import settings

from apps.reasoning.models import ReasoningTrace

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-2.5-flash"


class NoCredentialsAndNoCache(RuntimeError):
    """No API key, and nothing cached to replay."""


class GeminiUnavailable(RuntimeError):
    """The call failed. Surfaces as a degraded panel, never as fake output."""


def _client():
    key = getattr(settings, "GEMINI_API_KEY", "")
    if not key:
        return None
    from google import genai

    return genai.Client(api_key=key)


def reason(
    *,
    task: str,
    context: dict,
    system_prompt: str,
    response_schema: dict,
    institute_id: int,
    student_id: int | None = None,
    prompt_version: str = "v1",
    model: str = DEFAULT_MODEL,
    force: bool = False,
) -> tuple[dict, ReasoningTrace]:
    """Run one reasoning task. Returns (output, trace).

    `context` must already be de-identified — this function does not strip
    PII, it assumes the caller built a clean payload. See `payloads.py`,
    which is the only place allowed to construct one.
    """
    context_hash = ReasoningTrace.hash_context(context)

    if not force:
        cached = (
            ReasoningTrace.objects
            .filter(task=task, context_hash=context_hash, output__isnull=False)
            .exclude(output={})
            .first()
        )
        if cached:
            logger.info("reasoning cache hit: %s %s", task, context_hash[:8])
            return cached.output, cached

    client = _client()
    if client is None:
        raise NoCredentialsAndNoCache(
            "GEMINI_API_KEY is not set and nothing is cached for this exact "
            "student state. Set the key in app/.env, or run the task once "
            "with a key so the trace can be replayed offline."
        )

    trace = ReasoningTrace(
        institute_id=institute_id, student_id=student_id, task=task,
        context=context, context_hash=context_hash,
        model=model, prompt_version=prompt_version,
    )

    started = time.monotonic()
    try:
        from google.genai import types

        response = client.models.generate_content(
            model=model,
            contents=json.dumps(context, indent=2),
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                response_mime_type="application/json",
                response_schema=response_schema,
                temperature=0.2,
            ),
        )
        trace.latency_ms = int((time.monotonic() - started) * 1000)

        raw = (response.text or "").strip()
        if not raw:
            raise GeminiUnavailable("Gemini returned an empty response.")
        trace.output = json.loads(raw)

        usage = getattr(response, "usage_metadata", None)
        if usage:
            trace.input_tokens = getattr(usage, "prompt_token_count", None)
            trace.output_tokens = getattr(usage, "candidates_token_count", None)

    except json.JSONDecodeError as exc:
        trace.latency_ms = int((time.monotonic() - started) * 1000)
        trace.error = f"Model returned text that is not valid JSON: {exc}"
        trace.save()
        raise GeminiUnavailable(trace.error) from exc
    except Exception as exc:
        trace.latency_ms = int((time.monotonic() - started) * 1000)
        trace.error = f"{type(exc).__name__}: {exc}"
        trace.save()
        raise GeminiUnavailable(trace.error) from exc

    trace.save()
    return trace.output, trace
