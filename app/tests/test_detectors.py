"""Detector replay -- a known event stream in, a specific flag out.

WHY THESE ARE THE HIGHEST-VALUE TESTS IN THE SYSTEM
    A detector that silently stops firing is invisible. Nothing errors,
    no page breaks, the console simply gets quieter -- and the first
    person to notice is a director asking why nobody was flagged before
    the exam. There is no monitoring for "an absence of alerts that
    should have happened"; there is only this file.

    So each test below fixes an exact event stream and asserts the exact
    flag, with the exact evidence a mentor would be shown.

ALERT HYGIENE IS THE PART MOST LIKELY TO ROT
    TECHNICAL_DOC.md 6.4 names three rules, and all three are the kind of
    thing that gets "simplified" during a refactor because the simpler
    version still produces flags:

      minimum evidence   -- nothing fires on three data points
      personal baseline  -- compared against their own history, never the
                            cohort's
      cooldown           -- one flag per type per student per fortnight

    `test_the_baseline_is_personal_and_not_a_cohort_comparison` is the
    one to keep. It builds two students with *identical* numbers on the
    chapter in question and different histories around it, and asserts
    only one is flagged. A detector that quietly switched to a cohort
    comparison -- or to a bare `mastery < 0.45` -- passes every other test
    in this file and fails that one.

A NOTE ON THE FIXTURES
    `f.record()` writes a whole pattern at one timestamp, so decay
    weights are all 1 and `mastery == correct / attempted` exactly. The
    numbers below are therefore the rule's numbers, not the decay
    curve's. `tests/test_features.py` covers the decay separately.
"""

from __future__ import annotations

import datetime as dt

import pytest
from freezegun import freeze_time

from apps.derived.models import Flag, TopicState
from apps.derived.services import detectors as det
from apps.derived.services import features

from tests import factories as f
from tests.factories import AS_OF

pytestmark = pytest.mark.django_db


# --------------------------------------------------------------- helpers

#: Five chapters that are not the one under test, used as the student's
#: "rest of their history". Five because `personal_median_mastery` needs at
#: least five scored chapters before it will produce a baseline at all.
FILLER = [
    "Kinematics", "Laws of Motion", "Current Electricity", "Magnetism", "Limits",
]

WEAK_CHAPTER = "Thermodynamics"


def build_student(
    cohort,
    name: str,
    *,
    weak: str,
    filler: str,
    chapter: str = WEAK_CHAPTER,
    roll: str | None = None,
):
    """One student, one chapter under test, five chapters of context.

    `weak` and `filler` are status patterns. Everything the detector reads
    -- mastery, attempt count, marks lost, the personal median -- follows
    from those two strings, which is what makes the tests below readable
    as "this history produces this flag".
    """
    student = f.make_student(cohort, name, roll_no=roll or name[:8])
    f.record(student, cohort.chapter(chapter), weak, question_prefix="W")
    for i, other in enumerate(FILLER):
        f.record(student, cohort.chapter(other), filler, question_prefix=f"F{i}")
    return student


def evaluate(cohort, *, only=("weak_topic",), as_of=AS_OF, **kwargs):
    """Recompute the feature store, then run the detectors over it.

    In that order, always: every detector reads the feature store, and a
    stale store produces confident flags about last month.
    """
    inst = cohort.institute.id
    features.recompute(inst, as_of=as_of)
    return det.run_detectors(inst, as_of=as_of, only=list(only), **kwargs)


def flags_for(student) -> list[Flag]:
    return list(Flag.objects.filter(student=student))


# ============================================================ weak_topic


