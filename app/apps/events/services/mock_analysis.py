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

THE FIVE CAUSES, AND WHAT SEPARATES THEM

    conceptual gap    Wrong or skipped, and mastery on that chapter was
                      measured and *low*. Also: wrong on a chapter they
                      *do* know but only after burning far more time than
                      they normally need — see the note below.
    execution error   Wrong, mastery high, time within their normal range.
                      Careless. Fixable this week.
    time exhaustion   `not_reached`. The clock ran out before they saw it.
                      A pacing problem, not a knowledge problem.
    avoidable skip    `blank` on a chapter they have demonstrated they can
                      do. They looked at it and walked past marks.
    insufficient      Wrong or skipped on a chapter whose mastery the
    evidence          feature store **declined to report**. Not a cause at
                      all — the honest absence of one.

THE FIFTH BUCKET, AND WHY IT HAD TO EXIST
    `TopicState.mastery` is null below the four-attempt evidence floor
    (features.EVIDENCE_FLOOR). That null is a deliberate refusal: three
    data points do not license a claim about whether a student knows a
    chapter, and the feature store says so rather than printing a
    confident-looking 0.33.

    This module used to throw that refusal away. `known` was
    `mastery is not None and mastery >= KNOWN_MASTERY`, so an unmeasured
    chapter was `not known`, and both `not known` branches fell through to
    CONCEPTUAL_GAP. A null — "we do not know" — was silently promoted to
    the most pessimistic of four causes and then printed to a mentor as an
    integer number of marks.

    On the seeded cohort that was **10,960 of 32,729 conceptual-gap marks
    resting on a null**, a third of the headline. 270 (student, topic)
    pairs carried `attempts_n = 0` — the student has never once attempted
    that chapter — and their 1,222 blanks were booked as *proven* gaps.

    So: `mastery is None` now routes to INSUFFICIENT_EVIDENCE, which is a
    reported bucket like any other and keeps the partition exact. It is
    neither a gap nor a recoverable mark; it is the count of marks the
    system is not entitled to attribute yet, and the fix for it is more
    practice on that chapter, not a diagnosis.

    `not_reached` is deliberately still TIME_EXHAUSTION whatever mastery
    says. The clock running out is evidenced by the status alone and needs
    no knowledge of the chapter.

WHAT `recoverable` MEANS AFTER THE FIFTH BUCKET
    It is the sum of the three *evidenced* recoverable causes, not
    `total - conceptual_gap`. Those were the same number while the four
    buckets partitioned the loss; they are not the same number now, and
    the difference is the whole point. Counting insufficient-evidence
    marks as recoverable would assert "these need no new learning" on
    exactly the evidence the floor exists to reject — the same
    unsupported claim as before, pointed the other way.

    What *was* understated is the share. `recoverable_pct` is computed
    over `attributed_lost` (total minus the unattributable), because "98
    of your 166 lost marks needed no new learning" is a claim about the
    marks we can actually explain. Dropping unattributable marks into the
    denominator quietly dilutes the one sentence the product sells on.

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
INSUFFICIENT_EVIDENCE = "insufficient_evidence"

#: Order matters: it is the order of the `causes` array and of the stacked
#: bar built from it. The new bucket is appended rather than inserted, so a
#: client reading `causes[i]` positionally keeps reading the same cause.
CAUSES = [
    CONCEPTUAL_GAP,
    EXECUTION_ERROR,
    TIME_EXHAUSTION,
    AVOIDABLE_SKIP,
    INSUFFICIENT_EVIDENCE,
]

