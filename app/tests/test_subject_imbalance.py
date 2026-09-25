"""`subject_imbalance` on the Aarav shape -- the flag the product is sold on.

    "Chemistry is 11% of your study time and 46% of your lost marks."

Both halves are measured, neither is a ranking against anybody else, and
the fix is obvious from the numbers alone. That is why this is the flag
that closes, and why it is worth a file of its own.

The fixture below reproduces exactly that shape from events: three mock
papers, fifteen logged study days, and a Chemistry deficit built out of
individual wrong answers rather than asserted as a number. If the
detector's arithmetic drifts -- if it starts counting lost *questions*
instead of lost *marks*, say -- the headline stops reading 46% and this
file says so.
"""

from __future__ import annotations

import datetime as dt

import pytest
from django.utils import timezone

from apps.derived.models import Flag
from apps.derived.services import detectors as det
from apps.derived.services import features

from tests import factories as f
from tests.factories import AS_OF

pytestmark = pytest.mark.django_db


#: (correct, wrong) per chapter, per paper. Chemistry decays across the
#: three papers while Physics and Maths hold roughly steady -- and inside
#: Chemistry it is the Organic unit that collapses, which is what
#: `weakest_unit` should find.
PAPER_PLAN = [
    {
        "Kinematics": (3, 1), "Laws of Motion": (3, 1),
        "Current Electricity": (3, 1), "Magnetism": (3, 1),
        "Hydrocarbons": (1, 2), "Aldehydes and Ketones": (1, 2),
        "Thermodynamics": (3, 0), "Chemical Equilibrium": (3, 1),
        "Limits": (3, 1), "Definite Integration": (3, 1),
        "Quadratic Equations": (3, 1), "Matrices": (3, 1),
    },
    {
        "Kinematics": (3, 1), "Laws of Motion": (3, 1),
        "Current Electricity": (2, 1), "Magnetism": (2, 1),
        "Hydrocarbons": (1, 2), "Aldehydes and Ketones": (0, 2),
        "Thermodynamics": (2, 1), "Chemical Equilibrium": (3, 1),
        "Limits": (3, 1), "Definite Integration": (3, 1),
        "Quadratic Equations": (2, 1), "Matrices": (2, 0),
    },
    {
        "Kinematics": (2, 1), "Laws of Motion": (2, 1),
        "Current Electricity": (2, 1), "Magnetism": (2, 0),
        "Hydrocarbons": (0, 3), "Aldehydes and Ketones": (0, 2),
        "Thermodynamics": (2, 1), "Chemical Equilibrium": (2, 1),
        "Limits": (2, 1), "Definite Integration": (2, 1),
        "Quadratic Equations": (2, 1), "Matrices": (2, 0),
    },
]

PAPER_DATES = [dt.date(2026, 7, 5), dt.date(2026, 7, 26), dt.date(2026, 8, 16)]


def sit_papers(cohort, student, plan=PAPER_PLAN, dates=PAPER_DATES):
    papers = []
    for i, (day, chapters) in enumerate(zip(dates, plan)):
        paper = f.make_paper(cohort, f"Mock {i + 1}", day)
        papers.append(paper)
        ts = timezone.make_aware(dt.datetime.combine(day, dt.time(9, 0)))
        for chapter, (correct, wrong) in chapters.items():
            f.record(
                student, cohort.chapter(chapter), "c" * correct + "w" * wrong,
                paper=paper, ts=ts, question_prefix=f"P{i}-{chapter[:4]}-Q",
            )
    return papers


@pytest.fixture
def aarav(cohort):
    """Three mocks in decline, fifteen study days, Chemistry neglected."""
    f.teach_everything(cohort)
    student = f.make_student(cohort, "Aarav Mehta", roll_no="A101")
    papers = sit_papers(cohort, student)
    f.study_daily(
        student,
        {
            cohort.chapter("Kinematics"): 55,
            cohort.chapter("Limits"): 55,
            cohort.chapter("Thermodynamics"): 14,
        },
        days=15,
        ending=AS_OF,
    )
    return student, papers


def test_subject_imbalance_fires_on_the_aarav_shape(cohort, aarav):
    """The demo narrative, asserted as arithmetic over events."""
    student, _ = aarav
    features.recompute(cohort.institute.id, as_of=AS_OF)

    run = det.run_detectors(
        cohort.institute.id, as_of=AS_OF, only=["subject_imbalance"]
    )

    assert run.raised == 1
    flag = Flag.objects.get(student=student)
    e = flag.evidence

    assert e["subject"] == "Chemistry"
    assert e["time_share_pct"] == pytest.approx(11, abs=1)
    assert e["marks_lost_share_pct"] == pytest.approx(46, abs=1)
    assert e["gap_pts"] == pytest.approx(35, abs=1)
    assert e["marks_lost"] == 90.0          # 18 wrong answers x 5 marks each
    assert e["study_minutes"] == 210        # 14 min/day for 15 days
    assert e["papers"] == 3

    # The unit inside the subject a mentor should start with.
    assert e["weakest_unit"] == "Organic Chemistry"
    assert e["weakest_unit_mastery_pct"] < 30

    # Mocks falling while the effort goes elsewhere.
    assert e["marks_trend"] == -48

    assert flag.severity == Flag.CRITICAL
    assert flag.headline == (
        "Down 48 marks over 3 mocks. Chemistry is 11% of study time "
        "but 46% of marks lost."
    )

    # Every subject is reported, not only the worst -- the console draws
    # the whole neglect chart from this.
    assert [row["subject"] for row in e["by_subject"]] == ["Physics", "Chemistry", "Maths"]
    assert sum(row["marks_lost"] for row in e["by_subject"]) == 195.0


