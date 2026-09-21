"""Event-layer services.

Read-mostly analysis over the append-only event tables. Nothing in here
writes to `Attempt`, `StudyLog`, `ConfidenceRating` or `RevisionEvent` —
those are append-only by invariant, and a correction arrives as a new row
rather than an UPDATE (see `apps/events/models.py`).
"""
