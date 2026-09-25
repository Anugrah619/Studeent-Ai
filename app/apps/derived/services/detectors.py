"""The detector engine — typed, evidenced, versioned flags.

    from apps.derived.services.detectors import REGISTRY, run_detectors

Each detector is a class with one method:

    evaluate(student: StudentFacts) -> Flag | None

It returns an **unsaved** `Flag` carrying `type`, `severity`, `headline`,
`evidence` and `rule_version`, or None. Persisting, cooldown and the
transaction belong to `run_detectors`, not to the detector — a detector
that decides whether to write is a detector you cannot dry-run, and
dry-running is how you tune one.

WHY `StudentFacts` AND NOT `Student`
    A detector that queries is a detector that queries once per student
    per detector: eight detectors over three hundred students is 2,400
    round trips for a nightly job that should be a dozen. `CohortFacts`
    runs those dozen queries per institute and hands each detector a
    plain dataclass. `StudentFacts.student` is the ORM object when one is
    genuinely needed.

ALERT HYGIENE — the three rules, and why all three
    TECHNICAL_DOC.md §6.4 is blunt about this: without all three, mentors
    stop reading by week three. A console nobody opens is worth exactly
    nothing, however good the detection is.

    1. MINIMUM EVIDENCE. Every detector declares `min_evidence` in prose
       and enforces it in code. No flag fires on three data points.

    2. PERSONAL BASELINE. Comparison is against the student's own history,
       never the cohort. A cohort baseline flags the bottom of every class
       forever — which is a ranking, not a detection, and mentors already
       have a ranking. Each detector below names its baseline explicitly.

    3. COOLDOWN. One flag per type per student per window, enforced in
       `run_detectors` against `Flag.raised_at`, plus an absolute bar on
       re-raising a type that already has an open flag. This is also what
       makes `run_detectors` safe to run every night: the second run of
       the same day writes nothing.

    A fourth rule, from the same section: a flag that is never closed is a
    bug in the detector. Nothing here raises a flag whose evidence a
    mentor could not act on and then resolve.

NO LLM HERE
    Every number in every `evidence` dict comes from arithmetic over the
    feature store. Gemini's job is to read these dicts and write sentences
    about them — `headline` is the deterministic fallback for when it is
    unavailable, which is why each one already reads like English.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import logging
import statistics
from collections import defaultdict

from django.db import transaction
from django.utils import timezone

from apps.derived.models import Flag, StudentState, TopicState
from apps.derived.services.features import (
    LOAD_WINDOW_DAYS,
    marking_scheme,
    marks_lost_by_subject,
    marks_lost_by_topic,
    paper_totals,
    study_intensity,
    study_minutes_by_day,
    study_minutes_by_subject,
    subject_map,
    unit_map,
)
from apps.events.models import Attempt, ChapterStatus, RevisionEvent
from apps.ingestion.models import TestPaper
from apps.syllabus.models import Topic
from apps.tenancy.models import Student

logger = logging.getLogger(__name__)

#: Default window for rule 3. One flag of a type per student per fortnight.
#: A fortnight because that is the mock cadence: flagging the same student
#: for the same thing between two mocks tells a mentor nothing they did not
#: know when they read it the first time.
DEFAULT_COOLDOWN_DAYS = 14

SUBJECTS = ["Physics", "Chemistry", "Maths"]


# ===================================================================== facts


@dataclasses.dataclass
class PaperRow:
    held_on: dt.date
    paper_id: int
    name: str
    marks: float
    attempted: int
    correct: int
    questions: int
    max_marks: int

    @property
    def accuracy(self) -> float | None:
        return self.correct / self.attempted if self.attempted else None

    @property
    def attempt_rate(self) -> float | None:
        return self.attempted / self.questions if self.questions else None


@dataclasses.dataclass
class StudentFacts:
    """Everything the detectors read about one student. No queries inside."""

    student: Student
    as_of: dt.datetime
    today: dt.date
    state: StudentState | None
    topic_states: list[TopicState]
    papers: list[PaperRow]  # oldest first
    day_minutes: dict[dt.date, int]
    taught_topics: set[int]
    revisions: list[tuple[dt.date, bool]]  # (scheduled_for, done)
    subjects: dict[int, str]
    units: dict[int, str]
    topic_names: dict[int, str]
    topic_weights: dict[int, float]

    # ------------------------------------------------------------ helpers

    @property
    def id(self) -> int:
        return self.student.id

    @property
    def name(self) -> str:
        return self.student.name

    def evidenced_states(self, min_attempts: int = 1) -> list[TopicState]:
        return [
            ts
            for ts in self.topic_states
            if ts.mastery is not None and ts.attempts_n >= min_attempts
        ]

    def personal_median_mastery(self) -> float | None:
        values = [ts.mastery for ts in self.topic_states if ts.mastery is not None]
        return statistics.median(values) if len(values) >= 5 else None

    def subject_of(self, topic_id: int) -> str:
        return self.subjects.get(topic_id, "?")

    def unit_of(self, topic_id: int) -> str:
        return self.units.get(topic_id, "?")

    def logged_days(self, since: dt.date) -> int:
        return sum(1 for d in self.day_minutes if d > since)

    def minutes_since(self, since: dt.date) -> int:
        return sum(m for d, m in self.day_minutes.items() if d > since)

    def last_log_day(self) -> dt.date | None:
        return max(self.day_minutes) if self.day_minutes else None

    def mastery_by_topic(self) -> dict[int, float]:
        return {
            ts.topic_id: ts.mastery
            for ts in self.topic_states
            if ts.mastery is not None
        }


class CohortFacts:
    """One pass of queries per institute; `for_student()` slices it.

    Built once per `run_detectors` call and shared by every detector, which
    is what keeps a nightly run over 300 students at roughly a dozen
    queries rather than a few thousand.
    """

    def __init__(self, institute_id: int, student_ids: list[int], as_of: dt.datetime):
        self.institute_id = institute_id
        self.as_of = as_of
        self.today = timezone.localtime(as_of).date()
        self.ids = student_ids

        self.students = {
            s.id: s
            for s in Student.objects.filter(
                institute_id=institute_id, id__in=student_ids
            ).select_related("batch", "mentor")
        }
        self.states = {
            st.student_id: st
            for st in StudentState.objects.filter(
                institute_id=institute_id, student_id__in=student_ids
            )
        }

        self.subjects = subject_map(institute_id)
        self.units = unit_map(institute_id)
        topics = dict(
            Topic.objects.filter(syllabus__institute_id=institute_id).values_list(
                "id", "name"
            )
        )
        self.topic_names = topics
        self.topic_weights = dict(
            Topic.objects.filter(syllabus__institute_id=institute_id).values_list(
                "id", "weight"
            )
        )

        self._topic_states: dict[int, list[TopicState]] = defaultdict(list)
        for ts in TopicState.objects.filter(
            institute_id=institute_id, student_id__in=student_ids
        ):
            self._topic_states[ts.student_id].append(ts)

        papers_meta = {
            p["id"]: p
            for p in TestPaper.objects.filter(institute_id=institute_id).values(
                "id", "name", "max_marks", "marks_correct", "marks_wrong"
            )
        }
        self.papers_meta = papers_meta
        self._papers: dict[int, list[PaperRow]] = defaultdict(list)
        for sid, rows in paper_totals(institute_id, student_ids).items():
            for held_on, paper_id, marks, attempted, correct, total_q in rows:
                meta = papers_meta.get(paper_id, {})
                self._papers[sid].append(
                    PaperRow(
                        held_on=held_on,
                        paper_id=paper_id,
                        name=meta.get("name", f"Paper {paper_id}"),
                        marks=marks,
                        attempted=attempted,
                        correct=correct,
                        questions=total_q,
                        max_marks=meta.get("max_marks") or 300,
                    )
                )

        self._days = study_minutes_by_day(
            institute_id, student_ids, as_of - dt.timedelta(days=120)
        )

        self.scheme = marking_scheme(institute_id)
        self.lost_by_topic = marks_lost_by_topic(institute_id, student_ids, self.scheme)
        self.lost_by_subject = marks_lost_by_subject(self.lost_by_topic, self.subjects)
        self.time_by_subject = study_minutes_by_subject(
            institute_id, student_ids, self.subjects
        )

        # Chapters the student's *batch* has been taught. `weak_topic` is
        # gated on this: a student cannot be behind on a chapter nobody has
        # taught yet, and flagging them for it destroys mentor trust faster
        # than any false positive on a chapter that was taught.
        taught_by_batch: dict[int, set[int]] = defaultdict(set)
        for batch_id, topic_id in ChapterStatus.objects.filter(
            institute_id=institute_id, taught_at__isnull=False
        ).values_list("batch_id", "topic_id"):
            taught_by_batch[batch_id].add(topic_id)
        self._taught_by_batch = taught_by_batch

        self._revisions: dict[int, list[tuple[dt.date, bool]]] = defaultdict(list)
        for sid, sched, done in RevisionEvent.objects.filter(
            institute_id=institute_id, student_id__in=student_ids
        ).values_list("student_id", "scheduled_for", "done_at"):
            self._revisions[sid].append((sched, done is not None))

        # Per-attempt mastery bucketing for `over_attempting`. Restricted to
        # the recent papers, so this stays O(students x recent questions).
        self.recent_paper_ids = [
            p["id"]
            for p in TestPaper.objects.filter(institute_id=institute_id)
            .order_by("-held_on")
            .values("id")[:OverAttemptingDetector.PAPERS]
        ]
        self._recent_attempts: dict[int, list[tuple[int, str]]] = defaultdict(list)
        if self.recent_paper_ids:
            for sid, topic_id, status in Attempt.objects.filter(
                institute_id=institute_id,
                student_id__in=student_ids,
                test_paper_id__in=self.recent_paper_ids,
            ).values_list("student_id", "topic_id", "status"):
                self._recent_attempts[sid].append((topic_id, status))

    def for_student(self, student_id: int) -> StudentFacts:
        student = self.students[student_id]
        return StudentFacts(
            student=student,
            as_of=self.as_of,
            today=self.today,
            state=self.states.get(student_id),
            topic_states=self._topic_states.get(student_id, []),
            papers=self._papers.get(student_id, []),
            day_minutes=self._days.get(student_id, {}),
            taught_topics=self._taught_by_batch.get(student.batch_id, set()),
            revisions=self._revisions.get(student_id, []),
            subjects=self.subjects,
            units=self.units,
            topic_names=self.topic_names,
            topic_weights=self.topic_weights,
        )

    def recent_attempts(self, student_id: int) -> list[tuple[int, str]]:
        return self._recent_attempts.get(student_id, [])


# ================================================================== registry


REGISTRY: dict[str, "Detector"] = {}


def register(cls):
    """Add a detector to the registry, keyed by its `type`.

    The registry is the catalogue: `run_detectors` iterates it, the
    `--only` flag selects from it, and a detector that is not registered
    does not exist as far as the console is concerned.
    """
    instance = cls()
    if instance.type in REGISTRY:
        raise RuntimeError(f"Duplicate detector type {instance.type!r}")
    REGISTRY[instance.type] = instance
    return cls


class Detector:
    """Base class. Subclasses set the class attributes and implement
    `evaluate`."""

    #: Stored in `Flag.type`. Must match TECHNICAL_DOC.md §6.4.
    type: str = ""
    #: Stored in `Flag.rule_version`. **Bump this whenever the rule
    #: changes.** It is the entire answer to "why was this student flagged
    #: six months ago, when the rule was different" — without it, historical
    #: flags are uninterpretable and the audit trail is decorative.
    rule_version: str = "v1"
    #: 0 = works on institute-uploaded marks alone. 1 = needs student-logged
    #: data (study logs, confidence ratings, revisions). Tier 0 must be able
    #: to carry the product on day one; see TECHNICAL_DOC.md §8.
    tier: int = 0
    #: Rule 3.
    cooldown_days: int = DEFAULT_COOLDOWN_DAYS
    #: Rule 1, in prose, for the console and for anyone tuning the rule.
    min_evidence: str = ""
    #: Rule 2, in prose. What this detector compares the student against.
    baseline: str = ""

    def evaluate(self, student: StudentFacts) -> Flag | None:  # pragma: no cover
        raise NotImplementedError

    # -------------------------------------------------------------- utils

    def flag(
        self,
        student: StudentFacts,
        *,
        severity: str,
        headline: str,
        evidence: dict,
        topic_id: int | None = None,
    ) -> Flag:
        """Build the unsaved Flag. Always goes through here so that
        `rule_version` and `raised_at` cannot be forgotten."""
        evidence = dict(evidence)
        evidence.setdefault("detector", self.type)
        evidence.setdefault("rule_version", self.rule_version)
        evidence.setdefault("min_evidence", self.min_evidence)
        evidence.setdefault("baseline", self.baseline)
        return Flag(
            institute_id=student.student.institute_id,
            student=student.student,
            topic_id=topic_id,
            type=self.type,
            severity=severity,
            headline=headline[:300],
            evidence=evidence,
            rule_version=self.rule_version,
            raised_at=student.as_of,
        )


def pct(x: float | None, digits: int = 0) -> float | None:
    return None if x is None else round(x * 100, digits)


# =================================================================== tier 0


@register
class WeakTopicDetector(Detector):
    """A taught chapter the student is weak on **and that is costing marks**.

    The marks bar is the part that took a rewrite. Low mastery alone is
    nearly useless as an alert: every student has a worst chapter, so a
    mastery-only rule flags everybody, every fortnight, always at critical,
    and the console becomes a list of names. That is the week-three failure
    TECHNICAL_DOC.md §6.4 warns about, arrived at from the other direction.

    So the rule asks the question an institute actually cares about: how
    many marks is this chapter costing, and is that a disproportionate
    share of everything this student loses? A chapter at 40% that eats an
    eighth of their lost marks outranks a chapter at 0% they have seen six
    times, and severity is graded on marks at stake rather than on the
    percentage — which is also what makes the console sort usefully.

    Fires on **one** topic, never on every topic below the line;
    `also_qualifying` says how many others cleared the bar, which is the
    information the suppressed flags would have carried.

    TWO NUMBERS, TWO HORIZONS, AND WHY THE HEADLINE NOW SAYS SO (v2)
        `mastery_pct` is a 20-attempt decayed window — where the student
        is *now*. `marks_lost` is cumulative across every mock they have
        sat — what the chapter has *cost*. Both are the right horizon for
        what they measure (see `features.marks_lost_by_topic`), and the
        v1 headline put them in one sentence with neither one labelled:

            "Rotational Motion: 32% over 11 attempts, costing 42 marks"

        A mentor reads that as one period. It is a current level next to a
        career total, and the career total is the bigger, scarier number.
        So the headline now names the span — "costing 42 marks across 7
        mocks" — and the evidence carries `papers_covered`,
        `first_paper`, `last_paper` and `marks_lost_per_paper`, which is
        the per-mock figure a mentor was mentally trying to compute
        anyway. Nothing about *when the flag fires* changed; the
        thresholds are untouched.
    """

    type = "weak_topic"
    #: v2: evidence and headline state the period `marks_lost` covers. The
    #: firing rule is byte-identical to v1 — the bump is so that a v1 flag
    #: read six months from now is not mistaken for one that had been held
    #: to the labelling standard this one was.
    rule_version = "v2"
    tier = 0
    min_evidence = (
        "6+ attempted questions on the chapter, the batch has been taught it, "
        "and it is costing 24+ marks and 4%+ of everything the student loses"
    )
    baseline = (
        "the student's own median mastery, and their own total lost marks as "
        "the denominator for the share"
    )

    MASTERY_FLOOR = 0.45
    MIN_ATTEMPTS = 6
    BASELINE_MARGIN = 0.10
    #: A uniformly weak student has a low median too, so the baseline test
    #: alone would never fire for them. This is the escape hatch — but it is
    #: conditioned on the median *also* being low, so it cannot become the
    #: universal bypass that a bare "mastery < 0.30" would be.
    STRUGGLING_MEDIAN = 0.50
    HARD_FLOOR = 0.30

    MIN_MARKS_AT_STAKE = 24.0  # six questions' worth
    MIN_LOSS_SHARE = 0.04
    HIGH_MARKS, HIGH_SHARE = 30.0, 0.06
    CRITICAL_MARKS, CRITICAL_SHARE = 50.0, 0.10

    def evaluate(self, student: StudentFacts) -> Flag | None:
        lost = getattr(student, "_lost_by_topic", None) or {}
        total_lost = sum(lost.values())
        if not total_lost:
            return None
        median = student.personal_median_mastery()

        qualified = []
        for ts in student.evidenced_states(self.MIN_ATTEMPTS):
            if ts.mastery >= self.MASTERY_FLOOR:
                continue
            if ts.topic_id not in student.taught_topics:
                continue
            # Rule 2: below the floor is not enough, it has to be bad *for
            # them* — or they have to be struggling across the board.
            below_own_norm = (
                median is not None and ts.mastery <= median - self.BASELINE_MARGIN
            )
            struggling = (
                median is not None
                and median < self.STRUGGLING_MEDIAN
                and ts.mastery < self.HARD_FLOOR
            )
            if not (below_own_norm or struggling):
                continue
            marks = lost.get(ts.topic_id, 0.0)
            share = marks / total_lost
            if marks < self.MIN_MARKS_AT_STAKE or share < self.MIN_LOSS_SHARE:
                continue
            qualified.append((ts, marks, share))

        if not qualified:
            return None

        ts, marks, share = max(qualified, key=lambda q: q[1])
        if marks >= self.CRITICAL_MARKS and share >= self.CRITICAL_SHARE:
            severity = Flag.CRITICAL
        elif marks >= self.HIGH_MARKS and share >= self.HIGH_SHARE:
            severity = Flag.HIGH
        else:
            severity = Flag.WATCH

        name = student.topic_names.get(ts.topic_id, "this chapter")
        # The *period* `marks_lost` was summed over, from `paper_totals` —
        # no extra query. It is a temporal label, not a claim that every
        # mark came off a paper: `marks_lost_by_topic` also counts
        # practice attempts, which is an open question recorded in its
        # docstring and not settled here. On real data every attempt is
        # mock-sourced and the two coincide.
        papers = len(student.papers)
        evidence = {
            "topic": name,
            "topic_id": ts.topic_id,
            "unit": student.unit_of(ts.topic_id),
            "subject": student.subject_of(ts.topic_id),
            "mastery_pct": pct(ts.mastery),
            "attempts": ts.attempts_n,
            "correct": ts.correct_n,
            "marks_lost": round(marks, 1),
            # The three keys below are the label on `marks_lost`. Without
            # them it is a career total wearing a current-state sentence.
            "papers_covered": papers,
            "first_paper": student.papers[0].held_on.isoformat() if papers else None,
            "last_paper": student.papers[-1].held_on.isoformat() if papers else None,
            # Denominator is every mock sat, not only the ones this
            # chapter appeared in — the question being answered is "what
            # does this chapter drag off a typical paper", and a chapter
            # that shows up in four mocks out of seven drags nothing off
            # the other three. That is the average a mentor is planning
            # against.
            "marks_lost_per_paper": round(marks / papers, 1) if papers else None,
            "share_of_lost_marks_pct": pct(share, 1),
            "total_marks_lost": round(total_lost, 1),
            "chapter_weight": student.topic_weights.get(ts.topic_id),
            "personal_median_mastery_pct": pct(median),
            "also_qualifying": len(qualified) - 1,
            "last_seen": ts.last_seen.isoformat() if ts.last_seen else None,
        }
        # "over 11 attempts" labels the mastery figure; "across 7 mocks"
        # labels the marks figure. Both halves of the sentence now carry
        # the period they were measured over.
        span = f" across {papers} mock{'s' if papers != 1 else ''}" if papers else ""
        headline = (
            f"{name}: {pct(ts.mastery):.0f}% over {ts.attempts_n} attempts, "
            f"costing {marks:.0f} marks{span} — {pct(share):.0f}% of everything "
            f"this student loses."
        )
        return self.flag(
            student,
            severity=severity,
            headline=headline,
            evidence=evidence,
            topic_id=ts.topic_id,
        )


@register
class OverAttemptingDetector(Detector):
    """Negative marking is costing more than the extra attempts gain.

    The arithmetic is the whole flag. With +4/-1 an attempt is worth
    `4p - 1(1-p) = 5p - 1` marks, so it breaks even at p = 0.20 and is a
    straight loss below it. We do not have to guess at `p`: the feature
    store already says how well this student does on each chapter, so we
    can split their recent attempts into the ones they had grounds for and
    the ones they did not, and price both.

    That split is also the baseline. "You are attempting too much" is
    advice nobody takes. "On chapters you score 22% on you attempted 34
    questions and they cost you 14 marks; on the rest each attempt earned
    you 2.6" is advice with a number attached to it.
    """

    type = "over_attempting"
    rule_version = "v1"
    tier = 0
    min_evidence = "12+ attempts on low-mastery chapters across the last 3 papers"
    baseline = "the same student's expected value per attempt on chapters they do know"

    PAPERS = 3
    LOW_MASTERY = 0.35
    MIN_LOW_ATTEMPTS = 12
    MIN_ATTEMPT_RATE = 0.85
    EV_THRESHOLD = -0.20  # marks per attempt
    CRITICAL_EV, HIGH_EV = -0.60, -0.40

    def evaluate(self, student: StudentFacts) -> Flag | None:
        attempts = getattr(student, "_recent_attempts", None)
        if not attempts:
            return None
        papers = student.papers[-self.PAPERS :]
        if len(papers) < 2:
            return None

        rate_num = sum(p.attempted for p in papers)
        rate_den = sum(p.questions for p in papers)
        attempt_rate = rate_num / rate_den if rate_den else 0.0
        if attempt_rate < self.MIN_ATTEMPT_RATE:
            return None

        mastery = student.mastery_by_topic()
        low_n = low_correct = high_n = high_correct = 0
        for topic_id, status in attempts:
            if status not in (Attempt.CORRECT, Attempt.WRONG):
                continue
            m = mastery.get(topic_id)
            if m is None:
                continue
            if m < self.LOW_MASTERY:
                low_n += 1
                low_correct += status == Attempt.CORRECT
            else:
                high_n += 1
                high_correct += status == Attempt.CORRECT

        if low_n < self.MIN_LOW_ATTEMPTS:
            return None

        correct_marks, wrong_marks = self._scheme(student)
        low_p = low_correct / low_n
        low_ev = correct_marks * low_p + wrong_marks * (1 - low_p)
        if low_ev > self.EV_THRESHOLD:
            return None

        high_p = high_correct / high_n if high_n else None
        high_ev = (
            correct_marks * high_p + wrong_marks * (1 - high_p)
            if high_p is not None
            else None
        )
        cost = round(low_ev * low_n, 1)
        breakeven = abs(wrong_marks) / (correct_marks - wrong_marks)

        severity = (
            Flag.CRITICAL
            if low_ev <= self.CRITICAL_EV
            else Flag.HIGH
            if low_ev <= self.HIGH_EV
            else Flag.WATCH
        )
        evidence = {
            "papers": [p.name for p in papers],
            "attempt_rate_pct": pct(attempt_rate),
            "low_mastery_attempts": low_n,
            "low_mastery_accuracy_pct": pct(low_p),
            "low_mastery_ev_per_attempt": round(low_ev, 2),
            "marks_lost_to_these": cost,
            "known_topic_attempts": high_n,
            "known_topic_accuracy_pct": pct(high_p),
            "known_topic_ev_per_attempt": None if high_ev is None else round(high_ev, 2),
            "breakeven_accuracy_pct": pct(breakeven),
            "marking_scheme": f"+{correct_marks:g}/{wrong_marks:g}",
        }
        headline = (
            f"Attempting {pct(attempt_rate):.0f}% of questions. "
            f"{low_n} of them were on chapters scoring {pct(low_p):.0f}% "
            f"(break-even is {pct(breakeven):.0f}%), costing {abs(cost):.0f} marks."
        )
        return self.flag(
            student, severity=severity, headline=headline, evidence=evidence
        )

    @staticmethod
    def _scheme(student: StudentFacts) -> tuple[float, float]:
        meta = getattr(student, "_scheme", None)
        return meta or (4.0, -1.0)


@register
class PlateauDetector(Detector):
    """Flat across mocks despite real study time.

    Deliberately *not* a decline detector — a student whose marks are
    falling is a different problem with different advice, and
    `risk_score`'s decline term plus `overload` already cover it. This one
    catches the student who is working steadily and getting nowhere, which
    is the case most likely to go unnoticed: nothing is going wrong.

    Hence the two gates that are easy to leave out. Effort must be real
    (otherwise "flat" just means "not studying", which is
    `disengagement`), and the level must be low enough to be worth
    intervening on (a student parked at 78% is allowed to plateau).
    """

    type = "plateau"
    rule_version = "v1"
    tier = 0
    min_evidence = "4+ mock papers and 12+ logged study days in the last month"
    baseline = "the slope and spread of this student's own recent mock totals"

    MIN_PAPERS = 4
    WINDOW_PAPERS = 6
    FLAT_SLOPE = 1.5  # marks per paper
    FLAT_RANGE = 15.0  # marks between best and worst
    MIN_LOGGED_DAYS = 12
    MIN_MINUTES_PER_DAY = 150
    CEILING_SHARE = 0.72  # above this share of max marks, a plateau is fine
    STUCK_LOW_SHARE = 0.45

    def evaluate(self, student: StudentFacts) -> Flag | None:
        papers = student.papers[-self.WINDOW_PAPERS :]
        if len(papers) < self.MIN_PAPERS:
            return None

        marks = [p.marks for p in papers]
        slope = _slope(marks)
        spread = max(marks) - min(marks)
        if abs(slope) > self.FLAT_SLOPE or spread > self.FLAT_RANGE:
            return None

        mean_marks = sum(marks) / len(marks)
        max_marks = papers[-1].max_marks or 300
        if mean_marks / max_marks >= self.CEILING_SHARE:
            return None

        since = student.today - dt.timedelta(days=LOAD_WINDOW_DAYS)
        logged = student.logged_days(since)
        minutes = student.minutes_since(since)
        per_day = minutes / logged if logged else 0
        if logged < self.MIN_LOGGED_DAYS or per_day < self.MIN_MINUTES_PER_DAY:
            return None

        stuck_low = mean_marks / max_marks < self.STUCK_LOW_SHARE
        severity = Flag.HIGH if stuck_low else Flag.WATCH
        evidence = {
            "papers": len(papers),
            "paper_names": [p.name for p in papers],
            "marks": marks,
            "slope_marks_per_paper": round(slope, 2),
            "score_range_marks": round(spread, 1),
            "mean_marks": round(mean_marks, 1),
            "max_marks": max_marks,
            "logged_days_28d": logged,
            "minutes_per_logged_day": round(per_day),
        }
        headline = (
            f"Flat across {len(papers)} mocks — {round(mean_marks)}/{max_marks} "
            f"on average, moving {slope:+.1f} marks per paper — "
            f"on {round(per_day)} min/day over {logged} study days."
        )
        return self.flag(
            student, severity=severity, headline=headline, evidence=evidence
        )


# =================================================================== tier 1


@register
class SubjectImbalanceDetector(Detector):
    """Effort pointed at the wrong subject.

    The one-line version of the product: *Chemistry is 11% of your study
    time and 46% of your lost marks.* Both halves are measured, neither is
    a ranking against anyone else, and the fix is obvious from the numbers
    alone — which is why this flag is the one that closes.

    Marks lost are counted as **marks**, not as questions. A wrong answer
    costs the four you did not get plus the one the negative marking took;
    a blank costs only the four. Counting questions treats those as equal
    and undercounts a subject the student is guessing in by a fifth.

    This detector reads the same cumulative `marks_lost_by_topic` that
    `weak_topic` does, and needs no equivalent to that flag's v2
    relabelling: it compares two *shares* of the same student's own
    totals, and a share is a composition rather than a level, so there is
    no windowed figure beside it to be mismatched against. The evidence
    already carries `papers`, and the headline already names the mock
    count. Both halves stay as they are.
    """

    type = "subject_imbalance"
    rule_version = "v1"
    tier = 1
    min_evidence = "3+ mock papers and 14+ logged study days"
    baseline = "the student's own split of study time against their own lost marks"

    MIN_PAPERS = 3
    MIN_LOGGED_DAYS = 14
    GAP_PTS = 18.0
    CRITICAL_GAP, HIGH_GAP = 30.0, 24.0

    def evaluate(self, student: StudentFacts) -> Flag | None:
        if len(student.papers) < self.MIN_PAPERS:
            return None
        if len(student.day_minutes) < self.MIN_LOGGED_DAYS:
            return None

        time_by = getattr(student, "_time_by_subject", None) or {}
        lost_by = getattr(student, "_lost_by_subject", None) or {}
        if not time_by or not lost_by:
            return None

        t_tot = sum(time_by.values())
        l_tot = sum(lost_by.values())
        if not t_tot or not l_tot:
            return None

        rows = []
        for subject in SUBJECTS:
            time_share = time_by.get(subject, 0) / t_tot * 100
            lost_share = lost_by.get(subject, 0) / l_tot * 100
            rows.append(
                {
                    "subject": subject,
                    "time_share_pct": round(time_share, 1),
                    "marks_lost_share_pct": round(lost_share, 1),
                    "gap_pts": round(lost_share - time_share, 1),
                    "marks_lost": round(lost_by.get(subject, 0), 1),
                    "study_minutes": time_by.get(subject, 0),
                }
            )
        worst = max(rows, key=lambda r: r["gap_pts"])
        if worst["gap_pts"] < self.GAP_PTS:
            return None

        severity = (
            Flag.CRITICAL
            if worst["gap_pts"] >= self.CRITICAL_GAP
            else Flag.HIGH
            if worst["gap_pts"] >= self.HIGH_GAP
            else Flag.WATCH
        )
        weakest_unit, unit_mastery = self._weakest_unit(student, worst["subject"])
        trend = student.state.mock_trend if student.state else None

        evidence = {
            "subject": worst["subject"],
            "time_share_pct": worst["time_share_pct"],
            "marks_lost_share_pct": worst["marks_lost_share_pct"],
            "gap_pts": worst["gap_pts"],
            "marks_lost": worst["marks_lost"],
            "study_minutes": worst["study_minutes"],
            "by_subject": rows,
            "weakest_unit": weakest_unit,
            "weakest_unit_mastery_pct": pct(unit_mastery),
            "papers": len(student.papers),
            "marks_trend": trend,
        }
        lead = (
            f"Down {abs(trend):.0f} marks over {len(student.papers)} mocks. "
            if trend is not None and trend < 0
            else ""
        )
        headline = (
            f"{lead}{worst['subject']} is {worst['time_share_pct']:.0f}% of study time "
            f"but {worst['marks_lost_share_pct']:.0f}% of marks lost."
        )
        return self.flag(
            student, severity=severity, headline=headline, evidence=evidence
        )

    @staticmethod
    def _weakest_unit(student: StudentFacts, subject: str):
        by_unit = defaultdict(list)
        for ts in student.topic_states:
            if ts.mastery is None or student.subject_of(ts.topic_id) != subject:
                continue
            by_unit[student.unit_of(ts.topic_id)].append(ts.mastery)
        scored = [(u, sum(v) / len(v)) for u, v in by_unit.items() if len(v) >= 2]
        if not scored:
            return None, None
        return min(scored, key=lambda x: x[1])


@register
class ConfidenceMismatchDetector(Detector):
    """Rates a unit strong, scores weak on it — repeatedly.

    The personal baseline here is not optional decoration; without it this
    detector measures the wrong thing. Students differ enormously in how
    they use a 1-5 scale, and a generous rater will show a positive gap on
    every chapter they own. Comparing the offending unit against *that
    student's own average gap* separates "rates everything a 4" from
    "believes, specifically and wrongly, that they have Mechanics".
    """

    type = "confidence_mismatch"
    rule_version = "v1"
    tier = 1
    min_evidence = (
        "a 4+ self-rating with 5+ attempted questions, and either a second such "
        "chapter in the same unit or 10+ attempts on the one"
    )
    baseline = "the student's own mean self-rating gap across every chapter they rated"

    #: "Rates strong" means strong. A 3/5 is a student saying "about
    #: average", and treating that as overconfidence because their mastery
    #: happens to be lower produces a flag whose headline — "rates it 3/5"
    #: — argues against itself the moment a mentor reads it.
    MIN_RATING = 4
    MIN_ATTEMPTS = 5
    THOROUGH_ATTEMPTS = 10
    MIN_TOPICS = 2
    GAP = 0.30
    UNIT_MARGIN = 0.15
    CRITICAL_MASTERY = 0.35
    HIGH_GAP = 0.45
    #: The single-chapter escape hatch: maximum confidence against
    #: near-zero measured mastery. Deliberately capped at `watch`, because
    #: the evidence really is thin — but a student certain they own a
    #: chapter they have never once got right is worth one quiet line.
    CERTAIN_RATING = 5
    CERTAIN_MASTERY = 0.25

    def evaluate(self, student: StudentFacts) -> Flag | None:
        rated = [
            ts
            for ts in student.topic_states
            if ts.self_rating is not None and ts.mastery is not None
        ]
        if not rated:
            return None

        gaps = {ts.topic_id: ts.confidence_gap for ts in rated}
        personal_mean = statistics.fmean(gaps.values())

        qualifying = [
            ts
            for ts in rated
            if ts.self_rating >= self.MIN_RATING
            and ts.attempts_n >= self.MIN_ATTEMPTS
            and gaps[ts.topic_id] >= self.GAP
        ]
        if not qualifying:
            return None

        by_unit: dict[str, list[TopicState]] = defaultdict(list)
        for ts in qualifying:
            by_unit[student.unit_of(ts.topic_id)].append(ts)

        def unit_gap(items):
            return statistics.fmean(gaps[ts.topic_id] for ts in items)

        # "Repeatedly" can be satisfied three ways, in descending order of
        # how much evidence stands behind the claim.
        repeated = [(u, i) for u, i in by_unit.items() if len(i) >= self.MIN_TOPICS]
        thorough = [
            (u, i)
            for u, i in by_unit.items()
            if any(ts.attempts_n >= self.THOROUGH_ATTEMPTS for ts in i)
        ]
        certain = [
            (u, i)
            for u, i in by_unit.items()
            if any(
                ts.self_rating >= self.CERTAIN_RATING
                and ts.mastery < self.CERTAIN_MASTERY
                for ts in i
            )
        ]
        pool = repeated or thorough or certain
        if not pool:
            return None
        thin = not repeated and not thorough

        unit, items = max(pool, key=lambda c: (unit_gap(c[1]), len(c[1])))
        mean_gap = unit_gap(items)
        # Rule 2.
        if mean_gap < personal_mean + self.UNIT_MARGIN:
            return None

        mean_rating = statistics.fmean(ts.self_rating for ts in items)
        mean_mastery = statistics.fmean(ts.mastery for ts in items)
        attempts = sum(ts.attempts_n for ts in items)

        if thin:
            severity = Flag.WATCH
        elif mean_mastery < self.CRITICAL_MASTERY and mean_rating >= 4.5:
            severity = Flag.CRITICAL
        elif mean_gap >= self.HIGH_GAP:
            severity = Flag.HIGH
        else:
            severity = Flag.WATCH
        evidence = {
            "evidence_strength": "repeated"
            if repeated
            else "thorough"
            if thorough
            else "thin-but-certain",
            "unit": unit,
            "subject": student.subject_of(items[0].topic_id),
            "self_rating": round(mean_rating, 1),
            "measured_mastery_pct": pct(mean_mastery),
            "gap": round(mean_gap, 3),
            "personal_mean_gap": round(personal_mean, 3),
            "chapters": [
                {
                    "topic": student.topic_names.get(ts.topic_id),
                    "self_rating": ts.self_rating,
                    "mastery_pct": pct(ts.mastery),
                    "attempts": ts.attempts_n,
                }
                for ts in sorted(items, key=lambda t: t.mastery)
            ],
            "attempts": attempts,
        }
        headline = (
            f"Rates {unit} {mean_rating:.0f}/5; scoring {pct(mean_mastery):.0f}% on it "
            f"across {attempts} attempts."
        )
        return self.flag(
            student,
            severity=severity,
            headline=headline,
            evidence=evidence,
            topic_id=min(items, key=lambda t: t.mastery).topic_id,
        )


@register
class RevisionOverdueDetector(Detector):
    """A revision backlog the student is not working off.

    Two ways in, because a backlog is bad for two different reasons. Either
    it is large relative to everything they were ever scheduled (the debt
    is structural), or the share going overdue has risen sharply against
    their own earlier record (the debt is accelerating). The second is the
    personal baseline; the first exists because a student who has *always*
    been 40% behind still needs someone to say so once.
    """

    type = "revision_overdue"
    rule_version = "v1"
    tier = 1
    min_evidence = "8+ revision cycles already past their scheduled date"
    baseline = "this student's own overdue share on earlier cycles"

    MIN_DUE = 8
    MIN_OVERDUE = 8
    STRUCTURAL_SHARE = 0.35
    RECENT_DAYS = 21
    ACCELERATION_MARGIN = 0.20
    MIN_RECENT_OVERDUE = 5
    CRITICAL_SHARE, HIGH_SHARE = 0.55, 0.45

    def evaluate(self, student: StudentFacts) -> Flag | None:
        due = [(d, done) for d, done in student.revisions if d < student.today]
        if len(due) < self.MIN_DUE:
            return None
        overdue = [d for d, done in due if not done]
        share = len(overdue) / len(due)

        cut = student.today - dt.timedelta(days=self.RECENT_DAYS)
        recent = [(d, done) for d, done in due if d >= cut]
        prior = [(d, done) for d, done in due if d < cut]
        recent_share = (
            sum(1 for _, done in recent if not done) / len(recent) if recent else None
        )
        prior_share = (
            sum(1 for _, done in prior if not done) / len(prior) if prior else None
        )
        recent_overdue = sum(1 for _, done in recent if not done)

        structural = len(overdue) >= self.MIN_OVERDUE and share >= self.STRUCTURAL_SHARE
        accelerating = (
            recent_share is not None
            and prior_share is not None
            and recent_overdue >= self.MIN_RECENT_OVERDUE
            and recent_share >= prior_share + self.ACCELERATION_MARGIN
        )
        if not (structural or accelerating):
            return None

        oldest = min(overdue) if overdue else None
        severity = (
            Flag.CRITICAL
            if share >= self.CRITICAL_SHARE
            else Flag.HIGH
            if share >= self.HIGH_SHARE
            else Flag.WATCH
        )
        evidence = {
            "overdue": len(overdue),
            "due_total": len(due),
            "overdue_share_pct": pct(share),
            "recent_overdue_share_pct": pct(recent_share),
            "prior_overdue_share_pct": pct(prior_share),
            "recent_window_days": self.RECENT_DAYS,
            "oldest_overdue_days": (student.today - oldest).days if oldest else None,
            "trigger": "accelerating" if accelerating else "structural",
        }
        headline = (
            f"{len(overdue)} of {len(due)} scheduled revisions are overdue "
            f"({pct(share):.0f}%), the oldest by "
            f"{(student.today - oldest).days} days."
            if oldest
            else f"{len(overdue)} revisions overdue."
        )
        return self.flag(
            student, severity=severity, headline=headline, evidence=evidence
        )


@register
class DisengagementDetector(Detector):
    """Practice stopped, and stayed stopped.

    "Stayed" is the load-bearing word. A quiet week happens — illness, a
    school exam, a wedding — and flagging it produces a console full of
    noise that mentors learn to scroll past. So the rule needs both a sharp
    drop against the student's own four-week norm *and* an unbroken run of
    silence; a student who logged yesterday is not disengaged no matter how
    bad last week looked.
    """

    type = "disengagement"
    rule_version = "v1"
    tier = 1
    min_evidence = "21+ days of prior logging history, averaging 300+ min/week"
    baseline = "this student's own mean weekly minutes over the preceding 4 weeks"

    RECENT_DAYS = 7
    BASELINE_DAYS = 28
    MIN_HISTORY_DAYS = 21
    MIN_BASELINE_WEEKLY = 300
    DROP_SHARE = 0.35
    MIN_SILENCE_DAYS = 5
    CRITICAL_SILENCE, HIGH_SILENCE = 14, 7

    def evaluate(self, student: StudentFacts) -> Flag | None:
        if not student.day_minutes:
            return None
        last = student.last_log_day()
        silence = (student.today - last).days
        if silence < self.MIN_SILENCE_DAYS:
            return None

        recent_cut = student.today - dt.timedelta(days=self.RECENT_DAYS)
        base_cut = recent_cut - dt.timedelta(days=self.BASELINE_DAYS)
        baseline_days = {
            d: m for d, m in student.day_minutes.items() if base_cut < d <= recent_cut
        }
        if len(baseline_days) < self.MIN_HISTORY_DAYS:
            return None

        baseline_weekly = sum(baseline_days.values()) / self.BASELINE_DAYS * 7
        if baseline_weekly < self.MIN_BASELINE_WEEKLY:
            return None

        recent_minutes = sum(
            m for d, m in student.day_minutes.items() if d > recent_cut
        )
        if recent_minutes > baseline_weekly * self.DROP_SHARE:
            return None

        severity = (
            Flag.CRITICAL
            if silence >= self.CRITICAL_SILENCE
            else Flag.HIGH
            if silence >= self.HIGH_SILENCE
            else Flag.WATCH
        )
        evidence = {
            "days_since_last_log": silence,
            "last_log_date": last.isoformat(),
            "last_7d_minutes": recent_minutes,
            "prior_weekly_avg_min": round(baseline_weekly),
            "drop_pct": pct(1 - (recent_minutes / baseline_weekly)) if baseline_weekly else None,
            "baseline_logged_days": len(baseline_days),
            "baseline_window_days": self.BASELINE_DAYS,
        }
        headline = (
            f"No practice logged in {silence} days, against a personal average of "
            f"{round(baseline_weekly):,} min/week."
        )
        return self.flag(
            student, severity=severity, headline=headline, evidence=evidence
        )


@register
class OverloadDetector(Detector):
    """Hours rising, accuracy falling. Both, or it is not overload.

    Either signal alone is fine or even good — more hours is usually
    progress, and a bad mock is a bad mock. It is the conjunction that says
    the extra effort is being spent badly, and it is the one case where the
    right advice is *do less*, which is advice a mentor will not give
    without evidence.

    Intensity comes from `load_index` (minutes per study day, this month
    against last), not from total minutes. Total minutes conflates working
    harder with working more often, and the student who is doing both looks
    identical to the student who has simply stopped taking rest days.
    """

    type = "overload"
    rule_version = "v1"
    tier = 1
    min_evidence = "8+ logged study days in each of two consecutive 4-week windows, and 4+ mocks"
    baseline = "the student's own study intensity and own mock accuracy, month against month"

    LOAD_RISE = 1.12
    MIN_DAYS_PER_WINDOW = 8
    MIN_PAPERS = 4
    PAPER_HALF = 3
    ACCURACY_DROP = -0.05
    CRITICAL_LOAD, CRITICAL_DROP = 1.25, -0.10
    HIGH_DROP = -0.07

    def evaluate(self, student: StudentFacts) -> Flag | None:
        if len(student.papers) < self.MIN_PAPERS:
            return None

        recent_cut = student.today - dt.timedelta(days=LOAD_WINDOW_DAYS)
        prior_cut = student.today - dt.timedelta(days=2 * LOAD_WINDOW_DAYS)
        recent_days = [d for d in student.day_minutes if d > recent_cut]
        prior_days = [d for d in student.day_minutes if prior_cut < d <= recent_cut]
        if (
            len(recent_days) < self.MIN_DAYS_PER_WINDOW
            or len(prior_days) < self.MIN_DAYS_PER_WINDOW
        ):
            return None

        recent_int, prior_int = study_intensity(student.day_minutes, student.today)
        if not prior_int:
            return None
        load = recent_int / prior_int
        if load < self.LOAD_RISE:
            return None

        late = student.papers[-self.PAPER_HALF :]
        early = student.papers[: -self.PAPER_HALF][-self.PAPER_HALF :]
        if not early:
            return None
        acc_late = _accuracy(late)
        acc_early = _accuracy(early)
        if acc_late is None or acc_early is None:
            return None
        change = acc_late - acc_early
        if change > self.ACCURACY_DROP:
            return None

        severity = (
            Flag.CRITICAL
            if load >= self.CRITICAL_LOAD or change <= self.CRITICAL_DROP
            else Flag.HIGH
            if change <= self.HIGH_DROP
            else Flag.WATCH
        )
        evidence = {
            "hours_change_pct": pct(load - 1),
            "minutes_per_day_recent": round(recent_int),
            "minutes_per_day_prior": round(prior_int),
            "study_days_recent": len(recent_days),
            "study_days_prior": len(prior_days),
            "accuracy_recent_pct": pct(acc_late),
            "accuracy_prior_pct": pct(acc_early),
            "accuracy_change_pts": round(change * 100, 1),
            "papers_recent": [p.name for p in late],
            "papers_prior": [p.name for p in early],
        }
        headline = (
            f"Study intensity up {pct(load - 1):.0f}% while mock accuracy fell "
            f"{abs(change * 100):.0f} points. Classic overload signature."
        )
        return self.flag(
            student, severity=severity, headline=headline, evidence=evidence
        )


# ==================================================================== runner


def _slope(ys: list[float]) -> float:
    n = len(ys)
    if n < 2:
        return 0.0
    mean_x = (n - 1) / 2
    mean_y = sum(ys) / n
    sxy = sum((i - mean_x) * (y - mean_y) for i, y in enumerate(ys))
    sxx = sum((i - mean_x) ** 2 for i in range(n))
    return sxy / sxx if sxx else 0.0


def _accuracy(papers: list[PaperRow]) -> float | None:
    attempted = sum(p.attempted for p in papers)
    correct = sum(p.correct for p in papers)
    return correct / attempted if attempted else None


@dataclasses.dataclass
class Candidate:
    """An evaluated detector result, before the cooldown decision."""

    flag: Flag
    detector: Detector
    suppressed_by: str | None = None

    @property
    def fired(self) -> bool:
        return self.suppressed_by is None


@dataclasses.dataclass
class DetectorRun:
    institute_id: int
    students: int = 0
    evaluated: int = 0
    raised: int = 0
    suppressed: int = 0
    candidates: list[Candidate] = dataclasses.field(default_factory=list)

    def by_type(self) -> dict[str, int]:
        out: dict[str, int] = defaultdict(int)
        for c in self.candidates:
            if c.fired:
                out[c.flag.type] += 1
        return dict(out)


def _attach_precomputed(facts: StudentFacts, cohort: CohortFacts) -> None:
    """Hang the cohort-level slices the detectors need onto the facts.

    Kept out of `StudentFacts`'s declared fields because they are detector
    implementation details rather than part of the student's state.
    """
    facts._recent_attempts = cohort.recent_attempts(facts.id)
    facts._lost_by_topic = cohort.lost_by_topic.get(facts.id, {})
    facts._lost_by_subject = cohort.lost_by_subject.get(facts.id, {})
    facts._time_by_subject = cohort.time_by_subject.get(facts.id, {})
    facts._scheme = cohort.scheme


#: Rule 3, second half: a per-student budget per run.
#:
#: Cooldown stops the *same* flag repeating; it does nothing about eight
#: different detectors all firing on one struggling student on the same
#: night. Eight flags on one name is not eight times the information — a
#: mentor reads the first two and forms the same plan either way, and the
#: other six push someone else's genuinely new flag off the screen. Keeping
#: the most severe three and letting the rest come back tomorrow (or after
#: the top one is resolved) is how the console stays a queue rather than a
#: log.
MAX_FLAGS_PER_STUDENT = 3

_SEVERITY_RANK = {Flag.CRITICAL: 0, Flag.HIGH: 1, Flag.WATCH: 2, Flag.IMPROVING: 3}


def _apply_budget(candidates: list[Candidate], budget: int) -> list[Candidate]:
    """Keep the `budget` most severe firing candidates; hold back the rest."""
    firing = [c for c in candidates if c.fired]
    if len(firing) <= budget:
        return candidates
    ranked = sorted(firing, key=lambda c: (_SEVERITY_RANK.get(c.flag.severity, 9), c.flag.type))
    for c in ranked[budget:]:
        c.suppressed_by = (
            f"per-student budget: {budget} higher-severity flags already raised tonight"
        )
    return candidates


def run_detectors(
    institute_id: int,
    student_ids=None,
    as_of=None,
    *,
    only: list[str] | None = None,
    tier: int | None = None,
    dry_run: bool = False,
    ignore_cooldown: bool = False,
    max_per_student: int = MAX_FLAGS_PER_STUDENT,
) -> DetectorRun:
    """Evaluate every registered detector over an institute's students.

    `dry_run` evaluates and reports without writing, and still reports what
    the cooldown *would* have suppressed — that distinction is the whole
    point of being able to run this against a console full of existing
    flags without doubling them.
    """
    as_of = as_of or timezone.now()
    ids = list(
        Student.objects.filter(institute_id=institute_id)
        .filter(**({"id__in": list(student_ids)} if student_ids is not None else {}))
        .order_by("id")
        .values_list("id", flat=True)
    )
    run = DetectorRun(institute_id=institute_id, students=len(ids))
    if not ids:
        return run

    detectors = [
        d
        for d in REGISTRY.values()
        if (only is None or d.type in only) and (tier is None or d.tier == tier)
    ]
    cohort = CohortFacts(institute_id, ids, as_of)
    history = _flag_history(institute_id, ids)

    to_write: list[Flag] = []
    for sid in ids:
        facts = cohort.for_student(sid)
        _attach_precomputed(facts, cohort)

        passed: list[Candidate] = []
        for detector in detectors:
            run.evaluated += 1
            try:
                flag = detector.evaluate(facts)
            except Exception:
                logger.exception(
                    "Detector %s blew up on student %s; skipping it rather than "
                    "failing the whole run.",
                    detector.type,
                    sid,
                )
                continue
            if flag is None:
                continue
            reason = (
                None
                if ignore_cooldown
                else _cooldown_reason(
                    history.get((sid, detector.type, flag.topic_id)), detector, as_of
                )
            )
            passed.append(Candidate(flag=flag, detector=detector, suppressed_by=reason))

        for candidate in _apply_budget(passed, max_per_student):
            run.candidates.append(candidate)
            if candidate.fired:
                run.raised += 1
                to_write.append(candidate.flag)
            else:
                run.suppressed += 1

    if to_write and not dry_run:
        with transaction.atomic():
            Flag.objects.bulk_create(to_write, batch_size=500)
    return run


def _flag_history(institute_id: int, ids: list[int]):
    """(student_id, type, topic_id) -> (latest raised_at, whether one is still open).

    Keyed on the topic as well as the type, and that third element is the
    whole point. Keyed on (student, type) alone, one open `weak_topic` on
    Organic Chemistry silenced `weak_topic` on every other chapter for that
    student, permanently — and since nothing resolved flags, "permanently"
    was literal. Seven of the eight detectors had gone mute on the seeded
    data before this was caught.

    Topic-less detectors (overload, disengagement, subject_imbalance) carry
    `None` here, so they still collapse to one open flag per student, which
    for a whole-student condition is the correct behaviour.
    """
    out: dict[tuple[int, str, int | None], tuple[dt.datetime, bool]] = {}
    for sid, ftype, topic_id, raised_at, resolved_at in (
        Flag.objects.filter(institute_id=institute_id, student_id__in=ids)
        .order_by("raised_at")
        .values_list("student_id", "type", "topic_id", "raised_at", "resolved_at")
    ):
        key = (sid, ftype, topic_id)
        prev = out.get(key)
        still_open = resolved_at is None
        if prev is None:
            out[key] = (raised_at, still_open)
        else:
            out[key] = (max(prev[0], raised_at), prev[1] or still_open)
    return out


def _cooldown_reason(entry, detector: Detector, as_of: dt.datetime) -> str | None:
    """Rule 3. Returns why this flag is suppressed, or None to let it fire."""
    if entry is None:
        return None
    last_raised, still_open = entry
    if still_open:
        # Re-raising something already on the mentor's list is how a console
        # turns into a wall. The open flag is the ticket; new evidence
        # belongs on it, not beside it.
        #
        # This only suppresses the SAME (student, type, topic). A different
        # weak chapter is a different ticket and must still get through —
        # see _flag_history.
        return "an open flag for this student, type and topic already exists"
    age_days = (as_of - last_raised).days
    if age_days < detector.cooldown_days:
        return f"cooldown: last raised {age_days}d ago, window {detector.cooldown_days}d"
    return None
