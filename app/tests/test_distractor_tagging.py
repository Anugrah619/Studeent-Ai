"""Describing an institute's paper so it can be diagnosed.

The loop under test, end to end: an institute makes a paper, uploads a
blueprint (chapter and key only — options with no text, no misconception) and
a results file. The diagnosis endpoint answers 422 "options not described".
A mentor tags the wrong options through `PATCH /api/papers/{id}/questions/{pk}/`
and the same diagnosis — with the model faked — comes back 200, built on the
tag they set.

Around it, the rules that keep a tag honest: never on the correct option, only
from the taxonomy, only of the question's subject, a proposal counts for
nothing, all or nothing, tenant-scoped, console-only.
"""

from __future__ import annotations

import json

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.api.views import DIAGNOSIS_NO_TAGS
from apps.ingestion.models import QuestionOption, QuestionTopicMap
from apps.ingestion.models import TestPaper as Paper
from apps.ingestion.services.tagging import canonical_subject
from apps.reasoning.models import ReasoningTrace
from apps.reasoning.services import gemini
from tests import factories as f
from tests.test_gemini_client import FakeGemini

pytestmark = pytest.mark.usefixtures("fast_password_hasher")

BLUEPRINT = """question_id,chapter,correct_option,answer
Q1,Kinematics,B,
Q2,Kinematics,A,
Q3,Thermodynamics,D,
Q4,Limits,,7
Q5,Limits,C,
"""

#: Bhavna chose C on Q1 (key B) — the wrong answer the diagnosis is about.
RESULTS = """roll_no,Q1,Q2,Q3,Q4,Q5
A-1,B,A,D,7,C
A-2,C,-,NR,8,A
"""

DIAGNOSIS = {
    "headline": "Reads an average velocity as the instantaneous one — 5 marks.",
    "pattern_found": True,
    "hypotheses": [{
        "misconception_code": "MIS-KIN-AVG",
        "claim": "Uses the average over the interval where the instant was asked.",
        "confidence": "low",
        "evidence_questions": ["Q1"],
        "counter_evidence": "",
        "marks_at_stake": 5,
    }],
    "recommended_action": "Work two instantaneous-velocity graphs at the board.",
    "time_to_fix": "minutes",
}


def csv_file(text: str, name: str):
    return SimpleUploadedFile(name, text.encode(), content_type="text/csv")


@pytest.fixture
def paper(cohort, mentor_client):
    """A blueprint paper with two students' results on it, and a small taxonomy."""
    students = {roll: f.make_student(cohort, name, roll_no=roll)
                for name, roll in [("Aarav", "A-1"), ("Bhavna", "A-2")]}
    made = mentor_client.post("/api/papers/", {"name": "Mock 16", "exam": "JEE_MAIN",
                                               "held_on": "2026-10-11"}, format="json")
    assert made.status_code == 201, made.content
    p = Paper.objects.get(pk=made.json()["id"])
    assert mentor_client.post(f"/api/papers/{p.id}/blueprint/",
                              {"file": csv_file(BLUEPRINT, "bp.csv")},
                              format="multipart").status_code == 200
    assert mentor_client.post("/api/ingest/results/",
                              {"file": csv_file(RESULTS, "r.csv"), "paper": p.id},
                              format="multipart").status_code == 201
    taxonomy = {
        "avg": f.misconception("MIS-KIN-AVG", subject="Physics", name="Average for instantaneous"),
        "rel": f.misconception("MIS-KIN-RELVEL", subject="Physics", name="Wrong frame"),
        "cat": f.misconception("MIS-EQM-CATALYST", subject="Chemistry", name="Catalyst shifts K"),
        "sq": f.misconception("MIS-ALG-SQUARE", subject="Mathematics", name="Extraneous roots"),
        "bio": f.misconception("MIS-BIO-OSMO", subject="Biology", name="Osmosis backwards"),
    }
    q = {x.question_id: x for x in QuestionTopicMap.objects.filter(test_paper=p)}
    return type("Paper", (), dict(cohort=cohort, client=mentor_client, paper=p, q=q,
                                  students=students, taxonomy=taxonomy))


def url(paper, label=None):
    base = f"/api/papers/{paper.paper.id}/questions/"
    return base if label is None else f"{base}{paper.q[label].id}/"


def patch(paper, label, body):
    return paper.client.patch(url(paper, label), body, format="json")


def option(paper, label, letter) -> QuestionOption:
    return paper.q[label].options.get(label=letter)


# ------------------------------------------------------------------- reading


