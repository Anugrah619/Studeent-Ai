"""Marks-lost attribution for one student on one paper.

    from apps.events.services.mock_analysis import analyse_mock
    analyse_mock(institute_id=1, student_id=1, paper_id=7)

WHY THIS IS THE ENDPOINT THAT SELLS THE PRODUCT
    "You scored 134" is a number the institute already had. "98 of your 166
    lost marks needed no new learning" is a different product. Every
    coaching centre in India can produce the first sentence; the second
    one requires knowing, per question, whether the student knew the
    topic, how long they spent, and whether they chose not to answer or
    never got there — which is exactly what `Attempt.status` and the
    feature store carry. (TECHNICAL_DOC.md §6.3.)

THE FOUR CAUSES, AND WHAT SEPARATES THEM

    conceptual gap    Wrong, and mastery on that chapter was already low.
                      Also: wrong on a chapter they *do* know but only
                      after burning far more time than they normally need
                      — see the note below.
    execution error   Wrong, mastery high, time within their normal range.
                      Careless. Fixable this week.
    time exhaustion   `not_reached`. The clock ran out before they saw it.
                      A pacing problem, not a knowledge problem.
    avoidable skip    `blank` on a chapter they have demonstrated they can
                      do. They looked at it and walked past marks.

THE TIME RULE, WHICH IS THE PART WORTH ARGUING ABOUT
    Baseline is the student's own median seconds on a question they got
    right — their own, because pace varies enormously between students and
    a cohort median would systematically mislabel the fast and the slow.

    Wrong + high mastery + *much* slower than their own baseline is scored
    as a **conceptual gap**, not an execution error. That is the one
    non-obvious call here, and it is the difference between two pieces of
    advice. "Be more careful" is what an execution error earns; a student
    who spent three times their normal time and still got it wrong was not
    being careless, they hit something inside a chapter they otherwise own
    — and telling them to slow down would make it worse.

    Unattempted questions carry no `time_spent` in practice, so the rule
    never applies to them; `blank` versus `not_reached` already carries
    that distinction, which is why `Attempt.status` is an enum and not a
    nullable boolean (SYSTEM_DESIGN.md §8 Q5).

DETERMINISM
    No LLM. Every number below is arithmetic over `Attempt` rows and
    `TopicState.mastery`. The narration layer gets this dict and writes
    sentences about it; it never gets to change a figure.
"""

from __future__ import annotations

import dataclasses
import statistics
from collections import defaultdict

from apps.derived.models import TopicState
from apps.events.models import Attempt
from apps.ingestion.models import TestPaper
from apps.syllabus.models import Topic

CONCEPTUAL_GAP = "conceptual_gap"
EXECUTION_ERROR = "execution_error"
TIME_EXHAUSTION = "time_exhaustion"
AVOIDABLE_SKIP = "avoidable_skip"

CAUSES = [CONCEPTUAL_GAP, EXECUTION_ERROR, TIME_EXHAUSTION, AVOIDABLE_SKIP]

#: Mastery at or above which we treat the chapter as "they know this".
#: Below it, a wrong answer is a gap rather than a slip.
KNOWN_MASTERY = 0.60

#: Multiples of the student's own median correct-answer time.
SLOW_FACTOR = 2.0
RUSHED_FACTOR = 0.5

#: A baseline computed from fewer correct answers than this is noise, and
#: without a baseline the time rule is simply not applied — the analysis
#: degrades to the status-and-mastery version rather than inventing a pace.
MIN_BASELINE_SAMPLES = 8


@dataclasses.dataclass
class QuestionCause:
    question_id: str
    topic_id: int | None
    topic: str
    subject: str
    status: str
    marks_lost: float
    cause: str
    mastery: float | None
    time_spent: int | None
    time_vs_baseline: float | None


def time_baseline(institute_id: int, student_id: int) -> float | None:
    """Median seconds this student takes on a question they get right.

    Correct answers only, and across every paper rather than the one being
    analysed: the baseline has to be a property of the student, not of the
    paper they are being judged on. A slow paper would otherwise redefine
    "normal" to match itself and the time rule would never fire.
    """
    times = list(
        Attempt.objects.filter(
            institute_id=institute_id,
            student_id=student_id,
            status=Attempt.CORRECT,
            time_spent__isnull=False,
        ).values_list("time_spent", flat=True)
    )
    if len(times) < MIN_BASELINE_SAMPLES:
        return None
    return float(statistics.median(times))


def _subject_of(topic_id: int | None, cache: dict[int, tuple[str, str]]) -> tuple[str, str]:
    return cache.get(topic_id, ("?", "?"))


def _topic_cache(institute_id: int) -> dict[int, tuple[str, str]]:
    """topic_id -> (chapter name, subject name). One query, two LEFT JOINs."""
    out: dict[int, tuple[str, str]] = {}
    for tid, kind, name, parent, grandparent in Topic.objects.filter(
        syllabus__institute_id=institute_id
    ).values_list("id", "kind", "name", "parent__name", "parent__parent__name"):
        if kind == Topic.SUBJECT:
            subject = name
        elif kind == Topic.UNIT:
            subject = parent or name
        else:
            subject = grandparent or parent or name
        out[tid] = (name, subject)
    return out


