"""A person's answer to an answer-key disagreement.

The question factory solves every official question blind and compares the
model's answer with NTA's key (`factory/check.py`). Where they differ the
question loads as `verification = "disagreed"` — "a reason to look, not a
reason to doubt the key" — and, until this module, nothing but the admin
filter could act on it. On the dev data that is 32 questions (9 JEE, 23
NEET), every one unreviewed.

WHAT A DECISION CHANGES
    The decision is recorded on the question (`key_review`, `key_review_note`,
    `key_reviewed_by`, `key_reviewed_at`), appended to
    `verification_detail["key_reviews"]` so a revised decision keeps its
    history, and it moves `verification` — the question's state of trust in
    its key — out of `disagreed`:

    key_stands  → `key_stands`. The official key was right; the model (or its
                  reading of a figure) was wrong. The key is trusted, like an
                  `agreed` one. Nothing about marking changes, because marking
                  always used the official key.
    key_wrong   → `key_wrong`. The key *as we hold it* is wrong — usually our
                  transcription (options read out of order), conceivably the
                  key itself. The question is untrusted: its distractors can
                  no longer be tagged (`tagging.py`), and anything that marks
                  or diagnoses against it should skip it (`key_trusted`).
                  There is no re-marking step; correcting the stored key is a
                  factory re-load, after which it can be reviewed again.
    unclear     → `key_unclear`. Reviewed, not settled — it needs a subject
                  expert. Still untrusted, and no longer counted as
                  *unreviewed*, so the queue shows real progress.

    In every case the question leaves the `disagreed` state, which is what
    the admin's review filter, `pilot_check`'s count and the `unreviewed`
    filter here all read. A decision can be replaced by a later one.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.ingestion.models import QuestionTopicMap

#: Cut-offs for the parts of `verification_detail` a listing shows. The full
#: record stays in the database and the admin.
SUMMARY_CHARS = 400
WORKING_CHARS = 1500


def disagreements(institute_id: int | None):
    """Every question of this institute the cross-check disagreed on, reviewed or not."""
    if not institute_id:
        return QuestionTopicMap.objects.none()
    return QuestionTopicMap.objects.filter(
        institute_id=institute_id, verification__in=QuestionTopicMap.DISAGREEMENT_STATES
    )


def unreviewed_count(institute_id: int | None = None) -> int:
    """Disagreements nobody has decided yet — across every institute when unscoped."""
    qs = QuestionTopicMap.objects.filter(verification=QuestionTopicMap.DISAGREED)
    if institute_id:
        qs = qs.filter(institute_id=institute_id)
    return qs.count()


def review_status(question: QuestionTopicMap) -> str:
    return question.key_review or "unreviewed"


def _clip(text, limit: int) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def summarise_detail(question: QuestionTopicMap) -> str:
    """`verification_detail` in one paragraph a reviewer can read at a glance.

    The agent's first look, where there is one, is labelled as exactly that:
    it was written by the agent that ran the factory and is not a review.
    """
    detail = question.verification_detail or {}
    parts = []
    answer = question.model_answer or "no answer"
    confidence = detail.get("model_confidence")
    parts.append(
        f"Model answered {answer}"
        + (f" ({confidence} confidence)" if confidence else "")
        + f"; official key {question.official_answer or '—'}."
    )
    if detail.get("model_issue"):
        parts.append(f"Model's note: {_clip(detail['model_issue'], 160)}.")
    issues = [i for i in (detail.get("read_issues") or []) if i]
    if issues:
        parts.append(f"Transcription issues: {_clip('; '.join(map(str, issues)), 160)}.")
    if detail.get("legibility") and detail["legibility"] not in ("clear", "good"):
        parts.append(f"Legibility: {detail['legibility']}.")
    if question.has_diagram:
        parts.append("Has a figure.")
    agent = detail.get("agent_review")
    if agent:
        if isinstance(agent, dict):
            agent = agent.get("note") or agent.get("verdict") or agent.get("summary") or agent
        parts.append(f"Agent's first look (not a human review): {_clip(agent, 160)}")
    return _clip(" ".join(parts), SUMMARY_CHARS)


def model_working(question: QuestionTopicMap) -> str:
    return _clip((question.verification_detail or {}).get("model_working", ""), WORKING_CHARS)


@transaction.atomic
def record_review(question: QuestionTopicMap, *, decision: str, note: str, user) -> QuestionTopicMap:
    """Record a decision on a disagreement. The caller has checked it is one."""
    question = QuestionTopicMap.objects.select_for_update().get(pk=question.pk)
    now = timezone.now()
    detail = dict(question.verification_detail or {})
    history = list(detail.get("key_reviews") or [])
    history.append({
        "decision": decision,
        "note": note,
        "by_user": getattr(user, "id", None),
        "by": getattr(user, "get_username", lambda: "")(),
        "at": now.isoformat(),
        "verification_before": question.verification,
    })
    detail["key_reviews"] = history

    question.key_review = decision
    question.key_review_note = note
    question.key_reviewed_by = user
    question.key_reviewed_at = now
    question.verification = QuestionTopicMap.VERIFICATION_FOR_REVIEW[decision]
    question.verification_detail = detail
    question.save(update_fields=[
        "key_review", "key_review_note", "key_reviewed_by", "key_reviewed_at",
        "verification", "verification_detail",
    ])
    return question