def test_a_blueprint_paper_lists_every_question_with_nothing_described(paper):
    response = paper.client.get(url(paper))
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["paper_id"] == paper.paper.id and body["paper_source"] == "institute"
    assert body["summary"] == {"questions": 5, "with_text": 0, "wrong_options": 12,
                               "wrong_options_tagged": 0, "wrong_options_with_draft": 0}
    q1 = next(q for q in body["questions"] if q["label"] == "Q1")
    assert (q1["topic"], q1["subject"], q1["answer_type"], q1["correct_option"]) == \
        ("Kinematics", "Physics", "mcq", "B")
    assert q1["has_answers"] is True and q1["verification"] == ""
    assert [(o["label"], o["is_correct"], o["misconception"], o["draft_misconception"])
            for o in q1["options"]] == [("A", False, None, None), ("B", True, None, None),
                                        ("C", False, None, None), ("D", False, None, None)]
    q4 = next(q for q in body["questions"] if q["label"] == "Q4")
    assert q4["answer_type"] == "numerical" and q4["options"] == [] and q4["correct_option"] is None
    assert q4["official_answer"] == "7"


# ---------------------------------------------------------------- the loop


def test_tagging_the_wrong_options_turns_a_422_into_a_diagnosis(paper, monkeypatch):
    bhavna = paper.students["A-2"]
    diagnosis = f"/api/students/{bhavna.id}/diagnosis/?paper={paper.paper.id}"

    before = paper.client.get(diagnosis)
    assert before.status_code == 422 and before.json()["detail"] == DIAGNOSIS_NO_TAGS

    tagged = patch(paper, "Q1", {
        "question_text": "A car's position is x = 2t². Its velocity at t = 3 s is",
        "options": [
            {"label": "A", "text": "6 m/s"},
            {"label": "B", "text": "12 m/s"},
            {"label": "C", "text": "6 m/s (average over 0–3 s)", "misconception_code": "MIS-KIN-AVG"},
            {"label": "D", "text": "18 m/s", "misconception_code": "mis-kin-relvel"},
        ],
    })
    assert tagged.status_code == 200, tagged.content
    assert {o["label"]: (o["misconception"] or {}).get("code") for o in tagged.json()["options"]} == \
        {"A": None, "B": None, "C": "MIS-KIN-AVG", "D": "MIS-KIN-RELVEL"}

    client = FakeGemini(json.dumps(DIAGNOSIS))
    monkeypatch.setattr(gemini, "_client", lambda: client)
    after = paper.client.get(diagnosis)
    assert after.status_code == 200, after.content
    body = after.json()
    assert body["tally"]["wrong_with_known_cause"] == 1
    assert body["hypotheses"][0]["evidence"][0]["question_id"] == paper.q["Q1"].id
    assert len(client.calls) == 1

    # And what the model was sent is the tag and the words the mentor wrote.
    trace = ReasoningTrace.objects.get(pk=body["trace_id"])
    wrong = {w["q"]: w for w in trace.context["wrong_answers"]}
    assert wrong["Q1"]["indicates"] == "MIS-KIN-AVG"
    assert wrong["Q1"]["option_text"].startswith("6 m/s (average")
    assert wrong["Q1"]["stem"].startswith("A car's position")
    # Q5 is still undescribed: wrong, and honestly without a cause.
    assert "indicates" not in wrong["Q5"]


def test_a_proposal_is_stored_as_a_draft_and_does_not_count(paper):
    response = patch(paper, "Q1", {"options": [{"label": "C", "draft_misconception": {
        "name": "Slope of the chord", "description": "I can take the average as the instant."}}]})
    assert response.status_code == 200, response.content
    c = option(paper, "Q1", "C")
    assert c.misconception_id is None, "a proposal must never become the tag"
    assert c.draft_misconception["status"] == "draft" and c.draft_misconception["proposed_by"] == "console"
    assert c.draft_misconception["belief"] == "I can take the average as the instant."
    shown = next(o for o in response.json()["options"] if o["label"] == "C")["draft_misconception"]
    assert shown == {"code": "", "name": "Slope of the chord",
                     "description": "I can take the average as the instant.",
                     "is_new": True, "proposed_by": "console", "status": "draft"}

    # Still nothing a diagnosis can use.
    bhavna = paper.students["A-2"]
    assert paper.client.get(f"/api/students/{bhavna.id}/diagnosis/?paper={paper.paper.id}") \
        .status_code == 422
    assert paper.client.get(url(paper)).json()["summary"]["wrong_options_with_draft"] == 1

    # A real tag resolves it.
    patch(paper, "Q1", {"options": [{"label": "C", "misconception_code": "MIS-KIN-AVG"}]})
    c.refresh_from_db()
    assert c.misconception.code == "MIS-KIN-AVG" and c.draft_misconception["status"] == "superseded"