#: The causes that mean "these marks needed no new learning" — and each of
#: which is a *positive* finding, not the residue of subtracting the gap.
#: INSUFFICIENT_EVIDENCE is pointedly not here: an unmeasured chapter has
#: not been shown to be recoverable any more than it has been shown to be a
#: gap.
RECOVERABLE_CAUSES = [EXECUTION_ERROR, TIME_EXHAUSTION, AVOIDABLE_SKIP]

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
    #: Attempted questions behind `mastery`. The reader of a
    #: `insufficient_evidence` row needs to know whether it means "three
    #: attempts, nearly there" or "never touched this chapter".
    topic_attempts_n: int
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
    """The cause rules, isolated so they can be unit-tested directly.

    `mastery is None` is its own answer and is checked before anything
    that reads its value. Every other branch below asks "is this number
    above or below KNOWN_MASTERY", and there is no third answer that a
    missing number can honestly be folded into.
    """
    if status == Attempt.NOT_REACHED:
        # Evidenced by the status alone: the clock ran out. Whether they
        # knew the chapter is irrelevant and is not consulted.
        return TIME_EXHAUSTION

    if status not in (Attempt.BLANK, Attempt.WRONG):
        return ""  # correct — nothing lost

    if mastery is None:
        # Below the evidence floor. Not a gap, not a slip, not a skip —
        # the feature store declined to say, and so do we.
        return INSUFFICIENT_EVIDENCE

    known = mastery >= KNOWN_MASTERY

    if status == Attempt.BLANK:
        # They saw it and walked past it. Only "avoidable" if they had the
        # chapter; skipping something you genuinely cannot do is correct
        # exam technique, and the marks are still lost to the gap.
        return AVOIDABLE_SKIP if known else CONCEPTUAL_GAP

    # status == Attempt.WRONG
    if not known:
        return CONCEPTUAL_GAP
    if baseline and time_spent and time_spent > baseline * SLOW_FACTOR:
        # Knew the chapter, spent double their normal time, still got it
        # wrong. That is not carelessness. See the module docstring.
        return CONCEPTUAL_GAP
    return EXECUTION_ERROR


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

    # No `mastery__isnull=False` filter. It used to be here, and it was
    # half of the bug: filtering the nulls out made a withheld mastery
    # indistinguishable from a chapter with no row at all, and `classify`
    # then had nothing left to tell it that the silence was deliberate.
    # `attempts_n` comes back in the same pass so the per-question detail
    # can say *how* thin the evidence was.
    states = {
        topic_id: (m, n)
        for topic_id, m, n in TopicState.objects.filter(
            institute_id=institute_id, student_id=student_id
        ).values_list("topic_id", "mastery", "attempts_n")
    }
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

        m, attempts_n = states.get(a["topic_id"], (None, 0))
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
                    topic_attempts_n=attempts_n,
                    time_spent=a["time_spent"],
                    time_vs_baseline=(
                        round(a["time_spent"] / baseline, 2)
                        if baseline and a["time_spent"]
                        else None
                    ),
                )
            )

    total = sum(buckets.values())
    unattributable = buckets[INSUFFICIENT_EVIDENCE]
    attributed = total - unattributable
    recoverable = sum(buckets[c] for c in RECOVERABLE_CAUSES)

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
        # The flat buckets stay ints: every marking scheme in use here is
        # whole-numbered. The five of them partition `total_lost` exactly,
        # which is the invariant the tests assert.
        CONCEPTUAL_GAP: int(round(buckets[CONCEPTUAL_GAP])),
        EXECUTION_ERROR: int(round(buckets[EXECUTION_ERROR])),
        TIME_EXHAUSTION: int(round(buckets[TIME_EXHAUSTION])),
        AVOIDABLE_SKIP: int(round(buckets[AVOIDABLE_SKIP])),
        INSUFFICIENT_EVIDENCE: int(round(unattributable)),
        "total_lost": int(round(total)),
        # Marks the analysis is entitled to explain. The denominator for
        # every claim made about *why* the student lost marks.
        "attributed_lost": int(round(attributed)),
        # Summed from the three evidenced recoverable causes, NOT from
        # `total - conceptual_gap`. See the module docstring: those two
        # agreed while four buckets partitioned the loss, and the
        # difference between them now is precisely the marks nobody has
        # earned the right to call recoverable.
        "recoverable": int(round(recoverable)),
        # The headline share, over what we can explain. Null rather than
        # zero when nothing could be attributed at all — a paper on
        # chapters the student has never practised has no honest
        # percentage, and 0% would read as "nothing is recoverable".
        "recoverable_pct": (
            round(recoverable / attributed * 100, 1) if attributed else None
        ),
        "time_baseline_sec": baseline,
        "causes": [
            {
                "cause": c,
                "marks": int(round(buckets[c])),
                "questions": counts[c],
                # Share of the whole loss, so the five bars still add to
                # 100% and the chart remains a partition of the paper.
                "share_pct": round(buckets[c] / total * 100, 1) if total else 0.0,
            }
            for c in CAUSES
        ],
        "top_loss_topics": top_topics,
    }
    if include_questions:
        out["question_detail"] = [dataclasses.asdict(r) for r in rows]
    return out
