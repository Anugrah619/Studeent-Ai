"""The official NTA syllabus trees and their loader.

Two promises are tested here. First, the committed JSON files keep the
open-book rule: every chapter cites a page of the official PDF and states
its NCERT link explicitly (a list, or null for "no counterpart"). Second,
loading them never disturbs what an institute already has — the existing
version, its topics and the batch bound to it are left exactly as they were.
"""

from __future__ import annotations

import json
import re
from io import StringIO
from pathlib import Path

import pytest
from django.conf import settings
from django.core.management import CommandError, call_command

from apps.syllabus.management.commands.load_official_syllabus import validate
from apps.syllabus.models import Exam, SyllabusVersion, Topic

DATA = Path(settings.BASE_DIR).parent / "data" / "syllabus"
FILES = {"JEE_MAIN": ("jee_main_2026.json", 11), "NEET_UG": ("neet_ug_2026.json", 15)}
PDF = re.compile(r"^https://ncert\.nic\.in/textbook/pdf/[kl]e(ph|ch|mh|bo)[12]\d\d\.pdf$")


def tree(code: str) -> dict:
    return json.loads((DATA / FILES[code][0]).read_text(encoding="utf-8"))


def chapters(t: dict):
    for s in t["subjects"]:
        for u in s["units"]:
            for c in u["chapters"]:
                yield s, u, c


@pytest.mark.parametrize("code", sorted(FILES))
def test_every_chapter_cites_a_page_and_an_explicit_ncert_link(code):
    t = tree(code)
    assert validate(t, DATA / FILES[code][0]) == []
    last_page = FILES[code][1]
    for s, u, c in chapters(t):
        assert 1 <= c["page"] <= last_page, (u["name"], c["name"])
        assert set(c["pages"]) >= {c["page"]}
        if c["ncert_ref"] is None:
            # A null link must say why, so "unknown" never hides as "none".
            assert c.get("ncert_note"), f"{c['name']}: null ncert_ref without a note"
            continue
        assert c["ncert_ref"], f"{c['name']}: empty list — use null"
        for r in c["ncert_ref"]:
            assert r["class"] in (11, 12)
            assert r["chapter"] >= 1 and r["title"]
            assert PDF.match(r["pdf"]), r["pdf"]


def test_exam_marking_matches_the_bulletins():
    jee, neet = tree("JEE_MAIN")["exam"], tree("NEET_UG")["exam"]
    assert (jee["marks_correct"], jee["marks_wrong"], jee["total_marks"]) == (4, -1, 300)
    assert (neet["marks_correct"], neet["marks_wrong"], neet["total_marks"]) == (4, -1, 720)
    assert jee["pattern_source"]["pages"] and neet["pattern_source"]["pages"]


def test_neet_biology_sections_are_never_claimed_as_official():
    for s, u, c in chapters(tree("NEET_UG")):
        if s["name"] != "Biology":
            assert "paper_section" not in c
            continue
        ps = c["paper_section"]
        assert ps["section"] in ("Botany", "Zoology")
        assert ps["basis"] in ("content", "convention")
        assert ps["why"]


@pytest.mark.django_db
def test_loader_adds_inactive_versions_and_leaves_the_existing_tree_alone(cohort):
    before = {
        t.pk: (t.name, t.kind, t.parent_id, t.weight, t.position, t.ncert_ref)
        for t in Topic.objects.filter(syllabus=cohort.syllabus)
    }
    slug = cohort.institute.slug

    call_command("load_official_syllabus", exam="JEE_MAIN", institute=slug, stdout=StringIO())
    call_command("load_official_syllabus", exam="NEET_UG", institute=slug, stdout=StringIO())

    # The original version, its topics and its batch are untouched.
    cohort.syllabus.refresh_from_db()
    cohort.batch.refresh_from_db()
    assert cohort.syllabus.is_active and cohort.syllabus.version == 1
    assert cohort.batch.syllabus_id == cohort.syllabus.pk
    assert before == {
        t.pk: (t.name, t.kind, t.parent_id, t.weight, t.position, t.ncert_ref)
        for t in Topic.objects.filter(syllabus=cohort.syllabus)
    }
    # Exactly one active version per institute: the seed commands rely on it.
    assert SyllabusVersion.objects.filter(institute=cohort.institute, is_active=True).count() == 1

    jee = SyllabusVersion.objects.get(institute=cohort.institute, exam__code="JEE_MAIN", version=2)
    neet = SyllabusVersion.objects.get(institute=cohort.institute, exam__code="NEET_UG")
    assert not jee.is_active and not neet.is_active
    assert jee.note.startswith("Official NTA 2026") and neet.note.startswith("Official NTA 2026")

    exam = Exam.objects.get(code="NEET_UG")
    assert (exam.marks_correct, exam.marks_wrong, exam.total_marks) == (4, -1, 720)

    for version, code in ((jee, "JEE_MAIN"), (neet, "NEET_UG")):
        expected = list(chapters(tree(code)))
        loaded = Topic.objects.filter(syllabus=version, kind=Topic.CHAPTER)
        assert loaded.count() == len(expected)
        assert loaded.filter(ncert_ref__isnull=False).count() == sum(1 for *_, c in expected if c["ncert_ref"])
        # Weights are counted from past papers later, never estimated here.
        assert set(Topic.objects.filter(syllabus=version).values_list("weight", flat=True)) == {1.0}

    subjects = list(
        Topic.objects.filter(syllabus=neet, kind=Topic.SUBJECT).order_by("position").values_list("name", flat=True)
    )
    assert subjects == ["Physics", "Chemistry", "Botany", "Zoology"]
    animal_kingdom = Topic.objects.get(syllabus=neet, name="Animal Kingdom")
    assert animal_kingdom.parent.name == "Diversity in Living World"
    assert animal_kingdom.parent.parent.name == "Zoology"
    assert animal_kingdom.ncert_ref[0]["title"] == "Animal Kingdom"


@pytest.mark.django_db
def test_loader_is_a_no_op_on_rerun(cohort):
    slug = cohort.institute.slug
    call_command("load_official_syllabus", exam="NEET_UG", institute=slug, stdout=StringIO())
    out = StringIO()
    call_command("load_official_syllabus", exam="NEET_UG", institute=slug, stdout=out)
    assert "already loaded" in out.getvalue()
    assert SyllabusVersion.objects.filter(institute=cohort.institute, exam__code="NEET_UG").count() == 1


@pytest.mark.django_db
def test_loader_refuses_to_rescore_an_existing_exam(cohort):
    Exam.objects.filter(code="JEE_MAIN").update(total_marks=360)
    with pytest.raises(CommandError, match="Not changing it"):
        call_command("load_official_syllabus", exam="JEE_MAIN", institute=cohort.institute.slug, stdout=StringIO())