def test_a_model_draft_accepted_by_its_own_code_is_marked_accepted(paper):
    QuestionOption.objects.filter(pk=option(paper, "Q1", "C").pk).update(
        draft_misconception_code="MIS-KIN-AVG",
        draft_misconception={"kind": "existing", "is_new": False, "name": "Avg", "belief": "b",
                             "trace_id": 7, "status": "draft"},
    )
    shown = next(o for o in paper.client.get(url(paper)).json()["questions"][0]["options"]
                 if o["label"] == "C")["draft_misconception"]
    assert (shown["code"], shown["proposed_by"], shown["is_new"]) == ("MIS-KIN-AVG", "model", False)
    assert patch(paper, "Q1", {"options": [{"label": "C", "misconception_code": "MIS-KIN-AVG"}]}) \
        .status_code == 200
    assert option(paper, "Q1", "C").draft_misconception["status"] == "accepted"


def test_null_removes_a_tag_and_a_draft(paper):
    patch(paper, "Q1", {"options": [{"label": "C", "misconception_code": "MIS-KIN-AVG"},
                                    {"label": "D", "draft_misconception": {"name": "n", "description": "d"}}]})
    response = patch(paper, "Q1", {"options": [{"label": "C", "misconception_code": None},
                                               {"label": "D", "draft_misconception": None}]})
    assert response.status_code == 200
    assert option(paper, "Q1", "C").misconception_id is None
    assert option(paper, "Q1", "D").draft_misconception is None


def test_retagging_a_question_students_have_answered_is_allowed(paper):
    """Unlike a key, a tag changes nobody's marks."""
    assert paper.client.get(url(paper)).json()["questions"][0]["has_answers"] is True
    for code in ("MIS-KIN-AVG", "MIS-KIN-RELVEL"):
        assert patch(paper, "Q1", {"options": [{"label": "c", "misconception_code": code}]}) \
            .status_code == 200, "a lower-case label names the same option"
    assert option(paper, "Q1", "C").misconception.code == "MIS-KIN-RELVEL"


def test_subject_spellings_match_and_the_summary_counts_them(paper):
    """`Mathematics` in the taxonomy fits a `Maths` question; Botany is Biology."""
    assert patch(paper, "Q5", {"options": [{"label": "A", "misconception_code": "MIS-ALG-SQUARE"}]}) \
        .status_code == 200
    assert canonical_subject("Botany") == canonical_subject("Zoology") == canonical_subject("Biology")
    assert paper.client.get(url(paper)).json()["summary"]["wrong_options_tagged"] == 1


# ------------------------------------------------------------- the refusals


def assert_nothing_written(paper):
    assert not QuestionOption.objects.filter(
        question__test_paper=paper.paper, misconception__isnull=False).exists()
    assert not QuestionTopicMap.objects.filter(test_paper=paper.paper).exclude(question_text="").exists()


def test_the_correct_option_cannot_carry_a_misconception_and_nothing_else_is_written(paper):
    response = patch(paper, "Q1", {
        "question_text": "would be written if the request were valid",
        "options": [{"label": "C", "misconception_code": "MIS-KIN-AVG"},
                    {"label": "B", "misconception_code": "MIS-KIN-AVG"}],
    })
    assert response.status_code == 400
    errors = response.json()["options"]
    assert errors[0] == {} and "correct option cannot carry" in errors[1]["misconception_code"][0]
    assert_nothing_written(paper)


def test_nor_can_it_carry_a_proposal(paper):
    response = patch(paper, "Q1", {"options": [{"label": "B", "draft_misconception": {
        "name": "n", "description": "d"}}]})
    assert response.status_code == 400
    assert "correct option" in response.json()["options"][0]["draft_misconception"][0]


@pytest.mark.parametrize("code, why", [
    ("MIS-NOPE", "not in the misconception taxonomy"),
    ("MIS-EQM-CATALYST", "is a Chemistry misconception; this is a Physics question"),
    ("MIS-BIO-OSMO", "is a Biology misconception"),
])
def test_a_tag_must_exist_and_fit_the_questions_subject(paper, code, why):
    response = patch(paper, "Q1", {"options": [{"label": "C", "misconception_code": code}]})
    assert response.status_code == 400
    assert why in response.json()["options"][0]["misconception_code"][0]
    assert_nothing_written(paper)


