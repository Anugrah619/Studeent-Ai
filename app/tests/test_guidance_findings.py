"""`findings` — a diagnosis reaches a student only after their mentor agreed.

THE PRODUCT DECISION THIS FILE PINS
    A student sees an AI diagnosis **only** once their mentor has marked it
    `agreed`, and then reworded for them. Unreviewed and disagreed diagnoses
    are never shown — not hidden by the client, never sent. Students are
    minors: no misconception codes, no risk score, no flags.

FIVE CLASSES OF TEST
    1. Visibility: agreed only, mine only, newest agreed per paper.
    2. Links: only questions I answered, so each opens on `/api/my/questions/`.
    3. Rewording: done ahead of time (`reword_findings`, run nightly), never
       inside the student's own request; the model's words when it is
       reachable, cached per finding, a capped number of live calls per run,
       a cool-down after a failure.
    4. The fallback: a kind, deterministic template when it is not.
    5. Privacy: a structural scan of the payload that would leave the
       building, proven to catch a leak.
"""

from __future__ import annotations

import datetime as dt
import json
from types import SimpleNamespace

import pytest
from django.utils import timezone

from apps.reasoning.models import ReasoningTrace
from apps.reasoning.services import diagnose as dx
from apps.reasoning.services import gemini, guidance
from tests import factories as f
from tests.guidance_support import (
    ApiError,
    RecordingGemini,
    find_pii,
    identifiers,
    login,
    use,
)

pytestmark = [pytest.mark.django_db, pytest.mark.usefixtures("fast_password_hasher")]

REWORDED = {
    "title": "You flip the directing rule when it is not named (MIS-ORG-EAS)",
    "explanation": "On Q1 and Q5 you chose the option the reversed rule gives.",
    "what_to_do": "Redo Q1 and Q5, then ask your teacher to check your reasoning.",
}


@pytest.fixture
def world(cohort):
    cohort.mentor.name = "Priya Sharma"
    cohort.mentor.email = "priya.sharma@example.com"
    cohort.mentor.save()

    aarav = f.make_student(cohort, "Aarav Mehta", roll_no="R7741", target="AIR under 5000")
    bhavna = f.make_student(cohort, "Bhavna Rao", roll_no="R7742")
    a_user = f.make_student_user(aarav, "aarav")
    a_user.email = "aarav.mehta@gmail.com"
    a_user.save()

    eas = f.misconception("MIS-ORG-EAS", name="Directing effects reversed",
                          description="Believes deactivating groups direct ortho/para.")
    organic = cohort.chapter("Hydrocarbons")
    paper = f.make_paper(cohort, "Mock 15 — Diagnostic", dt.date(2026, 9, 14))
    q = {
        "Q1": f.ask(paper, organic, "Q1", "Nitration of toluene gives mainly?",
                    correct="A", baits={"B": eas}),
        "Q3": f.ask(paper, organic, "Q3", "The group is stated to be meta-directing.",
                    correct="C"),
        "Q5": f.ask(paper, organic, "Q5", "Which ring position is attacked?",
                    correct="A", baits={"C": eas}),
    }
    for student in (aarav, bhavna):
        f.answer(student, q["Q1"], "B")
        f.answer(student, q["Q3"], "C")
        f.answer(student, q["Q5"], "C")

    return SimpleNamespace(
        cohort=cohort, aarav=aarav, bhavna=bhavna, paper=paper, q=q, eas=eas,
        organic=organic,
        a=login(a_user),
        b=login(f.make_student_user(bhavna, "bhavna")),
        mentor=login(f.make_mentor_user(cohort, "mentor-f")),
    )


def model_output(student, *, headline="Has the directing-effects rule backwards — 10 marks.",
                 claim="Believes deactivating groups direct ortho/para (MIS-ORG-EAS).",
                 pattern_found=True, evidence=("Q1", "Q5")) -> dict:
    return {
        "headline": headline,
        "pattern_found": pattern_found,
        "hypotheses": [{
            "misconception_code": "MIS-ORG-EAS",
            "claim": claim,
            "confidence": "high",
            "evidence_questions": list(evidence),
            "counter_evidence": "Right on Q3, where the group was named outright.",
            "marks_at_stake": 10,
        }],
        "recommended_action": (
            f"Work through Q1 and Q5 with S-{student.id}, naming the group first."
        ),
        "time_to_fix": "one_session",
    }


