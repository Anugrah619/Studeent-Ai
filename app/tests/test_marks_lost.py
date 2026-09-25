"""Marks-lost attribution -- the fifth bucket, and the partition invariant.

WHY THIS FILE EXISTS
    `analyse_mock` is the endpoint the product is sold on. "You scored
    134" is a number the institute already had; "98 of your 166 lost
    marks needed no new learning" is the product. Every figure in that
    sentence is arithmetic, and arithmetic that is wrong in a way nobody
    notices is the worst kind -- it still looks like marks.

    So there are two classes of test here.

    1. THE PARTITION. The cause buckets must sum to `total_lost`, and
       `total_lost` must equal `max_marks - score`. Break either and the
       taxonomy stops being a decomposition of the paper and becomes a
       pile of loosely related numbers that happen to render as a chart.

    2. THE FIFTH BUCKET. `insufficient_evidence` exists because the
       previous four silently absorbed it. `TopicState.mastery` is null
       below the four-attempt evidence floor -- a deliberate refusal to
       claim -- and `classify` routed both of its `not known` branches to
       CONCEPTUAL_GAP, so "we do not know" was promoted to "demonstrated
       failure" and printed to a mentor as an integer. On the seeded
       cohort that was 10,960 of 32,729 conceptual-gap marks resting on a
       null, and 270 (student, topic) pairs with `attempts_n = 0` whose
       blanks were booked as proven gaps.

       `test_a_chapter_below_the_evidence_floor_is_not_a_conceptual_gap`
       is the one to keep. A regression that re-collapsed the null would
       pass every partition test in this file, because the marks would
       still add up -- they would just be in the wrong bucket, which is
       exactly how the defect survived to begin with.
"""

from __future__ import annotations

import datetime as dt

import pytest

from apps.derived.services import features
from apps.events.models import Attempt
from apps.events.services import mock_analysis as ma
from apps.events.services.mock_analysis import classify

from tests import factories as f
from tests.factories import AS_OF

pytestmark = pytest.mark.django_db


# ====================================================== classify, in isolation
#
# The rules with no database in the way. `classify` is pure, so these are
# the cheapest possible statement of what each cause means.


@pytest.mark.parametrize(
    "status,mastery,expected",
    [
        # The null is its own answer, whatever the student did with the
        # question. This is the defect, stated twice.
        (Attempt.WRONG, None, ma.INSUFFICIENT_EVIDENCE),
        (Attempt.BLANK, None, ma.INSUFFICIENT_EVIDENCE),
        # ... except for not_reached, which is evidenced by the status
        # alone: the clock ran out and the chapter is irrelevant.
        (Attempt.NOT_REACHED, None, ma.TIME_EXHAUSTION),
        (Attempt.NOT_REACHED, 0.9, ma.TIME_EXHAUSTION),
        # Measured and low -- an evidenced gap, which is what the bucket
        # was always supposed to mean.
        (Attempt.WRONG, 0.20, ma.CONCEPTUAL_GAP),
        (Attempt.BLANK, 0.20, ma.CONCEPTUAL_GAP),
        # Measured and high.
        (Attempt.WRONG, 0.90, ma.EXECUTION_ERROR),
        (Attempt.BLANK, 0.90, ma.AVOIDABLE_SKIP),
        # Correct costs nothing and has no cause.
        (Attempt.CORRECT, 0.90, ""),
        (Attempt.CORRECT, None, ""),
    ],
)
def test_the_cause_rules(status, mastery, expected):
    assert classify(status, mastery, time_spent=30, baseline=60.0) == expected


def test_a_null_mastery_is_never_silently_treated_as_a_low_one():
    """0.59 and None must not land in the same bucket.

    They did. `known = mastery is not None and mastery >= KNOWN_MASTERY`
    made both of them `not known`, and both `not known` branches returned
    CONCEPTUAL_GAP -- so a chapter measured at 59% and a chapter never
    measured at all produced identical output.
    """
    just_below = classify(Attempt.WRONG, ma.KNOWN_MASTERY - 0.01, 30, 60.0)
    unmeasured = classify(Attempt.WRONG, None, 30, 60.0)
    assert just_below == ma.CONCEPTUAL_GAP
    assert unmeasured == ma.INSUFFICIENT_EVIDENCE
    assert just_below != unmeasured