@pytest.mark.parametrize("body, why", [
    ({"options": [{"label": "E", "text": "x"}]}, "no option 'E'"),
    ({"options": [{"label": "C", "text": "x"}, {"label": "C", "text": "y"}]}, "more than once"),
    ({"options": [{"label": "C", "misconception_code": "MIS-KIN-AVG",
                   "draft_misconception": {"name": "n", "description": "d"}}]}, "not both"),
])
def test_malformed_option_edits_are_refused(paper, body, why):
    response = patch(paper, "Q1", body)
    assert response.status_code == 400
    assert why in json.dumps(response.json())


def test_a_numerical_question_has_no_options_to_describe(paper):
    response = patch(paper, "Q4", {"options": [{"label": "A", "text": "7"}]})
    assert response.status_code == 400 and "numerical" in response.json()["options"][0]
    # Its text and solution can still be written.
    ok = patch(paper, "Q4", {"question_text": "Evaluate the limit.", "solution": "L'Hôpital twice."})
    assert ok.status_code == 200 and ok.json()["solution"] == "L'Hôpital twice."


def test_a_question_whose_key_was_found_wrong_cannot_be_tagged(paper):
    QuestionTopicMap.objects.filter(pk=paper.q["Q1"].pk).update(verification="key_wrong")
    refused = patch(paper, "Q1", {"options": [{"label": "C", "misconception_code": "MIS-KIN-AVG"}]})
    assert refused.status_code == 400 and "found this question's answer key wrong" in json.dumps(refused.json())
    # Correcting the option text — the usual fix for a misread paper — is allowed.
    assert patch(paper, "Q1", {"options": [{"label": "C", "text": "fixed"}]}).status_code == 200


# --------------------------------------------------------------- who may ask


def test_another_institutes_paper_and_question_are_404s(paper, other_cohort):
    stranger = APIClient()
    stranger.force_login(f.make_mentor_user(other_cohort, "stranger"))
    missing = paper.client.get("/api/papers/999999/questions/")
    for response in (stranger.get(url(paper)), stranger.patch(url(paper, "Q1"), {}, format="json")):
        assert response.status_code == 404 and response.json() == missing.json()

    # A real question, but not on this paper.
    other = f.make_paper(paper.cohort, "Mock 17", paper.paper.held_on)
    foreign = f.ask(other, paper.cohort.chapter("Kinematics"), "Q1")
    response = paper.client.patch(f"/api/papers/{paper.paper.id}/questions/{foreign.id}/",
                                  {"question_text": "x"}, format="json")
    assert response.status_code == 404
    foreign.refresh_from_db()
    assert foreign.question_text != "x"


def test_a_superuser_is_held_to_the_institute_they_name(paper, other_cohort):
    """Superusers bypass row-level security, so for them the view's own
    institute filter is the only wall — this is the test that proves it holds."""
    root = APIClient()
    root.force_login(f.UserFactory(username="root-tag", is_superuser=True, is_staff=True))
    own, other = paper.cohort.institute.id, other_cohort.institute.id
    assert root.get(url(paper) + f"?institute={own}").status_code == 200
    assert root.get(url(paper) + f"?institute={other}").status_code == 404
    assert root.get(url(paper)).status_code == 404, "no institute named, nothing shown"
    refused = root.patch(url(paper, "Q1") + f"?institute={other}",
                         {"question_text": "written across tenants"}, format="json")
    assert refused.status_code == 404
    assert_nothing_written(paper)


def test_students_cannot_read_or_tag(paper):
    student = APIClient()
    student.force_login(f.make_student_user(paper.students["A-1"], "aarav-t"))
    assert student.get(url(paper)).status_code == 403
    assert student.patch(url(paper, "Q1"), {"question_text": "x"}, format="json").status_code == 403
    assert student.get("/api/misconceptions/").status_code == 403


# ------------------------------------------------------------- the taxonomy


def codes(response):
    assert response.status_code == 200, response.content
    return [m["code"] for m in response.json()["results"]]


def test_the_taxonomy_lists_by_subject_for_the_picker(paper):
    assert codes(paper.client.get("/api/misconceptions/?subject=Physics")) == \
        ["MIS-KIN-AVG", "MIS-KIN-RELVEL"]
    # The question's own subject spelling finds the taxonomy's.
    assert codes(paper.client.get("/api/misconceptions/?subject=Maths")) == ["MIS-ALG-SQUARE"]
    assert codes(paper.client.get("/api/misconceptions/?subject=Zoology")) == ["MIS-BIO-OSMO"]
    assert len(codes(paper.client.get("/api/misconceptions/"))) == 5
    entry = paper.client.get("/api/misconceptions/?subject=Chemistry").json()["results"][0]
    assert {"code", "subject", "name", "description"} <= set(entry)
