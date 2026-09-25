"""Factories — build a student with a precise attempt history in a few lines.

    cohort  = build_cohort()
    aarav   = make_student(cohort, "Aarav Mehta")
    record(aarav, cohort.chapter("Thermodynamics"), "wwwwwccc", ts=AS_OF)

WHY THE HELPERS AND NOT JUST `AttemptFactory.create_batch()`
    Every test in `test_detectors.py` is of the form "this exact event
    stream must produce this exact flag". That is only readable if the
    event stream is one line per (student, topic), so the helpers below
    take a status *pattern* — `"ccwwbn"` — and expand it. A test that
    needs a different history changes one string.

THE ONE THING WORTH KNOWING ABOUT TIMESTAMPS
    `record()` writes every attempt in a pattern at the *same* timestamp
    by default, spaced only by `id`. That is deliberate and it is also
    what the real seeder does: a mock paper is written at one moment.

    It matters because `features._decayed_accuracy` anchors its decay to
    the newest attempt in the window, so a same-timestamp pattern has
    every weight equal to 1 and

        mastery == correct / attempted

    exactly. The detector tests can then assert on the *rule* rather than
    on the decay curve. `record_spaced()` is the opposite tool, for the
    one test that is specifically about recency weighting.
"""

from __future__ import annotations

import dataclasses
import datetime as dt

import factory
from django.contrib.auth.hashers import make_password
from django.utils import timezone
from factory.django import DjangoModelFactory

from apps.derived.models import Flag, PlanBlock
from apps.events.models import (
    Attempt,
    ChapterStatus,
    ConfidenceRating,
    RevisionEvent,
    StudyLog,
)
from apps.ingestion.models import TestPaper
from apps.syllabus.models import Exam, SyllabusVersion, Topic
from apps.tenancy.models import Batch, Institute, Mentor, Student, User

#: A fixed "now" for every test that does not freeze the clock itself.
#: Everything date-relative in the feature store and the detectors reads an
#: `as_of` argument, so pinning it here makes the whole suite deterministic.
AS_OF = timezone.make_aware(dt.datetime(2026, 9, 20, 9, 0))

#: Status codes for the pattern strings.
CODES = {
    "c": Attempt.CORRECT,
    "w": Attempt.WRONG,
    "b": Attempt.BLANK,
    "n": Attempt.NOT_REACHED,
}

#: Three subjects, two units each, two chapters per unit. Depth is exactly
#: three because `Topic.KIND` enforces it (SYSTEM_DESIGN 8 Q1).
SUBJECT_TREE = {
    "Physics": {
        "Mechanics": ["Kinematics", "Laws of Motion"],
        "Electrodynamics": ["Current Electricity", "Magnetism"],
    },
    "Chemistry": {
        "Organic Chemistry": ["Hydrocarbons", "Aldehydes and Ketones"],
        "Physical Chemistry": ["Thermodynamics", "Chemical Equilibrium"],
    },
    "Maths": {
        "Calculus": ["Limits", "Definite Integration"],
        "Algebra": ["Quadratic Equations", "Matrices"],
    },
}


# ------------------------------------------------------------- factories


class ExamFactory(DjangoModelFactory):
    class Meta:
        model = Exam
        django_get_or_create = ("code",)

    code = "JEE_MAIN"
    name = "JEE Main"
    marks_correct = 4
    marks_wrong = -1
    total_marks = 300


class InstituteFactory(DjangoModelFactory):
    class Meta:
        model = Institute
        django_get_or_create = ("slug",)

    name = factory.Sequence(lambda n: f"Institute {n}")
    city = "Kota"
    slug = factory.Sequence(lambda n: f"institute-{n}")


class SyllabusVersionFactory(DjangoModelFactory):
    class Meta:
        model = SyllabusVersion

    institute = factory.SubFactory(InstituteFactory)
    exam = factory.SubFactory(ExamFactory)
    version = 1
    is_active = True


class TopicFactory(DjangoModelFactory):
    class Meta:
        model = Topic

    syllabus = factory.SubFactory(SyllabusVersionFactory)
    parent = None
    name = factory.Sequence(lambda n: f"Topic {n}")
    kind = Topic.CHAPTER
    weight = 1.0


class UserFactory(DjangoModelFactory):
    class Meta:
        model = User
        django_get_or_create = ("username",)

    username = factory.Sequence(lambda n: f"user{n}")
    password = factory.LazyFunction(lambda: make_password("pw-for-tests"))
    is_active = True


class BatchFactory(DjangoModelFactory):
    class Meta:
        model = Batch

    institute = factory.SubFactory(InstituteFactory)
    exam = factory.SubFactory(ExamFactory)
    name = "Alpha"
    year = 2027
    exam_date = dt.date(2027, 4, 4)


class MentorFactory(DjangoModelFactory):
    class Meta:
        model = Mentor

    institute = factory.SubFactory(InstituteFactory)
    name = factory.Sequence(lambda n: f"Mentor {n}")
    email = factory.LazyAttribute(lambda o: f"{o.name.lower().replace(' ', '.')}@example.com")