def test_the_flag_and_the_chart_cannot_disagree(cohort, aarav, client):
    """`subject_imbalance` and `/subject-breakdown/` read the same function.

    A flag that contradicts the chart it points at is worse than no flag:
    the mentor stops believing both. They share
    `features.marks_lost_by_topic`, and this asserts the sharing holds
    through the API layer.
    """
    student, _ = aarav
    features.recompute(cohort.institute.id, as_of=AS_OF)
    det.run_detectors(cohort.institute.id, as_of=AS_OF, only=["subject_imbalance"])
    evidence = Flag.objects.get(student=student).evidence

    client.force_login(f.make_mentor_user(cohort, username="mentor-chart"))
    payload = client.get(f"/api/students/{student.id}/subject-breakdown/").json()
    rows = payload["results"] if isinstance(payload, dict) else payload
    chart = {row["subject"]: row for row in rows}

    assert chart["Chemistry"]["marks_lost_share_pct"] == pytest.approx(
        evidence["marks_lost_share_pct"], abs=0.1
    )
    assert chart["Chemistry"]["time_share_pct"] == pytest.approx(
        evidence["time_share_pct"], abs=0.1
    )


def test_a_balanced_student_is_not_flagged(cohort):
    """Same papers, same marks lost -- study time pointed at the right subject.

    The detector must be measuring the *gap*, not the Chemistry score. If
    it starts firing here it has become "this student is weak at
    Chemistry", which is a ranking mentors already have.
    """
    f.teach_everything(cohort)
    student = f.make_student(cohort, "Balanced", roll_no="B101")
    sit_papers(cohort, student)
    f.study_daily(
        student,
        {
            cohort.chapter("Kinematics"): 30,
            cohort.chapter("Limits"): 28,
            cohort.chapter("Thermodynamics"): 50,   # ~46% of the time
        },
        days=15,
        ending=AS_OF,
    )
    features.recompute(cohort.institute.id, as_of=AS_OF)

    run = det.run_detectors(cohort.institute.id, as_of=AS_OF, only=["subject_imbalance"])

    assert run.raised == 0
    assert Flag.objects.count() == 0


@pytest.mark.parametrize(
    "papers,days,should_fire",
    [
        (3, 15, True),
        (2, 15, False),   # below MIN_PAPERS
        (3, 13, False),   # below MIN_LOGGED_DAYS
    ],
)
def test_minimum_evidence_for_subject_imbalance(cohort, papers, days, should_fire):
    """Two mocks is not a trend and thirteen logged days is not a habit."""
    f.teach_everything(cohort)
    student = f.make_student(cohort, "Evidence", roll_no="E101")
    sit_papers(cohort, student, plan=PAPER_PLAN[:papers], dates=PAPER_DATES[:papers])
    f.study_daily(
        student,
        {
            cohort.chapter("Kinematics"): 55,
            cohort.chapter("Limits"): 55,
            cohort.chapter("Thermodynamics"): 14,
        },
        days=days,
        ending=AS_OF,
    )
    features.recompute(cohort.institute.id, as_of=AS_OF)

    run = det.run_detectors(cohort.institute.id, as_of=AS_OF, only=["subject_imbalance"])

    assert det.SubjectImbalanceDetector.MIN_PAPERS == 3
    assert det.SubjectImbalanceDetector.MIN_LOGGED_DAYS == 14
    assert bool(run.raised) is should_fire


def test_marks_lost_prices_a_wrong_answer_above_a_skip(cohort):
    """The negative-marking asymmetry, at the source both readers share.

    Counting lost *questions* -- which is what `subject_breakdown` did
    before -- prices these identically and so understates exactly the
    subject a student is guessing their way through.
    """
    student = f.make_student(cohort, "Guesser", roll_no="G1")
    guessed = cohort.chapter("Hydrocarbons")
    skipped = cohort.chapter("Matrices")
    f.record(student, guessed, "wwwwww", question_prefix="G")
    f.record(student, skipped, "bbbbbb", question_prefix="S")

    lost = features.marks_lost_by_topic(cohort.institute.id, [student.id])[student.id]

    assert lost[guessed.id] == 30.0   # 6 x (4 not earned + 1 penalty)
    assert lost[skipped.id] == 24.0   # 6 x 4 not earned
    assert lost[guessed.id] > lost[skipped.id]


def test_a_second_detector_shares_the_per_student_budget(cohort, aarav):
    """Two flags on one student, a budget of one, the more severe survives."""
    student, _ = aarav
    features.recompute(cohort.institute.id, as_of=AS_OF)

    run = det.run_detectors(
        cohort.institute.id, as_of=AS_OF,
        only=["subject_imbalance", "weak_topic"], max_per_student=1,
    )

    assert run.raised == 1
    assert run.suppressed >= 1
    kept = Flag.objects.get(student=student)
    assert kept.severity == Flag.CRITICAL
    assert kept.type == "subject_imbalance"
