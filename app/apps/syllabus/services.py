"""Which syllabus a student is taught against, and which chapters it holds.

Three callers need exactly one answer to "what may this student log study
time against": the picker that lists the chapters, the study-log write that
validates the chosen one, and the confidence-rating write. If each worked it
out for itself they would drift, and the failure is quiet — a picker offering
a chapter the write then refuses, or the reverse.

SUBJECTS COME FROM THE TREE, NOT FROM A LIST
    "Physics, Chemistry, Maths" used to be typed into three modules. That is
    JEE's answer and nobody else's: a NEET batch is Physics, Chemistry,
    Botany and Zoology, and against the typed list its Biology was simply
    invisible — no row on the neglect chart, no `subject_imbalance` flag, a
    mock total missing half the paper. The subject nodes of the syllabus
    tree (`Topic.kind == subject`, in `position` order) are the only list,
    and `subjects_for_student` / `subjects_by_batch` are how every per-subject
    read model gets it.
"""

from __future__ import annotations

from collections.abc import Iterable

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


# ------------------------------------------------------------------ subjects


def _unique(names: Iterable[str]) -> list[str]:
    """First occurrence wins, order kept. A tree should not repeat a subject
    name, but a duplicate must not become two rows on a chart."""
    return list(dict.fromkeys(n for n in names if n))


def subject_names(syllabus: SyllabusVersion | int | None) -> list[str]:
    """The subjects of one syllabus version, in teaching (`position`) order.

    JEE Main's tree gives `["Physics", "Chemistry", "Maths"]` (the official
    2026 one says "Mathematics" first, because NTA's document does); NEET's
    gives `["Physics", "Chemistry", "Botany", "Zoology"]` — Biology is filed
    under its paper sections by `load_official_syllabus`, and those sections
    are the subject nodes.
    """
    if syllabus is None:
        return []
    syllabus_id = syllabus if isinstance(syllabus, int) else syllabus.pk
    return _unique(
        Topic.objects.filter(syllabus_id=syllabus_id, kind=Topic.SUBJECT)
        .order_by("position", "name")
        .values_list("name", flat=True)
    )


def subjects_for_student(student) -> list[str]:
    """The subjects this student is taught, in syllabus order. Empty if none."""
    return subject_names(syllabus_for_student(student)) if student is not None else []


def subjects_by_batch(institute_id: int, batch_ids: Iterable[int]) -> dict[int, list[str]]:
    """`subjects_for_student`, for every student of many batches, in three queries.

    The detector run reads a whole institute at once and must not ask once
    per student. The resolution is the same as `syllabus_for_student`'s:
    the batch's pinned syllabus, else the institute's newest active version
    for the batch's exam. A batch with neither maps to an empty list.
    """
    from apps.tenancy.models import Batch

    batches = list(
        Batch.objects.filter(institute_id=institute_id, id__in=list(batch_ids))
        .values_list("id", "syllabus_id", "exam_id")
    )
    active: dict[int, int] = {}
    for version_id, exam_id in (
        SyllabusVersion.objects.filter(institute_id=institute_id, is_active=True)
        .order_by("exam_id", "-version")
        .values_list("id", "exam_id")
    ):
        active.setdefault(exam_id, version_id)        # newest active per exam

    syllabus_of = {
        batch_id: syllabus_id or active.get(exam_id)
        for batch_id, syllabus_id, exam_id in batches
    }
    names: dict[int, list[str]] = {}
    for syllabus_id, name in (
        Topic.objects.filter(
            syllabus_id__in={s for s in syllabus_of.values() if s}, kind=Topic.SUBJECT
        )
        .order_by("syllabus_id", "position", "name")
        .values_list("syllabus_id", "name")
    ):
        names.setdefault(syllabus_id, []).append(name)
    return {
        batch_id: _unique(names.get(syllabus_id, [])) if syllabus_id else []
        for batch_id, syllabus_id in syllabus_of.items()
    }


def subject_order(syllabus_subjects: Iterable[str], seen: Iterable[str]) -> list[str]:
    """The syllabus's subjects in order, then any other subject the data names.

    The extras exist for one real case — a student who changed batch, so has
    history under a subject their current syllabus lacks — and they are
    appended alphabetically rather than dropped. Dropping them is what the
    hard-coded list used to do, and it is how a mock total came to be missing
    marks without anything on screen saying so.
    """
    ordered = _unique(syllabus_subjects)
    known = set(ordered)
    return ordered + sorted({s for s in seen if s and s not in known})