class StudentFactory(DjangoModelFactory):
    class Meta:
        model = Student

    institute = factory.SubFactory(InstituteFactory)
    batch = factory.SubFactory(BatchFactory)
    name = factory.Sequence(lambda n: f"Student {n}")
    roll_no = factory.Sequence(lambda n: f"R{n:04d}")
    joined_at = dt.date(2026, 4, 1)


class TestPaperFactory(DjangoModelFactory):
    class Meta:
        model = TestPaper

    institute = factory.SubFactory(InstituteFactory)
    exam = factory.SubFactory(ExamFactory)
    name = factory.Sequence(lambda n: f"Mock {n}")
    held_on = dt.date(2026, 8, 1)
    total_questions = 75
    max_marks = 300
    marks_correct = 4
    marks_wrong = -1


class FlagFactory(DjangoModelFactory):
    class Meta:
        model = Flag

    institute = factory.LazyAttribute(lambda o: o.student.institute)
    student = factory.SubFactory(StudentFactory)
    type = "weak_topic"
    severity = Flag.HIGH
    headline = "Something is wrong"
    evidence = factory.LazyFunction(dict)
    raised_at = AS_OF


class PlanBlockFactory(DjangoModelFactory):
    class Meta:
        model = PlanBlock

    institute = factory.LazyAttribute(lambda o: o.student.institute)
    student = factory.SubFactory(StudentFactory)
    date = factory.LazyFunction(timezone.localdate)
    minutes = 45
    mode = "practice"
    reason_code = "weak_topic"
    reason_text = "Costing the most marks"


# ------------------------------------------------------------- the cohort


@dataclasses.dataclass
class Cohort:
    """One institute, wired end to end: exam, syllabus tree, batch, mentor."""

    institute: Institute
    exam: Exam
    syllabus: SyllabusVersion
    batch: Batch
    mentor: Mentor
    subjects: dict[str, Topic]
    units: dict[str, Topic]
    chapters: dict[str, Topic]

    def chapter(self, name: str) -> Topic:
        return self.chapters[name]

    def chapters_of(self, subject: str) -> list[Topic]:
        """Every chapter under one subject, in tree order."""
        out = []
        for chapter_names in SUBJECT_TREE[subject].values():
            out.extend(self.chapters[c] for c in chapter_names)
        return out


def build_cohort(*, name: str | None = None, slug: str | None = None) -> Cohort:
    """An institute with a full three-level syllabus and one batch."""
    kwargs = {}
    if name:
        kwargs["name"] = name
    if slug:
        kwargs["slug"] = slug
    institute = InstituteFactory(**kwargs)
    exam = ExamFactory()
    syllabus = SyllabusVersionFactory(institute=institute, exam=exam)

    subjects: dict[str, Topic] = {}
    units: dict[str, Topic] = {}
    chapters: dict[str, Topic] = {}
    for s_pos, (subject_name, unit_map) in enumerate(SUBJECT_TREE.items()):
        subject = TopicFactory(
            syllabus=syllabus, parent=None, name=subject_name,
            kind=Topic.SUBJECT, position=s_pos,
        )
        subjects[subject_name] = subject
        for u_pos, (unit_name, chapter_names) in enumerate(unit_map.items()):
            unit = TopicFactory(
                syllabus=syllabus, parent=subject, name=unit_name,
                kind=Topic.UNIT, position=u_pos,
            )
            units[unit_name] = unit
            for c_pos, chapter_name in enumerate(chapter_names):
                chapters[chapter_name] = TopicFactory(
                    syllabus=syllabus, parent=unit, name=chapter_name,
                    kind=Topic.CHAPTER, position=c_pos, weight=4.0,
                )

    batch = BatchFactory(institute=institute, exam=exam, syllabus=syllabus)
    mentor = MentorFactory(institute=institute)
    return Cohort(
        institute=institute, exam=exam, syllabus=syllabus, batch=batch,
        mentor=mentor, subjects=subjects, units=units, chapters=chapters,
    )


def make_student(cohort: Cohort, name: str = "Test Student", **kwargs) -> Student:
    return StudentFactory(
        institute=cohort.institute, batch=cohort.batch, mentor=cohort.mentor,
        name=name, **kwargs,
    )


def make_paper(cohort: Cohort, name: str, held_on: dt.date, **kwargs) -> TestPaper:
    return TestPaperFactory(
        institute=cohort.institute, exam=cohort.exam, name=name, held_on=held_on,
        **kwargs,
    )


def make_mentor_user(cohort: Cohort, username: str = "mentor1", password: str = "pw-for-tests"):
    user = UserFactory(username=username, password=make_password(password))
    cohort.mentor.user = user
    cohort.mentor.save(update_fields=["user"])
    return user


