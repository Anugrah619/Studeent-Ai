"""Subjects come from the syllabus tree — so a NEET batch's Biology is visible.

"Physics, Chemistry, Maths" used to be typed into the read models and the
detectors. A NEET batch is Physics, Chemistry, Botany and Zoology, and against
the typed list its Biology was invisible: no row on the neglect chart, no
`subject_imbalance` flag for the subject it was neglecting, a mock total
missing half the paper.

The NEET cohort here is the *real* NEET UG 2026 tree, loaded by
`load_official_syllabus` from `data/syllabus/neet_ug_2026.json`, beside the
ordinary JEE cohort in the same institute — so every test also proves that two
syllabi in one tenant do not bleed into each other. And every JEE assertion is
the output exactly as it was before.
"""

from __future__ import annotations

import datetime as dt
from io import StringIO
from types import SimpleNamespace

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.api import rollups
from apps.derived.models import Flag
from apps.derived.services import detectors as det
from apps.derived.services import features
from apps.syllabus.models import SyllabusVersion, Topic
from apps.syllabus.services import subject_names, subjects_by_batch, subjects_for_student
from tests import factories as f
from tests.factories import AS_OF

pytestmark = pytest.mark.usefixtures("fast_password_hasher")

NEET_SUBJECTS = ["Physics", "Chemistry", "Botany", "Zoology"]
JEE_SUBJECTS = ["Physics", "Chemistry", "Maths"]


@pytest.fixture
def neet(cohort):
    call_command("load_official_syllabus", exam="NEET_UG", institute=cohort.institute.slug,
                 stdout=StringIO())
    syllabus = SyllabusVersion.objects.get(institute=cohort.institute, exam__code="NEET_UG")
    batch = f.BatchFactory(institute=cohort.institute, exam=syllabus.exam,
                           syllabus=syllabus, name="NEET Alpha")

    def chapter(subject: str, n: int = 0) -> Topic:
        return list(
            Topic.objects.filter(syllabus=syllabus, kind=Topic.CHAPTER,
                                 parent__parent__name=subject)
            .order_by("parent__position", "position")
        )[n]

    def student(name: str, roll: str):
        return f.StudentFactory(institute=cohort.institute, batch=batch, mentor=cohort.mentor,
                                name=name, roll_no=roll)

    def paper(name: str, held_on: dt.date):
        return f.TestPaperFactory(institute=cohort.institute, exam=syllabus.exam, name=name,
                                  held_on=held_on, total_questions=180, max_marks=720)

    return SimpleNamespace(syllabus=syllabus, batch=batch, chapter=chapter,
                           student=student, paper=paper)


@pytest.fixture
def mentor(cohort):
    from rest_framework.test import APIClient

    client = APIClient()
    client.force_login(f.make_mentor_user(cohort, "subjects-mentor"))
    return client


def rows_of(client, url):
    response = client.get(url)
    assert response.status_code == 200, response.content
    return response.json()["results"]


# ------------------------------------------------------------- the service


def test_neets_subjects_are_its_paper_sections_in_tree_order(cohort, neet):
    """Order is `position`, not the alphabet: alphabetical would put Botany first."""
    assert subject_names(neet.syllabus) == NEET_SUBJECTS
    assert subject_names(cohort.syllabus) == JEE_SUBJECTS
    assert subjects_for_student(neet.student("Neha", "N-1")) == NEET_SUBJECTS
    assert subjects_for_student(f.make_student(cohort, "Jai")) == JEE_SUBJECTS


def test_the_bulk_lookup_agrees_with_the_per_student_one_including_the_fallback(cohort, neet):
    """`subjects_by_batch` is what the detectors use; it must resolve exactly like
    `syllabus_for_student`, fallback to the newest active version included."""
    assert subjects_by_batch(cohort.institute.id, [cohort.batch.id, neet.batch.id]) == {
        cohort.batch.id: JEE_SUBJECTS, neet.batch.id: NEET_SUBJECTS,
    }
    # Unpinned, with no active NEET version: nothing to teach against.
    neet.batch.syllabus = None
    neet.batch.save(update_fields=["syllabus"])
    student = neet.student("Unpinned", "N-9")
    assert subjects_for_student(student) == []
    assert subjects_by_batch(cohort.institute.id, [neet.batch.id]) == {neet.batch.id: []}
    # Activate it, and both find it the same way.
    SyllabusVersion.objects.filter(pk=neet.syllabus.pk).update(is_active=True)
    student.batch.refresh_from_db()
    assert subjects_for_student(student) == NEET_SUBJECTS
    assert subjects_by_batch(cohort.institute.id, [neet.batch.id]) == {neet.batch.id: NEET_SUBJECTS}


# ---------------------------------------------------------------- read models