def test_weak_topic_fires_below_the_mastery_floor_with_its_evidence(cohort):
    """The canonical firing case, asserted down to the evidence dict.

    `evidence` is what answers a director's "why was this flagged?", so it
    is part of the contract, not a debug aid.
    """
    f.teach_everything(cohort)
    student = build_student(cohort, "Weak", weak="ccwwwwww", filler="cccccccw")

    run = evaluate(cohort)

    assert run.raised == 1
    flag = Flag.objects.get(student=student)
    assert flag.type == "weak_topic"
    # v2 relabelled the horizon `marks_lost` covers. The firing rule is
    # unchanged; every threshold assertion below is the same as under v1.
    assert flag.rule_version == "v2"
    assert flag.topic_id == cohort.chapter(WEAK_CHAPTER).id
    assert flag.resolved_at is None

    e = flag.evidence
    assert e["topic"] == WEAK_CHAPTER
    assert e["subject"] == "Chemistry"
    assert e["unit"] == "Physical Chemistry"
    assert e["mastery_pct"] == 25          # 2 correct of 8 attempted
    assert e["attempts"] == 8
    assert e["correct"] == 2
    assert e["marks_lost"] == 30.0         # 6 wrong x (4 not earned + 1 penalty)
    assert e["total_marks_lost"] == 55.0   # plus one wrong on each of 5 chapters
    assert e["share_of_lost_marks_pct"] == pytest.approx(54.5, abs=0.1)
    assert e["personal_median_mastery_pct"] == pytest.approx(88, abs=1)

    # v2: `marks_lost` is cumulative while `mastery_pct` is a 20-attempt
    # decayed window, so the flag has to say which period the marks cover.
    # `build_student` writes practice attempts with no `TestPaper`, so the
    # span here is legitimately zero and the headline claims none -- which
    # is the point: the label is only asserted when it is true.
    assert e["papers_covered"] == 0
    assert e["first_paper"] is None and e["last_paper"] is None
    assert e["marks_lost_per_paper"] is None
    assert "across" not in flag.headline

    # Severity is graded on marks at stake, not on the percentage: that is
    # what makes the console sort usefully.
    assert flag.severity == Flag.HIGH
    assert "30 marks" in flag.headline

    # The hygiene rules are recorded on every flag, so a mentor reading one
    # can see what standard it was held to.
    assert e["detector"] == "weak_topic"
    assert e["baseline"].startswith("the student's own median mastery")
    assert "6+ attempted questions" in e["min_evidence"]


@pytest.mark.parametrize(
    "pattern,mastery,should_fire",
    [
        ("cccccccc" + "wwwwwwwwwwww", 0.40, True),   # 8 of 20 -- below 0.45
        ("ccccccccc" + "wwwwwwwwwww", 0.45, False),  # 9 of 20 -- exactly at it
    ],
)
def test_the_mastery_floor_is_a_real_boundary(cohort, pattern, mastery, should_fire):
    """0.40 fires, 0.45 does not, and the marks lost barely move.

    Both cases clear every other bar -- 20 attempts, 55-60 marks lost, a
    personal median of 0.875 far above either. The only thing that changes
    across the parametrize is which side of `MASTERY_FLOOR` the chapter
    sits on, so a regression in the threshold cannot hide behind one of
    the other gates.
    """
    f.teach_everything(cohort)
    student = build_student(cohort, "Boundary", weak=pattern, filler="cccccccw")

    run = evaluate(cohort)

    assert TopicState.objects.get(
        student=student, topic=cohort.chapter(WEAK_CHAPTER)
    ).mastery == pytest.approx(mastery)
    assert det.WeakTopicDetector.MASTERY_FLOOR == 0.45
    assert bool(run.raised) is should_fire
    assert bool(flags_for(student)) is should_fire


def test_weak_topic_does_not_fire_on_a_chapter_the_batch_was_never_taught(cohort):
    """A student cannot be behind on something nobody has taught yet.

    Flagging it destroys mentor trust faster than any false positive on a
    chapter that *was* taught, which is why the gate exists.
    """
    f.teach(cohort, *[cohort.chapter(c) for c in FILLER])   # everything but the weak one
    student = build_student(cohort, "Untaught", weak="ccwwwwww", filler="cccccccw")

    assert evaluate(cohort).raised == 0

    f.teach(cohort, cohort.chapter(WEAK_CHAPTER))
    assert evaluate(cohort).raised == 1


# ----------------------------------------------- hygiene 1: min evidence


@pytest.mark.parametrize("attempts,should_fire", [(5, False), (6, True)])
def test_minimum_evidence_is_enforced_at_six_attempts(cohort, attempts, should_fire):
    """Five all-wrong attempts lose 25 marks -- over the 24-mark bar -- and
    still must not raise a flag. The only thing holding it back is the
    evidence count, which is exactly what this asserts."""
    f.teach_everything(cohort)
    student = build_student(cohort, "Thin", weak="w" * attempts, filler="cccccccw")

    run = evaluate(cohort)

    state = TopicState.objects.get(student=student, topic=cohort.chapter(WEAK_CHAPTER))
    assert state.attempts_n == attempts
    assert state.mastery == 0.0, "mastery is above the 4-attempt floor either way"
    assert det.WeakTopicDetector.MIN_ATTEMPTS == 6
    assert bool(run.raised) is should_fire