def make_student_user(student: Student, username: str = "student1", password: str = "pw-for-tests"):
    user = UserFactory(username=username, password=make_password(password))
    student.user = user
    student.save(update_fields=["user"])
    return user


# ------------------------------------------------------------ event data


def _marks_for(status: str, paper: TestPaper | None) -> float:
    correct = paper.marks_correct if paper else 4
    wrong = paper.marks_wrong if paper else -1
    if status == Attempt.CORRECT:
        return float(correct)
    if status == Attempt.WRONG:
        return float(wrong)
    return 0.0


def record(
    student: Student,
    topic: Topic,
    pattern: str,
    *,
    ts: dt.datetime = AS_OF,
    paper: TestPaper | None = None,
    time_spent: int | None = None,
    source: str | None = None,
    question_prefix: str = "Q",
) -> list[Attempt]:
    """Write one attempt per character of `pattern` at a single timestamp.

    `pattern` uses `c` correct, `w` wrong, `b` blank, `n` not reached.
    Marks follow the paper's scheme (or +4/-1/0 when there is no paper),
    so `score` and `marks lost` stay arithmetically consistent -- which is
    what `test_marks_lost.py` asserts must hold.
    """
    rows = [
        Attempt(
            institute_id=student.institute_id,
            student=student,
            topic=topic,
            test_paper=paper,
            question_id=f"{question_prefix}{i + 1}",
            status=CODES[ch],
            time_spent=time_spent,
            marks=_marks_for(CODES[ch], paper),
            source=source or (Attempt.MOCK if paper else Attempt.PRACTICE),
            ts=ts,
        )
        for i, ch in enumerate(pattern)
    ]
    return Attempt.objects.bulk_create(rows)


def record_spaced(
    student: Student,
    topic: Topic,
    pattern: str,
    *,
    newest_ts: dt.datetime = AS_OF,
    step_days: int = 30,
    paper: TestPaper | None = None,
) -> list[Attempt]:
    """Same as `record`, but oldest-first with `step_days` between attempts.

    The last character of `pattern` is the newest attempt. Used only by the
    recency test, where the decay weighting is the thing under test.
    """
    n = len(pattern)
    rows = [
        Attempt(
            institute_id=student.institute_id,
            student=student,
            topic=topic,
            test_paper=paper,
            question_id=f"S{i + 1}",
            status=CODES[ch],
            marks=_marks_for(CODES[ch], paper),
            source=Attempt.PRACTICE,
            ts=newest_ts - dt.timedelta(days=step_days * (n - 1 - i)),
        )
        for i, ch in enumerate(pattern)
    ]
    return Attempt.objects.bulk_create(rows)


def teach(cohort: Cohort, *topics: Topic, on: dt.date = dt.date(2026, 5, 1)) -> None:
    """Mark chapters as taught to the batch. `weak_topic` is gated on this."""
    ChapterStatus.objects.bulk_create(
        [
            ChapterStatus(
                institute_id=cohort.institute.id,
                batch=cohort.batch,
                topic=topic,
                taught_at=on,
            )
            for topic in topics
        ]
    )


def teach_everything(cohort: Cohort, on: dt.date = dt.date(2026, 5, 1)) -> None:
    teach(cohort, *cohort.chapters.values(), on=on)


def study(
    student: Student,
    topic: Topic,
    minutes: int,
    ts: dt.datetime,
    mode: str = StudyLog.PRACTICE,
) -> StudyLog:
    return StudyLog.objects.create(
        institute_id=student.institute_id, student=student, topic=topic,
        minutes=minutes, mode=mode, ts=ts,
    )


def study_daily(
    student: Student,
    per_topic: dict[Topic, int],
    *,
    days: int,
    ending: dt.datetime = AS_OF,
) -> None:
    """`days` consecutive logged days, the same minutes split every day.

    Detectors that need "this student actually studies" -- plateau,
    subject_imbalance, disengagement, overload -- all count *distinct
    logged days*, so the day count is the thing tests dial.
    """
    rows = []
    for d in range(days):
        ts = ending - dt.timedelta(days=d)
        for topic, minutes in per_topic.items():
            rows.append(
                StudyLog(
                    institute_id=student.institute_id, student=student, topic=topic,
                    minutes=minutes, mode=StudyLog.PRACTICE, ts=ts,
                )
            )
    StudyLog.objects.bulk_create(rows)


def rate(student: Student, topic: Topic, value: int, ts: dt.datetime = AS_OF):
    return ConfidenceRating.objects.create(
        institute_id=student.institute_id, student=student, topic=topic,
        self_rating=value, ts=ts,
    )


def revision(
    student: Student,
    topic: Topic,
    cycle: int,
    scheduled_for: dt.date,
    done_at: dt.datetime | None = None,
):
    return RevisionEvent.objects.create(
        institute_id=student.institute_id, student=student, topic=topic,
        cycle=cycle, scheduled_for=scheduled_for, done_at=done_at,
    )