def test_slow_and_wrong_on_a_known_chapter_is_still_a_gap():
    """The one non-obvious rule, unchanged by the fifth bucket.

    Three times their own median and still wrong is not carelessness, and
    "be more careful" is the wrong advice for it. Kept here because it is
    the rule most likely to be lost in a rewrite of `classify`.
    """
    assert classify(Attempt.WRONG, 0.90, 200, 60.0) == ma.CONCEPTUAL_GAP
    assert classify(Attempt.WRONG, 0.90, 100, 60.0) == ma.EXECUTION_ERROR
    # No baseline means the rule is not applied rather than guessed at.
    assert classify(Attempt.WRONG, 0.90, 200, None) == ma.EXECUTION_ERROR


# =================================================== one paper, end to end


PAPER_DAY = dt.date(2026, 9, 20)


@pytest.fixture
def analysed(cohort):
    """One student, one 8-question paper, every cause represented exactly once.

    The chapters are chosen so that each one lands in a known state
    *after* the paper is counted -- `mastery` reads the paper's own
    attempts too, so the history below is sized against the final total,
    not the pre-paper one.

        Kinematics       10 practice correct + 1 wrong  -> 11 attempted, 0.91
        Thermodynamics    1 correct, 5 wrong + 1 wrong  ->  7 attempted, 0.14
        Magnetism         2 practice correct + 1 wrong  ->  3 attempted, NULL
        Limits           10 practice correct + 1 wrong  -> 11 attempted, 0.91

    Magnetism is the case the fifth bucket exists for: three attempted
    questions is below `features.EVIDENCE_FLOOR`, so the feature store
    declines to report a mastery at all.
    """
    student = f.make_student(cohort, "Partition")
    paper = f.make_paper(
        cohort, "Mock 1", PAPER_DAY, total_questions=8, max_marks=32
    )

    # History. Timed, so `time_baseline` has its eight samples and the
    # slow-and-wrong rule is actually live rather than skipped.
    f.record(student, cohort.chapter("Kinematics"), "cccccccccc",
             time_spent=60, question_prefix="HK")
    f.record(student, cohort.chapter("Limits"), "cccccccccc",
             time_spent=60, question_prefix="HL")
    f.record(student, cohort.chapter("Thermodynamics"), "cwwwww",
             time_spent=60, question_prefix="HT")
    f.record(student, cohort.chapter("Magnetism"), "cc",
             time_spent=60, question_prefix="HM")

    # The paper. Eight questions, five distinct causes.
    f.record(student, cohort.chapter("Kinematics"), "wbn",      # exec, skip, time
             paper=paper, time_spent=50, question_prefix="K")
    f.record(student, cohort.chapter("Thermodynamics"), "wb",   # gap, gap
             paper=paper, time_spent=50, question_prefix="T")
    f.record(student, cohort.chapter("Magnetism"), "wb",        # unmeasured x2
             paper=paper, time_spent=50, question_prefix="M")
    f.record(student, cohort.chapter("Limits"), "w",            # known but slow -> gap
             paper=paper, time_spent=200, question_prefix="L")

    features.recompute(cohort.institute.id, as_of=AS_OF)
    return student, paper, ma.analyse_mock(
        institute_id=cohort.institute.id,
        student_id=student.id,
        paper_id=paper.id,
        include_questions=True,
    )


def test_the_fixture_is_the_mastery_states_it_claims(cohort, analysed):
    """Guard on the fixture itself.

    Every assertion below depends on Magnetism's mastery being null and
    the other three being where they are. If a change to the evidence
    floor or the decay quietly moves one, the cause assertions would
    start testing a different scenario while still passing -- so the
    scenario is pinned here, once.
    """
    student, _, _ = analysed
    states = {
        ts.topic.name: ts
        for ts in features.TopicState.objects.filter(student=student).select_related("topic")
    }
    assert states["Magnetism"].attempts_n == 3 < features.EVIDENCE_FLOOR
    assert states["Magnetism"].mastery is None
    assert states["Thermodynamics"].mastery == pytest.approx(1 / 7, abs=0.01)
    assert states["Kinematics"].mastery == pytest.approx(10 / 11, abs=0.01)
    assert states["Limits"].mastery == pytest.approx(10 / 11, abs=0.01)


