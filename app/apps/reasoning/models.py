"""Every piece of reasoning the system does, kept.

`ReasoningTrace` is two things at once:

1. **A cache.** Identical state re-renders for free, which is what keeps a
   500-request/day free tier viable and a demo instant.
2. **The training corpus.** Each row is one (context → reasoning → output)
   example. Accumulate a few thousand and they fine-tune our own model.

The field that makes this worth more than raw Gemini output is
`human_verdict`. A mentor agreeing or disagreeing turns a teacher-model
guess into a human-validated example, and a dataset of *those* is not
something a competitor gets by buying an API key.
"""

from __future__ import annotations

import hashlib
import json

from django.db import models

from apps.tenancy import models as tenancy


class ReasoningTrace(tenancy.TenantScoped):
    """One call to the reasoning layer."""

    DIAGNOSE = "diagnose_misconception"
    DECLINE = "analyse_decline"
    PLAN = "plan_week"
    FORENSICS = "answer_forensics"
    PRACTICE = "generate_practice"
    SUMMARY = "weekly_summary"
    TASK = [
        (DIAGNOSE, "Diagnose misconception"),
        (DECLINE, "Analyse decline"),
        (PLAN, "Plan the week"),
        (FORENSICS, "Answer forensics"),
        (PRACTICE, "Generate practice"),
        (SUMMARY, "Weekly summary"),
    ]

    AGREED, DISAGREED, UNREVIEWED = "agreed", "disagreed", "unreviewed"
    VERDICT = [
        (AGREED, "Mentor agreed"),
        (DISAGREED, "Mentor disagreed"),
        (UNREVIEWED, "Not yet reviewed"),
    ]

    task = models.CharField(max_length=32, choices=TASK)
    student = models.ForeignKey(
        "tenancy.Student", null=True, blank=True,
        on_delete=models.CASCADE, related_name="reasoning_traces",
    )

    # The exact de-identified payload sent. Stored verbatim: a trace whose
    # input you cannot reproduce is not a training example, it is an anecdote.
    context = models.JSONField()
    context_hash = models.CharField(max_length=64, db_index=True)

    model = models.CharField(max_length=64)              # "gemini-2.5-flash"
    prompt_version = models.CharField(max_length=16)     # "diagnose-v1"

    output = models.JSONField(null=True, blank=True)
    reasoning = models.TextField(blank=True)
    error = models.TextField(blank=True)

    latency_ms = models.IntegerField(null=True, blank=True)
    input_tokens = models.IntegerField(null=True, blank=True)
    output_tokens = models.IntegerField(null=True, blank=True)

    human_verdict = models.CharField(
        max_length=12, choices=VERDICT, default=UNREVIEWED,
        help_text="What turns a model guess into a training label.",
    )
    human_note = models.TextField(blank=True)
    reviewed_by = models.ForeignKey(
        "tenancy.Mentor", null=True, blank=True, on_delete=models.SET_NULL
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["task", "context_hash"], name="idx_trace_cache"),
            models.Index(fields=["institute", "task", "-created_at"], name="idx_trace_recent"),
            models.Index(fields=["human_verdict"], name="idx_trace_verdict"),
        ]

    def __str__(self) -> str:
        who = self.student.name if self.student else "—"
        return f"{self.task} · {who} · {self.created_at:%d %b}"

    @property
    def succeeded(self) -> bool:
        return self.output is not None and not self.error

    @staticmethod
    def hash_context(context: dict) -> str:
        """Stable hash of the payload — sorted keys, so ordering never
        produces a spurious cache miss."""
        blob = json.dumps(context, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(blob.encode()).hexdigest()