def diagnosis(student, paper, verdict, **output) -> ReasoningTrace:
    """A stored diagnosis, exactly as `diagnose()` would have left it."""
    context = dx.build_context(student, paper)
    return ReasoningTrace.objects.create(
        institute_id=student.institute_id, student=student,
        task=ReasoningTrace.DIAGNOSE, context=context,
        context_hash=ReasoningTrace.hash_context(context),
        model="gemini-3.8-flash", prompt_version=dx.PROMPT_VERSION,
        output=model_output(student, **output), human_verdict=verdict,
    )


def findings(client) -> list[dict]:
    response = client.get("/api/my/guidance/")
    assert response.status_code == 200, response.content
    return response.json()["findings"]


def reword(student) -> list[dict]:
    """What the nightly job does for a student with approved findings."""
    return guidance.reword_findings(student)


@pytest.fixture
def no_key(monkeypatch):
    """No API key: the model is unavailable, nothing reaches the network."""
    use(monkeypatch, None)


# ============================================================ 1 · visibility


def test_an_agreed_diagnosis_is_shown(world, no_key):
    diagnosis(world.aarav, world.paper, ReasoningTrace.AGREED)
    [finding] = findings(world.a)
    assert finding["paper_id"] == world.paper.id
    assert finding["paper_name"] == "Mock 15 — Diagnostic"
    assert finding["title"] and finding["explanation"] and finding["what_to_do"]


@pytest.mark.parametrize("verdict", [ReasoningTrace.UNREVIEWED, ReasoningTrace.DISAGREED])
def test_an_unapproved_diagnosis_is_never_shown_or_even_reworded(world, monkeypatch, verdict):
    """Not filtered by the client: never sent, and never handed to a model to
    reword — a rewording of an unapproved diagnosis would itself be a leak
    waiting for a cache to serve it."""
    client = RecordingGemini(REWORDED)
    use(monkeypatch, client)
    diagnosis(world.aarav, world.paper, verdict, headline="UNAPPROVED HEADLINE",
              claim="UNAPPROVED CLAIM")

    response = world.a.get("/api/my/guidance/")
    assert response.json()["findings"] == []
    assert "UNAPPROVED" not in response.content.decode()
    assert reword(world.aarav) == []
    assert client.calls == []


def test_a_verdict_changed_to_disagreed_takes_it_away(world, no_key):
    trace = diagnosis(world.aarav, world.paper, ReasoningTrace.AGREED)
    assert len(findings(world.a)) == 1
    trace.human_verdict = ReasoningTrace.DISAGREED
    trace.save()
    assert findings(world.a) == []


def test_another_students_diagnosis_is_never_mine(world, no_key):
    """Same institute, same paper, same answers, agreed — and still not mine."""
    diagnosis(world.bhavna, world.paper, ReasoningTrace.AGREED, headline="HERS ALONE",
              claim="HER CLAIM")
    response = world.a.get("/api/my/guidance/")
    assert response.json()["findings"] == []
    assert "HER" not in response.content.decode()
    assert len(findings(world.b)) == 1


def test_another_institutes_agreed_diagnosis_is_never_mine(world, other_cohort, no_key):
    stranger = f.make_student(other_cohort, "Stranger")
    paper = f.make_paper(other_cohort, "Mock 15 — Diagnostic", dt.date(2026, 9, 14))
    diagnosis(stranger, paper, ReasoningTrace.AGREED)
    assert findings(world.a) == []


def test_the_newest_agreed_diagnosis_of_a_paper_wins(world, no_key):
    diagnosis(world.aarav, world.paper, ReasoningTrace.AGREED, claim="OLDER CLAIM")
    diagnosis(world.aarav, world.paper, ReasoningTrace.AGREED, claim="NEWER CLAIM")
    [finding] = findings(world.a)
    assert "NEWER CLAIM" in finding["explanation"]