def test_the_causes_partition_the_paper_exactly(analysed):
    """sum(causes) == total_lost == max_marks - score. All three, always.

    The chart is a decomposition of one paper. The moment the buckets
    stop summing to the loss, it is a set of unrelated figures drawn
    adjacent to each other, and no amount of correct labelling fixes
    that.
    """
    _, _, out = analysed

    assert out["total_lost"] == round(out["max_marks"] - out["score"])
    assert sum(c["marks"] for c in out["causes"]) == out["total_lost"]
    assert sum(out[c] for c in ma.CAUSES) == out["total_lost"]
    assert sum(c["questions"] for c in out["causes"]) == out["questions"] - 0

    # Shares are over the whole loss, so the five bars still fill the bar.
    assert sum(c["share_pct"] for c in out["causes"]) == pytest.approx(100.0, abs=0.2)


def test_every_cause_gets_the_marks_the_marking_scheme_says(analysed):
    """The exact split, question by question, at +4/-1.

    A wrong answer costs the 4 not earned plus the 1 penalty; a blank or
    an unreached question costs the 4 only.
    """
    _, _, out = analysed

    assert out["score"] == -4.0          # four wrong answers, nothing else scored
    assert out["max_marks"] == 32
    assert out["total_lost"] == 36

    assert out[ma.EXECUTION_ERROR] == 5      # Kinematics wrong, within pace
    assert out[ma.AVOIDABLE_SKIP] == 4       # Kinematics blank, chapter known
    assert out[ma.TIME_EXHAUSTION] == 4      # Kinematics not_reached
    assert out[ma.CONCEPTUAL_GAP] == 14      # Thermo wrong 5 + blank 4, Limits slow 5
    assert out[ma.INSUFFICIENT_EVIDENCE] == 9  # Magnetism wrong 5 + blank 4


def test_a_chapter_below_the_evidence_floor_is_not_a_conceptual_gap(analysed):
    """The defect, stated as the thing that must not come back.

    Magnetism has three attempted questions. The feature store withheld a
    mastery for it on purpose. Those nine marks are not a demonstrated
    gap, they are marks nobody has earned the right to attribute -- and
    under the old four-bucket rule all nine of them were reported to a
    mentor as proven conceptual failure.
    """
    _, _, out = analysed

    unmeasured = [
        q for q in out["question_detail"] if q["topic"] == "Magnetism"
    ]
    assert len(unmeasured) == 2
    assert all(q["mastery"] is None for q in unmeasured)
    assert all(q["topic_attempts_n"] == 3 for q in unmeasured)
    assert {q["cause"] for q in unmeasured} == {ma.INSUFFICIENT_EVIDENCE}

    # And the old bucket carries only the evidenced failures. 14, not 23.
    assert out[ma.CONCEPTUAL_GAP] == 14
    assert out[ma.CONCEPTUAL_GAP] + out[ma.INSUFFICIENT_EVIDENCE] == 23


def test_recoverable_is_summed_from_evidenced_causes_not_subtracted(analysed):
    """`recoverable` must not inherit the unattributable marks either.

    `total - conceptual_gap` was the old definition, and with a fifth
    bucket it would hand all nine unmeasured marks to the headline as
    "needs no new learning" -- the same unsupported claim the bucket
    exists to stop, pointed the other way. It is a sum over the three
    causes that were positively established.
    """
    _, _, out = analysed

    assert out["recoverable"] == 13          # 5 execution + 4 time + 4 skip
    assert out["recoverable"] == sum(out[c] for c in ma.RECOVERABLE_CAUSES)
    assert out["recoverable"] != out["total_lost"] - out[ma.CONCEPTUAL_GAP]
    assert ma.INSUFFICIENT_EVIDENCE not in ma.RECOVERABLE_CAUSES


def test_the_headline_share_is_taken_over_what_can_be_explained(analysed):
    """`recoverable_pct` divides by `attributed_lost`, not `total_lost`.

    "98 of your 166 lost marks needed no new learning" is a claim about
    the marks we can account for. Leaving unattributable marks in the
    denominator dilutes the one sentence the product sells on -- here it
    would read 36% instead of 48%.
    """
    _, _, out = analysed

    assert out["attributed_lost"] == out["total_lost"] - out[ma.INSUFFICIENT_EVIDENCE]
    assert out["attributed_lost"] == 27
    assert out["recoverable_pct"] == pytest.approx(13 / 27 * 100, abs=0.1)
    assert out["recoverable_pct"] > out["recoverable"] / out["total_lost"] * 100


