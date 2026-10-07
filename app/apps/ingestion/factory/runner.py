"""What every model-using step shares: a request budget, and stopping cleanly.

The free tier has a daily request limit shared with the live demo. Each
step therefore takes a budget of *live* calls (cache replays are free and
uncounted), saves after every batch, and on an exhausted quota stops the
step — not the process, and never by inventing what it could not get.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from apps.reasoning.models import ReasoningTrace
from apps.reasoning.services import gemini


class StepStopped(RuntimeError):
    """A step ended early for a reason worth reporting (quota, capacity, budget)."""


@dataclass
class Budget:
    max_live: int | None = None
    live: int = 0
    cached: int = 0
    failed_batches: int = 0
    attempts: int = 0            # every request sent, including fallbacks
    notes: list[str] = field(default_factory=list)

    def check(self) -> None:
        if self.max_live is not None and self.live >= self.max_live:
            raise StepStopped(f"budget of {self.max_live} live calls reached")

    def count(self, trace: ReasoningTrace, task: str, attempts_before: int) -> None:
        if getattr(trace, "_from_cache", False):
            self.cached += 1
        else:
            self.live += 1
        self.attempts += attempts_now(task) - attempts_before

    def summary(self) -> dict:
        return {"live_calls": self.live, "cache_hits": self.cached,
                "requests_sent": self.attempts, "failed_batches": self.failed_batches,
                "notes": self.notes}


def is_quota(exc: Exception) -> bool:
    text = str(exc)
    return "RESOURCE_EXHAUSTED" in text or "429" in text or "quota" in text.lower()


def is_bad_json(exc: Exception) -> bool:
    return "not valid JSON" in str(exc)


def classify_stop(exc: Exception) -> str:
    if isinstance(exc, gemini.NoCredentialsAndNoCache):
        return "no API key and nothing cached"
    if is_quota(exc):
        return "free-tier quota exhausted on every model in the chain"
    return f"Gemini unavailable: {str(exc)[:200]}"


def attempts_now(task: str) -> int:
    """Traces written for `task` so far — one per request sent, fallbacks included."""
    return ReasoningTrace.objects.filter(task=task).count()


def is_capacity(exc: Exception) -> bool:
    text = str(exc)
    return not is_quota(exc) and any(
        s in text for s in ("503", "UNAVAILABLE", "high demand", "500", "504"))


def with_capacity_retries(call, *, rounds: int, wait_s: float, log=print):
    """Run `call()`; if every model is merely busy (503), wait and try again.

    Google-side capacity comes and goes in minutes. Quota exhaustion and
    malformed output are not waited out — they are re-raised at once.
    """
    import time

    for attempt in range(rounds + 1):
        try:
            return call()
        except gemini.GeminiUnavailable as exc:
            if attempt == rounds or is_bad_json(exc) or not is_capacity(exc):
                raise
            log(f"    every allowed model is busy; waiting {int(wait_s)}s "
                f"(retry {attempt + 1}/{rounds})")
            time.sleep(wait_s)
