"""Answer-key disagreements: listing them, and recording what a person decided.

The factory solves every official question blind and compares with NTA's key;
where they differ the question loads as `verification = "disagreed"`. These
tests hold the review loop to its promises: every disagreement is listed
(reviewed or not), a decision records who, what and when and keeps the
history, each decision moves `verification` to the state that says what is
now known about the key, and nothing here is reachable by a student or by
another institute.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.ingestion.models import QuestionOption, QuestionTopicMap, Source
from apps.ingestion.services import review
from tests import factories as f

pytestmark = pytest.mark.usefixtures("fast_password_hasher")

LIST = "/api/review/disagreements/"


def official_question(paper, label, *, verification, official="2", model="4", **detail):
    q = QuestionTopicMap.objects.create(
        institute_id=paper.institute_id, test_paper=paper, question_id=label,
        topic=None, subject_name="Physics", question_text=f"{label}. A block slides…",
        source=Source.OFFICIAL_PYQ, official_answer=official, model_answer=model,
        verification=verification, has_diagram=detail.pop("has_diagram", False),
        verification_detail={
            "why": "model's blind answer differs from the official key",
            "model_confidence": "low", "model_working": "Resolve forces… so (4).",
            "model_issue": "figure partly illegible", "read_issues": ["option 3 superscript"],
            "agent_review": "probably the model misread the figure", **detail,
        },
    )
    QuestionOption.objects.bulk_create([
        QuestionOption(question=q, label=lb, text=f"option {lb}", is_correct=(lb == official))
        for lb in "1234"
    ])
    return q


@pytest.fixture
def queue(cohort, mentor_client):
    paper = f.make_paper(cohort, "JEE Main 2026 · 2 Apr · Shift 1", cohort.batch.exam_date,
                         source=Source.OFFICIAL_PYQ)
    return type("Queue", (), dict(
        cohort=cohort, client=mentor_client, paper=paper,
        q1=official_question(paper, "Q1", verification="disagreed"),
        q2=official_question(paper, "Q2", verification="disagreed", has_diagram=True),
        agreed=official_question(paper, "Q3", verification="agreed", model="2"),
    ))


def rows(client, query=""):
    response = client.get(LIST + query)
    assert response.status_code == 200, response.content
    return response.json()["results"]


def decide(queue, question, decision, note="checked against the NTA solution"):
    return queue.client.post(f"{LIST}{question.id}/", {"decision": decision, "note": note},
                             format="json")


# -------------------------------------------------------------------- listing


def test_every_disagreement_is_listed_with_what_a_reviewer_needs(queue):
    listed = rows(queue.client)
    assert [r["label"] for r in listed] == ["Q1", "Q2"], "an agreed question is not a disagreement"
    q1 = listed[0]
    assert (q1["official_answer"], q1["model_answer"], q1["verification"]) == ("2", "4", "disagreed")
    assert q1["paper_name"] == queue.paper.name and q1["subject"] == "Physics"
    assert [(o["label"], o["is_correct"]) for o in q1["options"]] == [
        ("1", False), ("2", True), ("3", False), ("4", False)]
    assert q1["review"] == {"status": "unreviewed", "note": "", "reviewed_by": None, "reviewed_at": None}
    summary = q1["detail_summary"]
    assert "Model answered 4 (low confidence); official key 2." in summary
    assert "figure partly illegible" in summary and "option 3 superscript" in summary
    # The factory agent's note is shown — and labelled as not a review.
    assert "Agent's first look (not a human review): probably the model misread" in summary
    assert q1["model_working"] == "Resolve forces… so (4)."


# ------------------------------------------------------------------- deciding


def test_key_stands_records_who_what_and_when_and_trusts_the_key(queue, cohort):
    response = decide(queue, queue.q1, "key_stands")
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["verification"] == "key_stands"
    assert body["review"]["status"] == "key_stands"
    assert body["review"]["note"] == "checked against the NTA solution"
    assert body["review"]["reviewed_by"] == "mentor-fixture" and body["review"]["reviewed_at"]

    queue.q1.refresh_from_db()
    assert queue.q1.key_trusted and queue.q1.key_reviewed_by.username == "mentor-fixture"
    [entry] = queue.q1.verification_detail["key_reviews"]
    assert (entry["decision"], entry["verification_before"]) == ("key_stands", "disagreed")
    # The machine's evidence is untouched.
    assert queue.q1.model_answer == "4" and queue.q1.verification_detail["model_confidence"] == "low"


def test_each_decision_sets_its_own_state_of_trust(queue):
    assert decide(queue, queue.q1, "key_wrong").json()["verification"] == "key_wrong"
    assert decide(queue, queue.q2, "unclear").json()["verification"] == "key_unclear"
    for q in (queue.q1, queue.q2):
        q.refresh_from_db()
        assert not q.key_trusted, q.verification


def test_the_queue_shrinks_as_decisions_are_made_and_filters_by_them(queue):
    assert review.unreviewed_count(queue.cohort.institute.id) == 2
    decide(queue, queue.q1, "unclear")
    # Reviewed, even though not settled: progress the queue must show.
    assert review.unreviewed_count(queue.cohort.institute.id) == 1
    assert [r["label"] for r in rows(queue.client, "?status=unreviewed")] == ["Q2"]
    assert [r["label"] for r in rows(queue.client, "?status=reviewed")] == ["Q1"]
    assert [r["label"] for r in rows(queue.client, "?status=unclear")] == ["Q1"]
    assert rows(queue.client, "?status=key_wrong") == []
    assert len(rows(queue.client)) == 2, "a decided question stays in the list"
    assert [r["label"] for r in rows(queue.client, f"?paper={queue.paper.id}")] == ["Q1", "Q2"]


def test_a_later_decision_replaces_an_earlier_one_and_both_are_kept(queue):
    decide(queue, queue.q1, "unclear", note="needs the physics head")
    body = decide(queue, queue.q1, "key_stands", note="physics head confirmed (2)").json()
    assert body["verification"] == "key_stands" and body["review"]["note"] == "physics head confirmed (2)"
    queue.q1.refresh_from_db()
    assert [e["decision"] for e in queue.q1.verification_detail["key_reviews"]] == ["unclear", "key_stands"]
    assert queue.q1.verification_detail["key_reviews"][1]["verification_before"] == "key_unclear"


def test_a_key_found_wrong_cannot_then_have_its_options_tagged(queue):
    f.misconception("MIS-SIGN-FIELD", subject="Physics")
    decide(queue, queue.q1, "key_wrong")
    response = queue.client.patch(
        f"/api/papers/{queue.paper.id}/questions/{queue.q1.id}/",
        {"options": [{"label": "4", "misconception_code": "MIS-SIGN-FIELD"}]}, format="json",
    )
    assert response.status_code == 400
    assert "answer key wrong" in response.json()["options"][0]["misconception_code"][0]
    # The same tag on a key that stands goes through.
    decide(queue, queue.q1, "key_stands")
    assert queue.client.patch(
        f"/api/papers/{queue.paper.id}/questions/{queue.q1.id}/",
        {"options": [{"label": "4", "misconception_code": "MIS-SIGN-FIELD"}]}, format="json",
    ).status_code == 200


@pytest.mark.parametrize("body", [{}, {"decision": "maybe"}, {"decision": "agreed"}])
def test_a_bad_decision_is_a_400_and_changes_nothing(queue, body):
    response = queue.client.post(f"{LIST}{queue.q1.id}/", body, format="json")
    assert response.status_code == 400 and "decision" in response.json()
    queue.q1.refresh_from_db()
    assert (queue.q1.verification, queue.q1.key_review) == ("disagreed", "")


# ----------------------------------------------------------------- who may ask


def test_not_a_disagreement_not_yours_and_not_there_all_look_the_same(queue, other_cohort):
    agreed = queue.client.post(f"{LIST}{queue.agreed.id}/", {"decision": "key_stands"}, format="json")
    missing = queue.client.post(f"{LIST}999999/", {"decision": "key_stands"}, format="json")
    stranger = APIClient()
    stranger.force_login(f.make_mentor_user(other_cohort, "stranger-review"))
    theirs = stranger.post(f"{LIST}{queue.q1.id}/", {"decision": "key_wrong"}, format="json")
    assert agreed.status_code == missing.status_code == theirs.status_code == 404
    assert agreed.json() == missing.json() == theirs.json()
    assert rows(stranger) == []
    queue.agreed.refresh_from_db()
    queue.q1.refresh_from_db()
    assert queue.agreed.verification == "agreed" and queue.q1.verification == "disagreed"


def test_a_superuser_sees_and_decides_only_in_the_institute_they_name(queue, other_cohort):
    """Row-level security does not apply to a superuser; the filter must."""
    root = APIClient()
    root.force_login(f.UserFactory(username="root-review", is_superuser=True, is_staff=True))
    own, other = queue.cohort.institute.id, other_cohort.institute.id
    assert len(rows(root, f"?institute={own}")) == 2
    assert rows(root, f"?institute={other}") == [] and rows(root) == []
    refused = root.post(f"{LIST}{queue.q1.id}/?institute={other}", {"decision": "key_wrong"},
                        format="json")
    assert refused.status_code == 404
    queue.q1.refresh_from_db()
    assert queue.q1.verification == "disagreed"


def test_students_cannot_see_or_decide(queue):
    student = APIClient()
    student.force_login(f.make_student_user(f.make_student(queue.cohort, "S"), "s-review"))
    assert student.get(LIST).status_code == 403
    assert student.post(f"{LIST}{queue.q1.id}/", {"decision": "key_wrong"}, format="json") \
        .status_code == 403