def classify(
    status: str,
    mastery: float | None,
    time_spent: int | None,
    baseline: float | None,
) -> str:
    """The cause rules, isolated so they can be unit-tested directly."""
    if status == Attempt.NOT_REACHED:
        return TIME_EXHAUSTION

    known = mastery is not None and mastery >= KNOWN_MASTERY

    if status == Attempt.BLANK:
        # They saw it and walked past it. Only "avoidable" if they had the
        # chapter; skipping something you genuinely cannot do is correct
        # exam technique, and the marks are still lost to the gap.
        return AVOIDABLE_SKIP if known else CONCEPTUAL_GAP

    if status == Attempt.WRONG:
        if not known:
            return CONCEPTUAL_GAP
        if baseline and time_spent and time_spent > baseline * SLOW_FACTOR:
            # Knew the chapter, spent double their normal time, still got
            # it wrong. That is not carelessness. See the module docstring.
            return CONCEPTUAL_GAP
        return EXECUTION_ERROR

    return ""  # correct — nothing lost


def analyse_mock(
    *,
    institute_id: int,
    student_id: int,
    paper_id: int,
    include_questions: bool = False,
) -> dict | None:
    """Partition one paper's lost marks by cause. Returns None if unknown.

    The marking scheme comes off the `TestPaper`, not from a constant: a
    wrong answer costs the marks you did not earn **plus** the negative
    marking penalty, and both numbers are per-paper. The previous inline
    version hardcoded 4 and 5, which is right for JEE Main and wrong the
    first time an institute runs a half-length paper.
    """
    paper = (
        TestPaper.objects.filter(institute_id=institute_id, id=paper_id)
        .values("id", "name", "held_on", "max_marks", "total_questions",
                "marks_correct", "marks_wrong")
        .first()
    )
    if paper is None:
        return None

    correct_marks = float(paper["marks_correct"])
    wrong_penalty = abs(float(paper["marks_wrong"]))
    wrong_cost = correct_marks + wrong_penalty
    skip_cost = correct_marks

    attempts = list(
        Attempt.objects.filter(
            institute_id=institute_id, student_id=student_id, test_paper_id=paper_id
        )
        .values("question_id", "topic_id", "status", "time_spent", "marks")
        .order_by("question_id")
    )
    if not attempts:
        return None

    mastery = dict(
        TopicState.objects.filter(
            institute_id=institute_id, student_id=student_id, mastery__isnull=False
        ).values_list("topic_id", "mastery")
    )
    baseline = time_baseline(institute_id, student_id)
    topics = _topic_cache(institute_id)

    buckets: dict[str, float] = {c: 0.0 for c in CAUSES}
    counts: dict[str, int] = {c: 0 for c in CAUSES}
    by_topic: dict[int | None, dict] = defaultdict(
        lambda: {"marks_lost": 0.0, "questions": 0}
    )
    rows: list[QuestionCause] = []
    score = 0.0
    attempted = 0

    for a in attempts:
        score += a["marks"] or 0.0
        if a["status"] in (Attempt.CORRECT, Attempt.WRONG):
            attempted += 1
        if a["status"] == Attempt.CORRECT:
            continue

        m = mastery.get(a["topic_id"])
        cause = classify(a["status"], m, a["time_spent"], baseline)
        lost = wrong_cost if a["status"] == Attempt.WRONG else skip_cost
        buckets[cause] += lost
        counts[cause] += 1

        entry = by_topic[a["topic_id"]]
        entry["marks_lost"] += lost
        entry["questions"] += 1

        if include_questions:
            name, subject = _subject_of(a["topic_id"], topics)
            rows.append(
                QuestionCause(
                    question_id=a["question_id"],
                    topic_id=a["topic_id"],
                    topic=name,
                    subject=subject,
                    status=a["status"],
                    marks_lost=lost,
                    cause=cause,
                    mastery=m,
                    time_spent=a["time_spent"],
                    time_vs_baseline=(
                        round(a["time_spent"] / baseline, 2)
                        if baseline and a["time_spent"]
                        else None
                    ),
                )
            )

    total = sum(buckets.values())
    top_topics = sorted(
        (
            {
                "topic_id": tid,
                "topic": topics.get(tid, ("?", "?"))[0],
                "subject": topics.get(tid, ("?", "?"))[1],
                "marks_lost": round(v["marks_lost"], 1),
                "questions": v["questions"],
            }
            for tid, v in by_topic.items()
        ),
        key=lambda r: -r["marks_lost"],
    )[:8]

    out = {
        "paper_id": paper["id"],
        "paper_name": paper["name"],
        "held_on": paper["held_on"],
        "max_marks": paper["max_marks"],
        "questions": len(attempts),
        "attempted": attempted,
        "score": round(score, 1),
        # The four flat buckets are the original contract and stay ints:
        # every marking scheme in use here is whole-numbered.
        CONCEPTUAL_GAP: int(round(buckets[CONCEPTUAL_GAP])),
        EXECUTION_ERROR: int(round(buckets[EXECUTION_ERROR])),
        TIME_EXHAUSTION: int(round(buckets[TIME_EXHAUSTION])),
        AVOIDABLE_SKIP: int(round(buckets[AVOIDABLE_SKIP])),
        "total_lost": int(round(total)),
        # Everything except the conceptual gap needs no new learning —
        # that is the whole pitch, so it is computed rather than narrated.
        "recoverable": int(round(total - buckets[CONCEPTUAL_GAP])),
        "time_baseline_sec": baseline,
        "causes": [
            {
                "cause": c,
                "marks": int(round(buckets[c])),
                "questions": counts[c],
                "share_pct": round(buckets[c] / total * 100, 1) if total else 0.0,
            }
            for c in CAUSES
        ],
        "top_loss_topics": top_topics,
    }
    if include_questions:
        out["question_detail"] = [dataclasses.asdict(r) for r in rows]
    return out