def test_one_finding_per_paper_newest_approval_first(world, no_key):
    w = world
    later = f.make_paper(w.cohort, "Mock 16", dt.date(2026, 10, 5))
    q = f.ask(later, w.organic, "Q1", "Another nitration.", correct="A", baits={"B": w.eas})
    f.answer(w.aarav, q, "B")
    first = diagnosis(w.aarav, w.paper, ReasoningTrace.AGREED, evidence=("Q1",))
    second = diagnosis(w.aarav, later, ReasoningTrace.AGREED, evidence=("Q1",))
    ReasoningTrace.objects.filter(pk=first.pk).update(
        reviewed_at=timezone.now() - dt.timedelta(days=2))
    ReasoningTrace.objects.filter(pk=second.pk).update(
        reviewed_at=timezone.now() - dt.timedelta(days=1))
    assert [x["paper_name"] for x in findings(w.a)] == ["Mock 16", "Mock 15 — Diagnostic"]

    ReasoningTrace.objects.filter(pk=first.pk).update(reviewed_at=timezone.now())
    assert [x["paper_name"] for x in findings(w.a)] == ["Mock 15 — Diagnostic", "Mock 16"]


def test_a_diagnosis_over_every_paper_has_no_paper(world, no_key):
    diagnosis(world.aarav, None, ReasoningTrace.AGREED)
    [finding] = findings(world.a)
    assert finding["paper_id"] is None and finding["paper_name"] is None


def test_approved_at_is_when_the_mentor_agreed(world, no_key):
    """Recorded through the real verdict route — the one that names no time."""
    w = world
    diagnosis(w.aarav, w.paper, ReasoningTrace.UNREVIEWED)
    before = timezone.now()
    response = w.mentor.post(f"/api/students/{w.aarav.id}/diagnosis/verdict/",
                             {"verdict": "agreed"}, format="json")
    assert response.status_code == 200, response.content

    [finding] = findings(w.a)
    approved = dt.datetime.fromisoformat(finding["approved_at"])
    assert before <= approved <= timezone.now()


# ================================================================ 2 · links


def test_the_questions_link_to_my_own_answers_and_open(world, no_key):
    w = world
    diagnosis(w.aarav, w.paper, ReasoningTrace.AGREED)
    [finding] = findings(w.a)
    assert finding["questions"] == [
        {"question_pk": w.q["Q1"].id, "label": "Q1"},
        {"question_pk": w.q["Q5"].id, "label": "Q5"},
    ]
    for q in finding["questions"]:
        assert w.a.get(f"/api/my/questions/{q['question_pk']}/").status_code == 200


def test_a_citation_that_did_not_resolve_is_not_linked(world, no_key):
    diagnosis(world.aarav, world.paper, ReasoningTrace.AGREED, evidence=("Q1", "Q99"))
    [finding] = findings(world.a)
    assert [q["label"] for q in finding["questions"]] == ["Q1"]


def test_a_question_i_never_answered_is_never_linked(world, monkeypatch, no_key):
    """The guard in `_linked_questions`, run against a presenter that slips.

    `present()` only resolves against my own attempts today; the second check
    exists so that a future change there cannot turn this list into links to
    the key of a paper I have not sat.
    """
    w = world
    other_paper = f.make_paper(w.cohort, "Mock 99", dt.date(2026, 10, 1))
    secret = f.ask(other_paper, w.organic, "Q1", "A paper still to come.", correct="A")
    real_present = dx.present

    def slipping_present(output, **kw):
        out = real_present(output, **kw)
        out["hypotheses"][0]["evidence"].append(
            {"question_id": secret.id, "label": "Q1-secret", "chose": "B", "marks_at_stake": 5}
        )
        return out

    monkeypatch.setattr(dx, "present", slipping_present)
    diagnosis(w.aarav, w.paper, ReasoningTrace.AGREED)
    [finding] = findings(w.a)
    assert secret.id not in [q["question_pk"] for q in finding["questions"]]
    assert [q["label"] for q in finding["questions"]] == ["Q1", "Q5"]


# ============================================================ 3 · rewording


