"""Gemini with a document in hand — the reader behind the question factory.

`gemini.reason` sends JSON and gets JSON back. This module does the same
with one or more PDFs attached, because the factory's rule is **open book,
not closed book**: Gemini reads the official paper in front of it and is
never the source of a question, an answer, or a year.

It deliberately reuses the client, the model fallback chain and the
retry policy from `gemini.py` rather than copying them, so there is still
exactly one place that decides which model is tried and when to give up.
It keeps the same three promises:

1. **Every call is traced** — success or failure, as a `ReasoningTrace`.
2. **Identical requests never re-run.** The cache key is the task, the
   prompt version, and a context that names each attached document by the
   SHA-256 of the *original* file plus the exact pages sent. The bytes of a
   page subset are not hashed: PDF writers stamp them with fresh ids, so
   hashing them would miss the cache on every run.
3. **Nothing is fabricated.** No key and no cache → it raises.

What goes into `trace.context` is the JSON body plus a `documents` list of
{file, sha256, pages}. That is enough to rebuild the request byte-for-byte
from `data/raw/papers/` — a trace whose input cannot be reproduced is an
anecdote, not a training example. The PDF bytes themselves are not stored:
exam content stays out of every table except the question tables.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field

from apps.reasoning.models import ReasoningTrace
from apps.reasoning.services import gemini

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Document:
    """One PDF attached to a request.

    `pages` are 1-based page numbers of the *original* file that `data`
    contains, in order. They are what the trace records and what the cache
    keys on, so they must describe `data` exactly.
    """

    file: str
    sha256: str
    pages: tuple[int, ...]
    data: bytes = field(repr=False, compare=False)
    mime_type: str = "application/pdf"

    def describe(self) -> dict:
        return {"file": self.file, "sha256": self.sha256, "pages": list(self.pages)}


def ask(
    *,
    task: str,
    context: dict,
    system_prompt: str,
    response_schema: dict,
    institute_id: int,
    documents: list[Document] | tuple[Document, ...] = (),
    prompt_version: str = "v1",
    model: str = gemini.DEFAULT_MODEL,
    models: list[str] | None = None,
    temperature: float = 0.2,
    force: bool = False,
) -> tuple[dict, ReasoningTrace]:
    """Run one task over `context` with `documents` attached. Returns (output, trace).

    `models`, if given, replaces the default fallback chain. The question
    factory uses it for its blind solver, which tries the strongest models
    that still have free-tier quota first: a degraded panel is better than
    no panel, but a degraded *verifier* sends good questions to review.

    Raises `gemini.NoCredentialsAndNoCache` or `gemini.GeminiUnavailable`,
    the same as `gemini.reason`, so callers handle both modules alike.
    """
    traced_context = {"documents": [d.describe() for d in documents], **context}
    context_hash = ReasoningTrace.hash_context(traced_context)

    if not force:
        cached = (
            ReasoningTrace.objects
            .filter(
                task=task, context_hash=context_hash,
                prompt_version=prompt_version, output__isnull=False,
            )
            .exclude(output={})
            .first()
        )
        if cached:
            logger.info("document cache hit: %s %s", task, context_hash[:8])
            cached._from_cache = True
            return cached.output, cached

    client = gemini._client()
    if client is None:
        raise gemini.NoCredentialsAndNoCache(
            "GEMINI_API_KEY is not set and nothing is cached for this exact "
            "document request."
        )

    from google.genai import types

    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        response_mime_type="application/json",
        response_schema=response_schema,
        temperature=temperature,
    )
    contents = [
        types.Part.from_bytes(data=d.data, mime_type=d.mime_type) for d in documents
    ] + [json.dumps(context, indent=2, ensure_ascii=False)]

    last_error = ""
    chain = list(models) if models else gemini._model_chain(model)
    for candidate in chain:
        trace = ReasoningTrace(
            institute_id=institute_id, task=task,
            context=traced_context, context_hash=context_hash,
            model=candidate, prompt_version=prompt_version,
        )
        started = time.monotonic()
        try:
            response = client.models.generate_content(
                model=candidate, contents=contents, config=config
            )
            trace.latency_ms = int((time.monotonic() - started) * 1000)

            raw = (response.text or "").strip()
            if not raw:
                raise gemini.GeminiUnavailable("Gemini returned an empty response.")
            trace.output = json.loads(raw)

            usage = getattr(response, "usage_metadata", None)
            if usage:
                trace.input_tokens = getattr(usage, "prompt_token_count", None)
                trace.output_tokens = getattr(usage, "candidates_token_count", None)

            trace.save()
            if candidate != chain[0]:
                logger.warning("documents: fell back from %s to %s", chain[0], candidate)
            return trace.output, trace

        except json.JSONDecodeError as exc:
            # Usually a response cut off at the output limit. Another model
            # given the same oversized request fails the same way; the
            # caller's fix is a smaller batch, not a different model.
            trace.latency_ms = int((time.monotonic() - started) * 1000)
            trace.error = f"Model returned text that is not valid JSON: {exc}"
            trace.save()
            raise gemini.GeminiUnavailable(trace.error) from exc

        except gemini.GeminiUnavailable as exc:
            # Empty response — treat like capacity: another model may answer.
            trace.latency_ms = int((time.monotonic() - started) * 1000)
            trace.error = str(exc)
            trace.save()
            last_error = trace.error
            logger.warning("documents: %s returned nothing, trying next", candidate)

        except Exception as exc:
            trace.latency_ms = int((time.monotonic() - started) * 1000)
            trace.error = f"{type(exc).__name__}: {exc}"
            trace.save()
            last_error = trace.error
            if not gemini._try_another_model(exc):
                raise gemini.GeminiUnavailable(trace.error) from exc
            logger.warning("documents: %s unavailable, trying next — %s",
                           candidate, str(exc)[:120])

    raise gemini.GeminiUnavailable(
        f"Every model in the fallback chain was unavailable. Last error: {last_error}"
    )