def test_a_paper_with_nothing_attributable_says_so_rather_than_zero(cohort):
    """No evidenced cause at all -> `recoverable_pct` is null, not 0.0.

    A student sitting a paper made entirely of chapters they have barely
    practised has no honest recoverable percentage. Zero would read as
    "none of this is recoverable", which is a claim, and the whole point
    of the fifth bucket is not to make claims of that kind.
    """
    student = f.make_student(cohort, "Cold Start")
    paper = f.make_paper(cohort, "Diagnostic", PAPER_DAY,
                         total_questions=3, max_marks=12)
    f.record(student, cohort.chapter("Magnetism"), "wbn",
             paper=paper, question_prefix="D")
    features.recompute(cohort.institute.id, as_of=AS_OF)

    out = ma.analyse_mock(
        institute_id=cohort.institute.id, student_id=student.id, paper_id=paper.id
    )
    # not_reached is still time exhaustion -- it needs no mastery.
    assert out[ma.TIME_EXHAUSTION] == 4
    assert out[ma.INSUFFICIENT_EVIDENCE] == 9
    assert out[ma.CONCEPTUAL_GAP] == 0
    assert out["attributed_lost"] == 4
    assert out["recoverable"] == 4
    assert out["recoverable_pct"] == pytest.approx(100.0)

    # And with nothing attributable at all, the percentage is withheld.
    blank_only = f.make_student(cohort, "No Evidence")
    paper2 = f.make_paper(cohort, "Diagnostic 2", PAPER_DAY,
                          total_questions=2, max_marks=8)
    f.record(blank_only, cohort.chapter("Matrices"), "wb",
             paper=paper2, question_prefix="E")
    features.recompute(cohort.institute.id, as_of=AS_OF)

    out2 = ma.analyse_mock(
        institute_id=cohort.institute.id, student_id=blank_only.id, paper_id=paper2.id
    )
    assert out2[ma.INSUFFICIENT_EVIDENCE] == out2["total_lost"] == 9
    assert out2["attributed_lost"] == 0
    assert out2["recoverable_pct"] is None


def test_the_cause_order_is_stable_and_the_new_bucket_is_appended(analysed):
    """`causes[i]` must keep meaning what it meant before v0.3.

    The fifth bucket is appended, not inserted, so a client reading the
    array positionally -- which is what a stacked bar built from it does
    -- reads the same cause in the same slot as it did against the
    four-bucket contract.
    """
    _, _, out = analysed
    assert [c["cause"] for c in out["causes"]] == [
        "conceptual_gap",
        "execution_error",
        "time_exhaustion",
        "avoidable_skip",
        "insufficient_evidence",
    ]


# ============================================ the horizon label on weak_topic


def test_weak_topic_states_the_period_its_marks_figure_covers(cohort):
    """v2: "costing N marks across M mocks", and the span in the evidence.

    `mastery_pct` is a 20-attempt decayed window; `marks_lost` is
    cumulative across every paper sat. Both horizons are correct for what
    they measure, and the v1 headline put them in one sentence with
    neither labelled, so a career total read as a current-period figure.
    """
    from apps.derived.models import Flag
    from apps.derived.services import detectors as det

    f.teach_everything(cohort)
    student = f.make_student(cohort, "Windowed")
    papers = [
        f.make_paper(cohort, f"Mock {i}", dt.date(2026, 7, 1) + dt.timedelta(days=14 * i))
        for i in range(3)
    ]
    # One weak chapter costing marks on every paper, five chapters of
    # context so `personal_median_mastery` has its five scored chapters.
    for i, paper in enumerate(papers):
        f.record(student, cohort.chapter("Thermodynamics"), "ccwwwwww",
                 paper=paper, question_prefix=f"W{i}")
        for j, other in enumerate(
            ["Kinematics", "Laws of Motion", "Current Electricity", "Magnetism", "Limits"]
        ):
            f.record(student, cohort.chapter(other), "cccccccw",
                     paper=paper, question_prefix=f"F{i}{j}")

    features.recompute(cohort.institute.id, as_of=AS_OF)
    det.run_detectors(cohort.institute.id, as_of=AS_OF, only=["weak_topic"])

    flag = Flag.objects.get(student=student, type="weak_topic")
    e = flag.evidence

    assert flag.rule_version == "v2"
    assert e["papers_covered"] == 3
    assert e["first_paper"] == papers[0].held_on.isoformat()
    assert e["last_paper"] == papers[-1].held_on.isoformat()
    assert e["marks_lost_per_paper"] == pytest.approx(e["marks_lost"] / 3, abs=0.1)

    # The sentence a mentor reads. Both halves now carry their period.
    assert "across 3 mocks" in flag.headline
    assert f"costing {e['marks_lost']:.0f} marks across 3 mocks" in flag.headline
    assert f"over {e['attempts']} attempts" in flag.headline