def test_opening_the_guide_never_waits_on_the_model(world, monkeypatch):
    """A live rewording took 40 s on the free tier, with the page waiting on it.
    The student's request reads the cache only; until the nightly run has
    reworded a finding, it is shown in the template's words, at once."""
    client = RecordingGemini(REWORDED)
    use(monkeypatch, client)
    diagnosis(world.aarav, world.paper, ReasoningTrace.AGREED)

    [finding] = findings(world.a)
    assert finding["reworded"] is False
    assert finding["title"] == "Something to work on: Directing effects reversed"
    assert client.calls == []
    assert not ReasoningTrace.objects.filter(task=ReasoningTrace.EXPLAIN_FOR_STUDENT).exists()


def test_the_model_rewords_it_and_never_leaves_a_code_in(world, monkeypatch):
    client = RecordingGemini(REWORDED)
    use(monkeypatch, client)
    diagnosis(world.aarav, world.paper, ReasoningTrace.AGREED)

    reword(world.aarav)
    [finding] = findings(world.a)
    assert finding["reworded"] is True
    assert finding["title"] == (
        "You flip the directing rule when it is not named (Directing effects reversed)"
    )
    assert finding["what_to_do"] == REWORDED["what_to_do"]

    [call] = client.calls
    assert call["system_prompt"] == guidance.EXPLAIN_SYSTEM_PROMPT
    trace = ReasoningTrace.objects.get(task=ReasoningTrace.EXPLAIN_FOR_STUDENT)
    assert trace.student_id == world.aarav.id
    assert trace.prompt_version == guidance.EXPLAIN_PROMPT_VERSION


def test_the_rewording_input_is_the_approved_finding_in_plain_names(world, monkeypatch):
    client = RecordingGemini(REWORDED)
    use(monkeypatch, client)
    diagnosis(world.aarav, world.paper, ReasoningTrace.AGREED)
    reword(world.aarav)

    payload = client.calls[0]["payload"]
    [entry] = payload["findings"]
    assert entry["mistake"] == "Directing effects reversed"
    assert entry["questions"] == ["Q1", "Q5"]
    assert entry["questions_right"] == ["Q3"]
    assert entry["marks"] == 10                       # server-counted, not the model's
    assert payload["paper"] == "Mock 15 — Diagnostic"
    # No code and no pseudonym: the wording is about the finding, not a person.
    assert "MIS-" not in client.calls[0]["body"]
    assert f"S-{world.aarav.id}" not in client.calls[0]["body"]
    assert "student_ref" not in payload


def test_a_mentor_facing_substituted_sentence_is_not_passed_on(world, monkeypatch):
    client = RecordingGemini(REWORDED)
    use(monkeypatch, client)
    trace = diagnosis(world.aarav, world.paper, ReasoningTrace.AGREED)
    trace.output["hypotheses"][0]["counter_evidence"] = ""      # present() substitutes
    trace.save()
    reword(world.aarav)
    assert "where_you_got_it_right" not in client.calls[0]["payload"]["findings"][0]


def test_a_rewording_is_made_once_and_then_replayed(world, monkeypatch):
    use(monkeypatch, RecordingGemini(REWORDED))
    diagnosis(world.aarav, world.paper, ReasoningTrace.AGREED)
    reword(world.aarav)
    first = findings(world.a)
    assert first[0]["reworded"] is True

    second_client = RecordingGemini({**REWORDED, "title": "A DIFFERENT TITLE"})
    use(monkeypatch, second_client)
    assert reword(world.aarav)[0]["title"] == first[0]["title"]
    assert findings(world.a) == first
    assert second_client.calls == []
    assert ReasoningTrace.objects.filter(task=ReasoningTrace.EXPLAIN_FOR_STUDENT).count() == 1


def test_a_run_spends_at_most_two_live_calls_per_student(world, monkeypatch):
    w = world
    for n in (16, 17, 18):
        paper = f.make_paper(w.cohort, f"Mock {n}", dt.date(2026, 10, n - 10))
        q = f.ask(paper, w.organic, "Q1", f"Stem {n}.", correct="A", baits={"B": w.eas})
        f.answer(w.aarav, q, "B")
        diagnosis(w.aarav, paper, ReasoningTrace.AGREED, evidence=("Q1",))

    client = RecordingGemini(REWORDED)
    use(monkeypatch, client)
    reword(w.aarav)
    assert len(client.calls) == guidance.MAX_LIVE_REWORDINGS == 2
    assert sorted(x["reworded"] for x in findings(w.a)) == [False, True, True]

    reword(w.aarav)                                  # two cached, one new
    assert len(client.calls) == 3
    assert [x["reworded"] for x in findings(w.a)] == [True, True, True]


