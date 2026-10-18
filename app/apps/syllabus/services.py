"""Which syllabus a student is taught against, and which chapters it holds.

Three callers need exactly one answer to "what may this student log study
time against": the picker that lists the chapters, the study-log write that
validates the chosen one, and the confidence-rating write. If each worked it
out for itself they would drift, and the failure is quiet — a picker offering
a chapter the write then refuses, or the reverse.
"""

from __future__ import annotations

from .models import SyllabusVersion, Topic


def syllabus_for_student(student) -> SyllabusVersion | None:
    """The syllabus version this student's batch follows.

    `Batch.syllabus` is nullable. A batch without one falls back to the
    institute's newest *active* version for the batch's exam — the version
    a new batch would be given — rather than to nothing, because "no
    syllabus pinned" is a gap in setup, not a statement that the student
    has no chapters. Returns None only when the institute has no active
    version for that exam at all.
    """
    batch = student.batch
    if batch.syllabus_id:
        return batch.syllabus
    return (
        SyllabusVersion.objects.filter(
            institute_id=student.institute_id, exam_id=batch.exam_id, is_active=True
        )
        .order_by("-version")
        .first()
    )


def chapters_for_student(student):
    """Chapters of the student's syllabus, in teaching order.

    Chapters only. Study time and confidence are recorded at chapter grain —
    `TopicState`, the detectors and the planner all key on it — so a log
    against a subject or a unit node would be a row nothing downstream can
    place. Ordered subject → unit → chapter by each level's `position`;
    `Topic.Meta.ordering` is only meaningful within one parent, so it cannot
    sort a flat list.
    """
    syllabus = syllabus_for_student(student)
    if syllabus is None:
        return Topic.objects.none()
    return (
        Topic.objects.filter(syllabus=syllabus, kind=Topic.CHAPTER)
        .select_related("parent__parent")
        .order_by("parent__parent__position", "parent__position", "position", "name")
    )
