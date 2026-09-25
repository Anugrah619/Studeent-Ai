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

#: Model ids move faster than this codebase does — `gemini-2.5-flash` was
#: closed to new keys partway through development, with a 404 pointing at
#: the successor. Read it from settings so a swap is an .env edit, and ask
#: the API (`client.models.list()`) rather than guessing when it breaks.
DEFAULT_MODEL = getattr(settings, "GEMINI_MODEL", "") or "gemini-3.8-flash"

#: Tried in order when the preferred model is unavailable. Newest first,
#: then progressively older Flash tiers, then Lite — quality degrades
#: gently, which is the right trade against a panel that does not render.
FALLBACK_MODELS = [
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-flash-latest",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
]


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

    from google.genai import types

    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        response_mime_type="application/json",
        response_schema=response_schema,
        temperature=0.2,
    )
    body = json.dumps(context, indent=2)

    last_error = ""
    for candidate in _model_chain(model):
        trace = ReasoningTrace(
            institute_id=institute_id, student_id=student_id, task=task,
            context=context, context_hash=context_hash,
            model=candidate, prompt_version=prompt_version,
        )
        started = time.monotonic()
        try:
            response = client.models.generate_content(
                model=candidate, contents=body, config=config
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

            trace.save()
            if candidate != model:
                logger.warning("reasoning: fell back from %s to %s", model, candidate)
            return trace.output, trace

        except json.JSONDecodeError as exc:
            # Bad output, not a bad model — another one will fail the same way.
            trace.latency_ms = int((time.monotonic() - started) * 1000)
            trace.error = f"Model returned text that is not valid JSON: {exc}"
            trace.save()
            raise GeminiUnavailable(trace.error) from exc

        except Exception as exc:
            trace.latency_ms = int((time.monotonic() - started) * 1000)
            trace.error = f"{type(exc).__name__}: {exc}"
            trace.save()
            last_error = trace.error
            if not _try_another_model(exc):
                raise GeminiUnavailable(trace.error) from exc
            logger.warning("reasoning: %s unavailable, trying next — %s",
                           candidate, str(exc)[:120])

    raise GeminiUnavailable(
        f"Every model in the fallback chain was unavailable. Last error: {last_error}"
    )


def _model_chain(preferred: str) -> list[str]:
    """The preferred model, then progressively older ones.

    Added after a live run hit `503 UNAVAILABLE — this model is currently
    experiencing high demand` on five models in a row. That is Google-side
    capacity, not something we cause or can fix, and a pitch is exactly when
    it will happen. Falling back to an older Flash costs a little quality;
    a dead panel in front of a director costs the meeting.

    Paired with the trace cache this is belt and braces: rehearse the demo
    once and the cached trace serves it even if the API is down entirely.
    """
    chain = [preferred] + [m for m in FALLBACK_MODELS if m != preferred]
    return chain


def _try_another_model(exc: Exception) -> bool:
    """Is the *next* model worth attempting, or is this fatal for all of them?

    Worth continuing:
      503 / 500 / 504  capacity — another model may have headroom
      429              rate limit on this model
      404              this model is gone or closed to new keys. Fatal for
                       it, irrelevant to the rest — Google retires model ids
                       faster than a codebase updates, and the first live run
                       of this client hit exactly that on `gemini-2.5-flash`.

    Not worth continuing: 400/401/403 are our request or our key, and every
    model will reject them identically. Retrying just spends quota to reach
    the same answer more slowly.
    """
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    if code in (404, 429, 500, 502, 503, 504):
        return True
    text = str(exc)
    return any(
        s in text
        for s in ("404", "503", "429", "NOT_FOUND", "UNAVAILABLE", "RESOURCE_EXHAUSTED")
    )