def test_no_detector_fires_on_a_student_with_no_history(cohort):
    """The empty case, because 'no data' must read as silence, not as risk."""
    f.teach_everything(cohort)
    f.make_student(cohort, "Newcomer", roll_no="NEW")

    run = evaluate(cohort, only=tuple(det.REGISTRY))

    assert run.raised == 0
    assert Flag.objects.count() == 0


# ------------------------------------------ hygiene 2: personal baseline


def test_the_baseline_is_personal_and_not_a_cohort_comparison(cohort):
    """Two students, identical numbers on the chapter, different histories.

    Both have 3 correct of 8 on Thermodynamics: same mastery, same attempt
    count, same 25 marks lost. The difference is everything around it --
    one is strong elsewhere and one is flat -- and only the first has a
    chapter that is bad *for them*.

    This is the test that catches a detector silently switching to a
    cohort comparison, or collapsing to a bare `mastery < 0.45`. Under
    either of those rules both students fire, because their numbers on the
    chapter are indistinguishable. The assertion below proves the cohort
    reading would be wrong, not merely different.
    """
    f.teach_everything(cohort)
    deviates = build_student(cohort, "Deviates", weak="cccwwwww", filler="cccccccw",
                             roll="DEV")
    uniform = build_student(cohort, "Uniform", weak="cccwwwww", filler="cccwwwww",
                            roll="UNI")

    run = evaluate(cohort)

    chapter = cohort.chapter(WEAK_CHAPTER)
    a = TopicState.objects.get(student=deviates, topic=chapter)
    b = TopicState.objects.get(student=uniform, topic=chapter)
    assert (a.mastery, a.attempts_n, a.correct_n) == (b.mastery, b.attempts_n, b.correct_n)
    assert a.mastery == pytest.approx(0.375)

    # A cohort-relative rule would flag the uniform student: their chapters
    # sit below the cohort's own mean.
    cohort_mean = sum(
        ts.mastery for ts in TopicState.objects.filter(mastery__isnull=False)
    ) / TopicState.objects.filter(mastery__isnull=False).count()
    assert b.mastery < cohort_mean

    assert run.raised == 1
    assert [flag.student_id for flag in Flag.objects.all()] == [deviates.id]
    assert flags_for(uniform) == []


def test_a_uniformly_weak_student_is_still_reachable(cohort):
    """The escape hatch, and its guard rail.

    A student who is weak everywhere has a low median too, so the baseline
    test alone would never fire for them -- which would mean the weakest
    students in an institute are the only ones nobody is told about. The
    `struggling` branch handles it, but it is conditioned on the median
    *also* being low, so it cannot become the universal bypass a bare
    `mastery < 0.30` would be.
    """
    f.teach_everything(cohort)
    student = build_student(cohort, "Struggling", weak="wwwwwwww", filler="cwwwwwww",
                            roll="STR")

    run = evaluate(cohort)

    assert run.raised == 1
    flag = Flag.objects.get(student=student)
    assert flag.evidence["mastery_pct"] == 0
    assert flag.evidence["personal_median_mastery_pct"] < 50


# ------------------------------------------------- hygiene 3: cooldown


def test_a_second_raise_is_suppressed_while_the_first_is_open(cohort):
    """Re-raising a type already on the mentor's list turns a queue into a wall.

    Also what makes `run_detectors` safe to run nightly: the second run of
    the same day writes nothing.
    """
    f.teach_everything(cohort)
    build_student(cohort, "Repeat", weak="ccwwwwww", filler="cccccccw")

    first = evaluate(cohort)
    assert first.raised == 1

    second = evaluate(cohort, as_of=AS_OF + dt.timedelta(days=1))

    assert second.raised == 0
    assert second.suppressed == 1
    assert Flag.objects.count() == 1, "a duplicate flag was written"
    assert (
        second.candidates[0].suppressed_by
        == "an open flag for this student, type and topic already exists"
    )


def test_cooldown_holds_after_the_flag_is_resolved(cohort):
    """Closed, but still inside the fortnight: nothing new to tell a mentor.

    The window is the mock cadence -- flagging the same student for the
    same thing between two mocks repeats what they read the first time.
    """
    f.teach_everything(cohort)
    build_student(cohort, "Resolved", weak="ccwwwwww", filler="cccccccw")
    evaluate(cohort)
    Flag.objects.update(resolved_at=AS_OF + dt.timedelta(days=1), outcome=Flag.UNKNOWN)

    run = evaluate(cohort, as_of=AS_OF + dt.timedelta(days=5))

    assert run.raised == 0
    assert run.candidates[0].suppressed_by == "cooldown: last raised 5d ago, window 14d"
    assert Flag.objects.count() == 1