@pytest.fixture
def neha(neet):
    """One NEET mock: +12 Physics, +12 Chemistry, +7 Botany, -4 Zoology."""
    student = neet.student("Neha Iyer", "N-1")
    mock = neet.paper("NEET Mock 1", dt.date(2026, 9, 1))
    f.record(student, neet.chapter("Physics"), "ccc", paper=mock, question_prefix="P")
    f.record(student, neet.chapter("Chemistry"), "ccc", paper=mock, question_prefix="C")
    f.record(student, neet.chapter("Botany"), "ccw", paper=mock, question_prefix="B")
    f.record(student, neet.chapter("Zoology"), "wwww", paper=mock, question_prefix="Z")
    f.study(student, neet.chapter("Physics"), 60, AS_OF)
    f.study(student, neet.chapter("Botany"), 40, AS_OF)
    return SimpleNamespace(student=student, mock=mock)


def test_a_neet_mock_score_carries_every_subject_and_a_total_over_all_of_them(neha, mentor):
    [row] = rows_of(mentor, f"/api/students/{neha.student.id}/mock-scores/")
    assert row["subjects"] == [
        {"subject": "Physics", "marks": 12.0}, {"subject": "Chemistry", "marks": 12.0},
        {"subject": "Botany", "marks": 7.0}, {"subject": "Zoology", "marks": -4.0},
    ]
    # Every subject, not the legacy three: 12 + 12 + 7 - 4.
    assert row["total"] == 27.0
    # The legacy keys still say what they always said; NEET has no Maths.
    assert (row["physics"], row["chemistry"], row["maths"]) == (12.0, 12.0, 0.0)


def test_a_neet_breakdown_is_one_row_per_neet_subject_in_order(neha, mentor):
    rows = rows_of(mentor, f"/api/students/{neha.student.id}/subject-breakdown/")
    assert [r["subject"] for r in rows] == NEET_SUBJECTS
    by = {r["subject"]: r for r in rows}
    # Lost marks: Botany 1 wrong (5), Zoology 4 wrong (20) — 25 in all.
    assert by["Zoology"]["marks_lost_share_pct"] == 80.0
    assert by["Botany"]["marks_lost_share_pct"] == 20.0
    assert by["Botany"]["time_share_pct"] == 40.0 and by["Zoology"]["time_share_pct"] == 0.0
    assert by["Zoology"]["accuracy_pct"] == 0.0
    # Nothing on the chart is a JEE subject.
    assert "Maths" not in by


def test_the_student_sees_the_same_neet_rows_as_the_mentor(neha, mentor):
    from rest_framework.test import APIClient

    own = APIClient()
    own.force_login(f.make_student_user(neha.student, "neha"))
    for route in ("mock-scores", "subject-breakdown"):
        assert rows_of(own, f"/api/my/{route}/") == \
            rows_of(mentor, f"/api/students/{neha.student.id}/{route}/"), route


def test_jee_output_is_exactly_what_it_was(cohort, neet, mentor):
    """A NEET tree in the same institute changes nothing for a JEE student."""
    jai = f.make_student(cohort, "Jai")
    mock = f.make_paper(cohort, "Mock 1", dt.date(2026, 8, 1))
    f.record(jai, cohort.chapter("Kinematics"), "ccw", paper=mock, question_prefix="P")
    f.record(jai, cohort.chapter("Thermodynamics"), "cw", paper=mock, question_prefix="C")
    f.record(jai, cohort.chapter("Limits"), "c", paper=mock, question_prefix="M")

    [row] = rows_of(mentor, f"/api/students/{jai.id}/mock-scores/")
    assert {k: v for k, v in row.items() if k != "subjects"} == {
        "paper_id": mock.id, "paper_name": "Mock 1", "held_on": "2026-08-01",
        "physics": 7.0, "chemistry": 3.0, "maths": 4.0, "total": 14.0,
    }
    assert [(s["subject"], s["marks"]) for s in row["subjects"]] == [
        ("Physics", 7.0), ("Chemistry", 3.0), ("Maths", 4.0)]

    rows = rows_of(mentor, f"/api/students/{jai.id}/subject-breakdown/")
    assert [r["subject"] for r in rows] == JEE_SUBJECTS
    assert [r["marks_lost_share_pct"] for r in rows] == [50.0, 50.0, 0.0]


def test_a_subject_outside_the_syllabus_is_appended_not_dropped(cohort, neet):
    """A student who moved from a JEE batch to NEET keeps their old marks on the
    chart, after their own subjects — never silently left out of the total."""
    mover = neet.student("Mover", "N-7")
    old = f.make_paper(cohort, "JEE Mock", dt.date(2026, 7, 1))
    f.record(mover, cohort.chapter("Limits"), "cc", paper=old, question_prefix="M")
    [row] = rollups.mock_score_rows(cohort.institute.id, mover.id)
    assert [s["subject"] for s in row["subjects"]] == [*NEET_SUBJECTS, "Maths"]
    assert row["total"] == 8.0 and row["maths"] == 8.0
    rows = rollups.subject_breakdown_rows(cohort.institute.id, mover.id)
    assert [r["subject"] for r in rows] == [*NEET_SUBJECTS, "Maths"]