def test_a_failed_rewording_is_not_retried_on_every_reload(world, monkeypatch):
    """Six models down means six requests the first time. Not every time."""
    client = RecordingGemini(ApiError(503, "no capacity"))
    use(monkeypatch, client)
    diagnosis(world.aarav, world.paper, ReasoningTrace.AGREED)

    assert reword(world.aarav)[0]["reworded"] is False
    spent = len(client.calls)
    assert spent == len(gemini._model_chain(gemini.DEFAULT_MODEL))
    reword(world.aarav)
    assert len(client.calls) == spent, "the cool-down did not hold"
    assert findings(world.a)[0]["reworded"] is False

    # Once it has passed, the next run tries again.
    ReasoningTrace.objects.filter(task=ReasoningTrace.EXPLAIN_FOR_STUDENT).update(
        created_at=timezone.now() - guidance.FAILURE_COOLDOWN - dt.timedelta(minutes=1))
    reword(world.aarav)
    assert len(client.calls) == 2 * spent


def test_an_incomplete_model_answer_falls_back_to_the_template(world, monkeypatch):
    use(monkeypatch, RecordingGemini({"title": "Only a title"}))
    diagnosis(world.aarav, world.paper, ReasoningTrace.AGREED)
    reword(world.aarav)
    [finding] = findings(world.a)
    assert finding["reworded"] is False
    assert finding["title"] == "Something to work on: Directing effects reversed"


# ============================================================ 4 · the fallback


def test_the_template_is_kind_plain_and_says_the_mentor_agreed(world, no_key):
    w = world
    diagnosis(w.aarav, w.paper, ReasoningTrace.AGREED)
    response = w.a.get("/api/my/guidance/")
    [finding] = response.json()["findings"]
    assert finding["reworded"] is False
    assert finding["title"] == "Something to work on: Directing effects reversed"
    assert finding["explanation"] == (
        "Your mentor went through your answers on Mock 15 — Diagnostic and agreed with "
        "this: Believes deactivating groups direct ortho/para (Directing effects "
        "reversed). You can see it in Q1 and Q5."
    )
    assert finding["what_to_do"] == (
        "Work through Q1 and Q5 with you, naming the group first. If any of it is "
        "unclear, your teacher or mentor can go through it with you."
    )
    body = response.content.decode()
    for jargon in ("MIS-", f"S-{w.aarav.id}", "risk", "flag", "misconception"):
        assert jargon not in body, jargon


def test_scattered_mistakes_are_named_as_such(world, no_key):
    diagnosis(world.aarav, world.paper, ReasoningTrace.AGREED, pattern_found=False)
    [finding] = findings(world.a)
    assert finding["title"] == "Your mistakes here were spread out, not one pattern"


# ============================================================== 5 · privacy


def test_the_rewording_payload_carries_no_identity(world, monkeypatch):
    """Even when the approved text itself names him.

    The diagnosis model never saw his name, so its claim cannot contain it
    — today. The payload is scrubbed anyway, structurally, and this proves
    it by putting every identifier into the text that is reworded.
    """
    w = world
    client = RecordingGemini(REWORDED)
    use(monkeypatch, client)
    secrets = identifiers(w.aarav, w.cohort)
    leaky = (
        f"Aarav Mehta (roll {w.aarav.roll_no}, aarav.mehta@gmail.com) of "
        f"{w.cohort.institute.name}, {w.cohort.institute.city}, told Priya Sharma "
        "(priya.sharma@example.com) on 98765 43210 that he reverses the rule."
    )
    diagnosis(w.aarav, w.paper, ReasoningTrace.AGREED, claim=leaky, headline=leaky)
    reword(w.aarav)

    [call] = client.calls
    assert find_pii(call["payload"], secrets) == []
    assert find_pii(call["body"], secrets) == []
    sent = call["payload"]["findings"][0]["what_was_agreed"]
    for placeholder in ("[name]", "[roll number]", "[email]", "[institute]", "[mentor]", "[phone]"):
        assert placeholder in sent, placeholder

    stored = ReasoningTrace.objects.get(task=ReasoningTrace.EXPLAIN_FOR_STUDENT)
    assert find_pii(stored.context, secrets) == []