def test_the_flag_can_be_raised_again_once_the_window_has_passed(cohort):
    """Run through the wall clock, not through `as_of`.

    `run_detectors` defaults to `timezone.now()`, and that default is the
    path the nightly job actually takes -- so freeze the clock rather than
    passing a timestamp, or the production code path goes untested.
    """
    f.teach_everything(cohort)
    build_student(cohort, "Returning", weak="ccwwwwww", filler="cccccccw")
    features.recompute(cohort.institute.id, as_of=AS_OF)

    with freeze_time(AS_OF):
        det.run_detectors(cohort.institute.id, only=["weak_topic"])
    Flag.objects.update(resolved_at=AS_OF + dt.timedelta(days=1))

    with freeze_time(AS_OF + dt.timedelta(days=13)):
        assert det.run_detectors(cohort.institute.id, only=["weak_topic"]).raised == 0
    with freeze_time(AS_OF + dt.timedelta(days=15)):
        assert det.run_detectors(cohort.institute.id, only=["weak_topic"]).raised == 1

    assert Flag.objects.count() == 2
    assert det.DEFAULT_COOLDOWN_DAYS == 14


def test_a_dry_run_reports_what_it_would_do_and_writes_nothing(cohort):
    """Dry-running is how a detector gets tuned, so it has to be honest
    about the cooldown as well as about the firing."""
    f.teach_everything(cohort)
    build_student(cohort, "Dry", weak="ccwwwwww", filler="cccccccw")
    features.recompute(cohort.institute.id, as_of=AS_OF)

    run = det.run_detectors(
        cohort.institute.id, as_of=AS_OF, only=["weak_topic"], dry_run=True
    )

    assert run.raised == 1
    assert run.by_type() == {"weak_topic": 1}
    assert Flag.objects.count() == 0


# ------------------------------------------------------ the registry


def test_every_registered_detector_declares_its_hygiene_rules(cohort):
    """Rules 1 and 2 are prose on the class and are shown to mentors.

    An empty `min_evidence` or `baseline` means a detector shipped without
    anyone having to say what evidence stands behind it.
    """
    assert det.REGISTRY, "the detector registry is empty"
    for name, detector in det.REGISTRY.items():
        assert detector.type == name
        assert detector.min_evidence, f"{name} declares no minimum evidence"
        assert detector.baseline, f"{name} declares no personal baseline"
        assert detector.rule_version, f"{name} has no rule_version"
        assert detector.cooldown_days > 0, f"{name} has no cooldown"
        assert detector.tier in (0, 1)


def test_one_bad_detector_does_not_take_down_the_nightly_run(cohort, monkeypatch):
    """Eight detectors, one exception, seven flags -- not zero.

    A nightly job that fails whole is a nightly job that silently stops
    producing anything the first time an edge case appears in one rule.
    """
    f.teach_everything(cohort)
    build_student(cohort, "Survivor", weak="ccwwwwww", filler="cccccccw")
    features.recompute(cohort.institute.id, as_of=AS_OF)

    def explode(self, student):
        raise ZeroDivisionError("bad rule")

    monkeypatch.setattr(det.PlateauDetector, "evaluate", explode)
    run = det.run_detectors(
        cohort.institute.id, as_of=AS_OF, only=["weak_topic", "plateau"]
    )

    assert run.raised == 1
    assert Flag.objects.count() == 1


def test_the_per_student_budget_holds_back_the_least_severe(cohort):
    """Eight flags on one name is not eight times the information.

    Cooldown stops the *same* flag repeating; it does nothing about several
    detectors all firing on one struggling student on the same night. The
    budget keeps the console a queue rather than a log.
    """
    f.teach_everything(cohort)
    student = build_student(cohort, "Swamped", weak="ccwwwwww", filler="cccccccw")
    features.recompute(cohort.institute.id, as_of=AS_OF)

    # Two types that both fire, then a budget of one.
    Flag.objects.all().delete()
    run = det.run_detectors(
        cohort.institute.id, as_of=AS_OF, only=["weak_topic"], max_per_student=0
    )

    assert run.raised == 0
    assert run.suppressed == 1
    assert "budget" in run.candidates[0].suppressed_by
    assert det.MAX_FLAGS_PER_STUDENT == 3