def test_another_institutes_student_gets_nothing(cohort, other_cohort, neha):
    assert rollups.mock_score_rows(other_cohort.institute.id, neha.student.id) == []
    assert rollups.subject_breakdown_rows(other_cohort.institute.id, neha.student.id) == []


# ------------------------------------------------------------------ detectors


def _sit(student, papers, chapters, pattern_by_subject):
    for i, paper in enumerate(papers):
        ts = timezone.make_aware(dt.datetime.combine(paper.held_on, dt.time(9, 0)))
        for subject, chapter in chapters.items():
            f.record(student, chapter, pattern_by_subject[subject], paper=paper, ts=ts,
                     question_prefix=f"P{i}-{subject[:3]}-")


def test_subject_imbalance_names_zoology_for_a_neet_student(cohort, neet):
    """The NEET shape of the Aarav flag. A typed list could never have said it."""
    student = neet.student("Zoya", "N-2")
    papers = [neet.paper(f"NEET Mock {i}", d) for i, d in
              enumerate([dt.date(2026, 7, 5), dt.date(2026, 7, 26), dt.date(2026, 8, 16)], 1)]
    chapters = {s: neet.chapter(s) for s in NEET_SUBJECTS}
    _sit(student, papers, chapters,
         {"Physics": "cccw", "Chemistry": "cccw", "Botany": "cccw", "Zoology": "wwww"})
    f.study_daily(student, {chapters["Physics"]: 60, chapters["Chemistry"]: 60,
                            chapters["Botany"]: 60, chapters["Zoology"]: 5}, days=15)

    # A JEE student neglecting Chemistry, in the same run: each is compared on
    # their own syllabus's subjects.
    jai = f.make_student(cohort, "Jai", roll_no="J-1")
    jee_papers = [f.make_paper(cohort, f"Mock {i}", p.held_on) for i, p in enumerate(papers, 1)]
    jee_chapters = {"Physics": cohort.chapter("Kinematics"),
                    "Chemistry": cohort.chapter("Hydrocarbons"), "Maths": cohort.chapter("Limits")}
    _sit(jai, jee_papers, jee_chapters, {"Physics": "cccw", "Chemistry": "wwww", "Maths": "cccw"})
    f.study_daily(jai, {jee_chapters["Physics"]: 60, jee_chapters["Chemistry"]: 5,
                        jee_chapters["Maths"]: 60}, days=15)

    features.recompute(cohort.institute.id, as_of=AS_OF)
    run = det.run_detectors(cohort.institute.id, as_of=AS_OF, only=["subject_imbalance"])
    assert run.raised == 2

    zoya = Flag.objects.get(student=student).evidence
    assert zoya["subject"] == "Zoology"
    assert [r["subject"] for r in zoya["by_subject"]] == NEET_SUBJECTS
    # 4 wrong x 5 marks a paper, against 1 wrong in each other subject.
    assert zoya["marks_lost_share_pct"] == pytest.approx(20 / 35 * 100, abs=0.1)
    assert zoya["rule_version"] == "v2"

    jee = Flag.objects.get(student=jai).evidence
    assert jee["subject"] == "Chemistry"
    assert [r["subject"] for r in jee["by_subject"]] == JEE_SUBJECTS
    assert Flag.objects.get(student=jai).headline.endswith(
        f"Chemistry is {jee['time_share_pct']:.0f}% of study time "
        f"but {jee['marks_lost_share_pct']:.0f}% of marks lost."
    )


def test_the_balance_index_sees_neet_only_subjects(cohort, neet):
    """All her study time goes to Botany and every mark she loses is in Zoology:
    the most lopsided preparation there is. Measured over a fixed
    Physics/Chemistry/Maths list both gaps were invisible and she read as
    perfectly balanced (0.0), which also hid it from `risk_score`."""
    from apps.derived.models import StudentState

    student = neet.student("Bina", "N-3")
    mock = neet.paper("NEET Mock 1", dt.date(2026, 9, 1))
    f.record(student, neet.chapter("Botany"), "cccc", paper=mock, question_prefix="B")
    f.record(student, neet.chapter("Zoology"), "wwww", paper=mock, question_prefix="Z")
    f.study_daily(student, {neet.chapter("Botany"): 60}, days=10)

    features.recompute(cohort.institute.id, [student.id], as_of=AS_OF)
    assert StudentState.objects.get(student=student).balance_index == 1.0