def test_the_scan_would_catch_a_leak(world, monkeypatch):
    """The privacy test above, run against a builder whose scrub is gone. It
    fails — so the green tick above means something."""
    w = world
    client = RecordingGemini(REWORDED)
    use(monkeypatch, client)
    monkeypatch.setattr(guidance, "_scrub", lambda payload, ids: payload)
    diagnosis(w.aarav, w.paper, ReasoningTrace.AGREED,
              claim=f"Aarav Mehta of {w.cohort.institute.name} reverses the rule.")
    reword(w.aarav)
    leaked = find_pii(client.calls[0]["payload"], identifiers(w.aarav, w.cohort))
    assert {"full name", "institute name"} <= set(leaked)


def test_the_scan_is_structural(world):
    payload = guidance.build_explain_context(
        dx.present(model_output(world.aarav), context={}, student=world.aarav,
                   paper=world.paper),
        {"MIS-ORG-EAS": "Directing effects reversed"},
        guidance.redact.identifiers_for(world.aarav),
    )
    secrets = identifiers(world.aarav, world.cohort)
    assert find_pii(payload, secrets) == []
    nested = json.loads(json.dumps(payload))
    nested["findings"][0]["asked_of"] = world.cohort.mentor.name
    assert find_pii(nested, secrets) == ["mentor given name", "mentor name"]


# ============================================================ reviewed_at


def test_reviewed_at_is_stamped_by_any_save_that_writes_a_verdict(world):
    trace = diagnosis(world.aarav, world.paper, ReasoningTrace.UNREVIEWED)
    assert trace.reviewed_at is None

    trace.human_verdict = ReasoningTrace.AGREED
    trace.save()
    trace.refresh_from_db()
    stamped = trace.reviewed_at
    assert stamped is not None

    trace.human_note = "Looks right."
    trace.save(update_fields=["human_note"])        # not a verdict
    trace.refresh_from_db()
    assert trace.reviewed_at == stamped

    trace.save()                                   # nothing changed
    trace.refresh_from_db()
    assert trace.reviewed_at == stamped

    trace.human_verdict = ReasoningTrace.UNREVIEWED
    trace.save(update_fields=["human_verdict"])
    trace.refresh_from_db()
    assert trace.reviewed_at is None


# ======================================================== 6 · the nightly run


def test_the_nightly_run_rewords_approved_findings_for_the_morning(world, monkeypatch):
    from apps.derived.services import nightly

    client = RecordingGemini(REWORDED)
    use(monkeypatch, client)
    diagnosis(world.aarav, world.paper, ReasoningTrace.AGREED)
    diagnosis(world.bhavna, world.paper, ReasoningTrace.UNREVIEWED)

    run = nightly.run_for_institute(world.cohort.institute)
    assert run.status == run.OK, run.error
    assert run.stats["findings"] == {"students": 1, "reworded": 1, "model_requests": 1, "failed": 0}
    [call] = client.calls                            # Aarav's only; Bhavna's is unreviewed

    calls = len(client.calls)
    [finding] = findings(world.a)                    # the morning: from the cache
    assert finding["reworded"] is True
    assert len(client.calls) == calls


def test_the_nightly_rewording_stops_at_its_cap(world, monkeypatch):
    from apps.derived.services import nightly

    monkeypatch.setattr(nightly, "MAX_NIGHTLY_MODEL_REQUESTS", 1)
    client = RecordingGemini(REWORDED)
    use(monkeypatch, client)
    diagnosis(world.aarav, world.paper, ReasoningTrace.AGREED)
    # A different finding: the two answered alike, and an identical
    # de-identified payload would (rightly) share one cached rewording.
    diagnosis(world.bhavna, world.paper, ReasoningTrace.AGREED,
              claim="Reads the directing rule backwards on every ring question.")

    run = nightly.run_for_institute(world.cohort.institute)
    assert run.stats["findings"]["students"] == 2
    assert run.stats["findings"]["model_requests"] == 1 == len(client.calls)
    assert run.stats["findings"]["reworded"] == 1

