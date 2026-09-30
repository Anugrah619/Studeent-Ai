"""`build_context` — the payload, and the two things it must get right.

WHY THIS FILE EXISTS

    `diagnose.build_context` is the ONLY place in the product where a
    payload bound for a third-party model is constructed. That makes it the
    only place where privacy can be got right, and the only place where it
    can be lost. Users are minors, and the free tier may use submitted
    content for training, with human review; there is no recall on a name
    that has already left.

    It is also where the product's actual claim is derived.
    "He is weak at Organic Chemistry" is what the institute already knew.
    "On the two questions where the directing group was named he was
    correct — this is a trigger, not a topic gap" is the product, and no
    model can infer it from a score sheet. It is computed here, from the
    options each question offered, and handed to the model worked out.

TWO CLASSES OF TEST

    1. THE PII SCAN. Serialise the whole payload and assert the identifying
       strings are absent. Stated as a property of the object rather than a
       list of today's fields, so a key added next year that carries a name
       fails this file without anyone remembering it exists. That property
       is the entire point — `test_the_scan_is_structural_not_a_field_list`
       is the test that proves the scan has it.

    2. COUNTER-EVIDENCE. A correct answer counts only when it is in a
       chapter the student erred in AND the question offered no option that
       the misconception produces. Both halves matter: drop the first and
       the model pads its sentence with unrelated chapters; drop the second
       and "he was fine here" includes questions where he dodged the bait
       by luck, which is the opposite of evidence.
"""

from __future__ import annotations

import datetime as dt
import json
import types

import pytest

from apps.events.models import Attempt
from apps.reasoning.services import diagnose as dx
from tests import factories as f

pytestmark = pytest.mark.django_db


# --------------------------------------------------------------- the scenario


@pytest.fixture
def scene(cohort):
    """One student, one paper, and every case counter-evidence must separate.

        Q1  Hydrocarbons           wrong  -> MIS-ORG-EAS      the error
        Q2  Hydrocarbons           right, and the EAS bait WAS offered
        Q3  Hydrocarbons           right, EAS not offered     counter-evidence
        Q4  Kinematics             right, EAS not offered     wrong chapter
        Q5  Aldehydes and Ketones  wrong  -> MIS-ORG-EAS      the error again
        Q6  Aldehydes and Ketones  right, nothing tagged      counter-evidence
        Q7  Hydrocarbons           wrong, distractor untagged
        Q8  Hydrocarbons           blank — no option recorded

    Q2 is the one that matters most. It is a correct answer, in the right
    chapter, and it is NOT counter-evidence: the question put the bait in
    front of him and he walked past it, which tells us nothing about
    whether the belief is there.
    """
    cohort.mentor.name = "Priya Sharma"
    cohort.mentor.email = "priya.sharma@example.com"
    cohort.mentor.save()

    student = f.make_student(cohort, "Aarav Mehta", roll_no="R7741")
    student.target = "AIR under 5000"
    student.save()

    paper = f.make_paper(cohort, "Mock 15 — Diagnostic", f.AS_OF.date(),
                         total_questions=8, max_marks=32)

    eas = f.misconception(
        "MIS-ORG-EAS",
        name="Directing effects reversed",
        description="Believes deactivating groups direct ortho/para.",
    )
    markov = f.misconception("MIS-ORG-MARKOV", name="Markovnikov reversed")

    organic = cohort.chapter("Hydrocarbons")
    carbonyl = cohort.chapter("Aldehydes and Ketones")
    physics = cohort.chapter("Kinematics")

    # A stem longer than the 220-character budget, to prove it is trimmed
    # rather than sent whole — a 40-question paper of full stems is a large
    # prompt, and the model needs enough to tell questions apart, not the
    # whole paper.
    long_stem = (
        "An excess of bromine water is added to a solution of the compound "
        "at room temperature, and the mixture is then warmed gently for "
        "fifteen minutes before being poured over crushed ice; identify the "
        "organic product that separates out, and account for the observed "
        "regiochemistry in terms of the stability of the intermediate."
    )
    assert len(long_stem) > 220

    q = {
        "Q1": f.ask(paper, organic, "Q1",
                    "Nitration of toluene proceeds predominantly at which position?",
                    correct="A", baits={"B": eas, "C": markov}),
        "Q2": f.ask(paper, organic, "Q2",
                    "Bromination of nitrobenzene gives predominantly which product?",
                    correct="A", baits={"B": eas}),
        "Q3": f.ask(paper, organic, "Q3",
                    "The substituent is stated to be meta-directing. Predict the "
                    "major nitration product.",
                    correct="C", baits={"D": markov}),
        "Q4": f.ask(paper, physics, "Q4",
                    "A particle starts from rest with constant acceleration. "
                    "Find its displacement in the fourth second.",
                    correct="B"),
        "Q5": f.ask(paper, carbonyl, "Q5",
                    "Which ring position is attacked in the acylated product?",
                    correct="A", baits={"C": eas}),
        "Q6": f.ask(paper, carbonyl, "Q6", long_stem, correct="D"),
        "Q7": f.ask(paper, organic, "Q7",
                    "Which reagent converts the alkene to the vicinal diol?",
                    correct="A"),
        "Q8": f.ask(paper, organic, "Q8",
                    "Name the major product of the Friedel-Crafts step.",
                    correct="A", baits={"B": eas}),
    }

    f.answer(student, q["Q1"], "B")                 # wrong, EAS
    f.answer(student, q["Q2"], "A")                 # right, bait was offered
    f.answer(student, q["Q3"], "C")                 # right, bait absent
    f.answer(student, q["Q4"], "B")                 # right, other subject
    f.answer(student, q["Q5"], "C")                 # wrong, EAS
    f.answer(student, q["Q6"], "D")                 # right, nothing tagged
    f.answer(student, q["Q7"], "D")                 # wrong, untagged distractor
    f.answer(student, q["Q8"], "", status=Attempt.BLANK)   # no option recorded

    return types.SimpleNamespace(
        cohort=cohort, student=student, paper=paper, questions=q,
        eas=eas, markov=markov, long_stem=long_stem,
        context=dx.build_context(student),
    )


# ============================================================ 1 · PII must not leave
#
# The whole payload, serialised, must not contain any of these strings.


def identifiers(scene) -> dict[str, str]:
    """Everything about this student that must never reach Google.

    Keyed by what it is, so a failure names the leak rather than printing a
    string and leaving the reader to work out why it matters.
    """
    s, c = scene.student, scene.cohort
    return {
        "full name": s.name,
        "given name": s.name.split()[0],
        "family name": s.name.split()[-1],
        "roll number": s.roll_no,
        "stated target": s.target,
        "mentor name": c.mentor.name,
        "mentor email": c.mentor.email,
        "institute name": c.institute.name,
        "institute slug": c.institute.slug,
        "institute city": c.institute.city,
        # There is no date-of-birth column yet. `joined_at` is the closest
        # personal date we hold, and standing it in here means the day a
        # DOB field is added the scan already covers dates of that shape.
        "personal date": s.joined_at.isoformat(),
    }


def find_pii(payload: dict, secrets: dict[str, str]) -> list[str]:
    """Names of every identifier that survives into the serialised payload.

    Serialising the whole object is the point. Checking named fields would
    pass forever while a new key quietly carried a name; checking the JSON
    means every field, present and future, nested at any depth, is covered
    by one assertion.

    `ensure_ascii=False` matters: with the default, "Aarav Mehta" written in
    Devanagari would be escaped to \\uXXXX and the scan would miss it.
    Case-insensitive for the same reason — a lowercased slug is still a name.
    """
    blob = json.dumps(payload, default=str, ensure_ascii=False).lower()
    return sorted(
        label for label, value in secrets.items() if value and value.lower() in blob
    )


def test_the_payload_carries_an_opaque_ref_and_no_identity(scene):
    """The one test this file exists for.

    A leak here is not a bug that gets fixed in the next release. The
    content is gone, it is a minor's, and the free tier's terms allow human
    review of it.
    """
    assert find_pii(scene.context, identifiers(scene)) == []


def test_re_identification_is_possible_locally_and_only_locally(scene):
    """PII stripped is useless if the answer cannot be put back on a face.

    `student_ref` is the hook: opaque to Google, trivially resolvable here.
    """
    ref = scene.context["student_ref"]
    assert ref == f"S-{scene.student.id}"
    assert ref in json.dumps(scene.context)


def test_the_scan_is_structural_not_a_field_list(scene):
    """Proof that the assertion above would actually catch a regression.

    A PII test that enumerates today's fields passes forever while someone
    adds `"mentor": student.mentor.name` next year. This one fails, and it
    fails from any depth — top level, inside a list of dicts, or buried in
    a nested map — because it reads the serialised object rather than a
    schema. Each case below is a shape a real regression has taken
    somewhere: a convenience field, a debug echo, a grouping key.
    """
    secrets = identifiers(scene)

    top_level = dict(scene.context, mentor=scene.cohort.mentor.name)
    assert find_pii(top_level, secrets) == ["mentor name"]

    inside_a_list = json.loads(json.dumps(scene.context))
    inside_a_list["wrong_answers"][0]["asked_of"] = scene.student.name
    assert find_pii(inside_a_list, secrets) == [
        "family name", "full name", "given name",
    ]

    nested_key = json.loads(json.dumps(scene.context))
    nested_key["counter_evidence_by_pattern"][scene.student.roll_no] = []
    assert find_pii(nested_key, secrets) == ["roll number"]


def test_the_pii_assertion_fails_when_build_context_leaks_a_name(scene, monkeypatch):
    """Run the privacy test against a payload that really does leak. It fails.

    This is the guarantee, executed rather than believed. A privacy test
    that cannot fail is worse than no privacy test, because someone reads
    the green tick and stops worrying — so the leak is introduced here in
    the exact shape a regression takes (one more key in the dict
    `build_context` returns, holding something convenient) and the
    assertion above is invoked on the result.

    Verified once by hand as well, by adding `student.name` to the real
    `build_context` and watching this file go red; that edit was reverted,
    and this test is what keeps the finding.
    """
    real_build_context = dx.build_context

    def leaks_a_name(student, paper=None):
        payload = real_build_context(student, paper)
        payload["mentor"] = student.mentor.name          # the regression
        return payload

    monkeypatch.setattr(dx, "build_context", leaks_a_name)
    leaked = types.SimpleNamespace(**vars(scene))
    leaked.context = dx.build_context(scene.student)

    with pytest.raises(AssertionError):
        test_the_payload_carries_an_opaque_ref_and_no_identity(leaked)


def test_the_glossary_explains_codes_without_naming_anyone(scene):
    """The glossary is free text straight out of the database.

    It is the field most likely to grow, and the most likely to acquire a
    sentence like "Aarav does this on every paper" when someone writes the
    taxonomy by hand.
    """
    glossary = scene.context["misconception_glossary"]
    assert [g["code"] for g in glossary] == ["MIS-ORG-EAS"]
    assert glossary[0]["name"] == "Directing effects reversed"
    assert "deactivating" in glossary[0]["means"]
    assert find_pii({"g": glossary}, identifiers(scene)) == []


# ================================================== 2 · counter-evidence derivation


def test_counter_evidence_is_the_right_answers_where_the_belief_could_not_fire(scene):
    """The product's claim, computed rather than asserted.

    Q3 and Q6 are correct answers in the two chapters he erred in, on
    questions that offered no option a reversed-directing-effects belief
    would produce. That is what makes them evidence of anything: he could
    not have got them right by accident of what was on offer.
    """
    counter = scene.context["counter_evidence_by_pattern"]
    assert set(counter) == {"MIS-ORG-EAS"}
    assert [h["q"] for h in counter["MIS-ORG-EAS"]] == ["Q3", "Q6"]
    assert {h["chapter"] for h in counter["MIS-ORG-EAS"]} == {
        "Hydrocarbons", "Aldehydes and Ketones",
    }


def test_a_correct_answer_that_offered_the_bait_is_not_counter_evidence(scene):
    """Q2 is right, in the right chapter, and proves nothing.

    The question put the MIS-ORG-EAS distractor in front of him and he did
    not take it. That is one observation against the belief, not a
    demonstration that the belief has no trigger — and treating it as
    counter-evidence is how "he only fails when the group is implicit"
    turns back into "he is inconsistent at Organic", which is the finding
    we already had.
    """
    ids = [h["q"] for h in scene.context["counter_evidence_by_pattern"]["MIS-ORG-EAS"]]
    assert "Q2" not in ids

    # ...and it is genuinely a correct answer sitting in the payload, so
    # the exclusion is a judgement about what it shows, not an oversight.
    assert "Q2" in [r["q"] for r in scene.context["correct_answers"]]


def test_a_correct_answer_in_an_unrelated_chapter_is_not_counter_evidence(scene):
    """Q4 is Kinematics. He never got an Organic-Chemistry belief wrong there.

    Padding the list with unrelated chapters is the specific failure the
    prompt spends a paragraph forbidding — "they navigated these chapters"
    is the sentence nobody can act on. It is cheaper to make it impossible
    here than to ask the model not to.
    """
    ids = [h["q"] for h in scene.context["counter_evidence_by_pattern"]["MIS-ORG-EAS"]]
    assert "Q4" not in ids
    assert "Q4" in [r["q"] for r in scene.context["correct_answers"]]


def test_the_stems_travel_with_the_counter_evidence(scene):
    """Ids alone make the model hedge, and a hedge is worth nothing.

    Handed seven question numbers and no text, the best a model can say is
    "he answered several of these correctly". Handed the stems it can say
    "the directing group was named in both, and he was correct" — which is
    the sentence the whole pitch turns on. The text is not decoration.
    """
    hits = {h["q"]: h for h in scene.context["counter_evidence_by_pattern"]["MIS-ORG-EAS"]}

    assert "meta-directing" in hits["Q3"]["stem"]
    assert hits["Q6"]["stem"]                      # the long one is present
    assert all(h["stem"] for h in hits.values())

    # Trimmed, not sent whole: a paper's worth of full stems is a big prompt.
    assert hits["Q6"]["stem"] == scene.long_stem[:220]
    assert len(hits["Q6"]["stem"]) == 220


def test_a_misconception_with_no_counter_evidence_is_absent_not_empty(cohort):
    """The honest-finding case, and the shape the prompt is written against.

    The system prompt tells the model to say plainly that there is no
    counter-evidence and that the weakness may be chapter-wide. That branch
    is reached by the code being *missing* from the map, not by it mapping
    to `[]`, so the distinction is load-bearing.
    """
    student = f.make_student(cohort, "No Counter")
    paper = f.make_paper(cohort, "Mock 16", f.AS_OF.date())
    chain = f.misconception("MIS-CALC-CHAIN", subject="Maths")
    limits = cohort.chapter("Limits")

    q1 = f.ask(paper, limits, "Q1", "Differentiate the composite function.",
               correct="A", baits={"B": chain})
    q2 = f.ask(paper, limits, "Q2", "Differentiate another composite function.",
               correct="A", baits={"B": chain})
    f.answer(student, q1, "B")
    f.answer(student, q2, "B")

    context = dx.build_context(student)
    assert context["marks_lost_by_pattern"] == {"MIS-CALC-CHAIN": 10}
    assert context["counter_evidence_by_pattern"] == {}
    assert "MIS-CALC-CHAIN" not in context["counter_evidence_by_pattern"]


# =============================================================== the rest of the payload


def test_the_wrong_answers_carry_what_was_chosen_and_what_it_indicates(scene):
    wrong = {w["q"]: w for w in scene.context["wrong_answers"]}
    assert set(wrong) == {"Q1", "Q5", "Q7"}

    assert wrong["Q1"]["chose"] == "B"
    assert wrong["Q1"]["indicates"] == "MIS-ORG-EAS"
    assert wrong["Q1"]["chapter"] == "Hydrocarbons"
    assert wrong["Q1"]["option_text"].startswith("(B)")
    assert "Nitration of toluene" in wrong["Q1"]["stem"]

    # An untagged distractor is a gap in the taxonomy, not an error: the
    # answer is still reported, it just cannot support a diagnosis.
    assert "indicates" not in wrong["Q7"]
    assert wrong["Q7"]["chose"] == "D"


def test_a_question_with_no_option_recorded_is_not_evidence_of_anything(scene):
    """Q8 was left blank. It has no chosen option, so it is not in the payload.

    A blank is a fact about time or nerve, not about a belief, and feeding
    it to a misconception diagnosis invites the model to explain it anyway.
    """
    answered = [w["q"] for w in scene.context["wrong_answers"]]
    answered += [r["q"] for r in scene.context["correct_answers"]]
    assert "Q8" not in answered
    assert scene.context["totals"]["answered"] == 7


def test_the_totals_are_the_counts_the_model_is_told_to_account_for(scene):
    """The prompt requires every wrong answer to be accounted for.

    That instruction is only checkable because these three numbers are
    computed here rather than counted by the model.
    """
    assert scene.context["totals"] == {
        "answered": 7, "wrong": 3, "wrong_with_known_cause": 2,
    }


def test_marks_are_attributed_per_pattern_not_per_chapter(scene):
    """Two errors at 5 marks each — the 4 not earned plus the 1 penalty."""
    assert scene.context["marks_lost_by_pattern"] == {"MIS-ORG-EAS": 10}


def test_the_payload_can_be_restricted_to_one_paper(cohort):
    """A mentor asking about last Sunday's mock does not want last term's."""
    student = f.make_student(cohort, "Two Papers")
    eas = f.misconception("MIS-ORG-EAS")
    organic = cohort.chapter("Hydrocarbons")

    old = f.make_paper(cohort, "Mock 1", f.AS_OF.date())
    new = f.make_paper(cohort, "Mock 2", f.AS_OF.date())
    f.answer(student, f.ask(old, organic, "A1", "Old paper stem.",
                            correct="A", baits={"B": eas}), "B")
    f.answer(student, f.ask(new, organic, "B1", "New paper stem.",
                            correct="A", baits={"B": eas}), "B")

    everything = dx.build_context(student)
    assert {w["q"] for w in everything["wrong_answers"]} == {"A1", "B1"}
    assert everything["paper"] == "all papers"

    just_new = dx.build_context(student, new)
    assert {w["q"] for w in just_new["wrong_answers"]} == {"B1"}
    assert just_new["paper"] == "Mock 2"
    assert just_new["marks_lost_by_pattern"] == {"MIS-ORG-EAS": 5}


def test_each_wrong_answer_gets_the_stem_of_its_own_paper(cohort):
    """Two mocks, both numbered from Q1. The stems must not merge."""
    student = f.make_student(cohort, "Same Ids")
    eas = f.misconception("MIS-ORG-EAS")
    organic = cohort.chapter("Hydrocarbons")

    july = f.make_paper(cohort, "Mock 1", dt.date(2026, 7, 5))
    september = f.make_paper(cohort, "Mock 2", dt.date(2026, 9, 20))
    q_july = f.ask(july, organic, "Q1", "JULY PAPER: hydrolysis of an ester.",
                   correct="A", baits={"B": eas})
    q_sept = f.ask(september, organic, "Q1", "SEPTEMBER PAPER: nitration of toluene.",
                   correct="A", baits={"B": eas})
    f.answer(student, q_july, "B")
    f.answer(student, q_sept, "B")

    wrong = dx.build_context(student)["wrong_answers"]
    assert len(wrong) == 2
    stems = {w["stem"] for w in wrong}
    assert stems == {
        "JULY PAPER: hydrolysis of an ester.",
        "SEPTEMBER PAPER: nitration of toluene.",
    }, f"both answers were given the same stem: {stems!r}"


# ==================================================== 3 · the guards in diagnose()
#
# Both raise before any call is made. An honest 422 costs nothing; a model
# handed nothing to reason about returns "revise Organic Chemistry", which
# looks like an answer and is worse than an error.


def test_nothing_wrong_to_diagnose_is_refused_rather_than_reasoned_about(cohort):
    student = f.make_student(cohort, "Flawless")
    paper = f.make_paper(cohort, "Mock 1", f.AS_OF.date())
    organic = cohort.chapter("Hydrocarbons")
    f.answer(student, f.ask(paper, organic, "Q1", "Stem.", correct="A"), "A")

    with pytest.raises(ValueError, match="No wrong answers"):
        dx.diagnose(student)


def test_untagged_distractors_are_refused_by_naming_the_tagging_gap(cohort):
    """The message has to say *which* thing is missing.

    "Nothing to diagnose" sends whoever reads it looking at the student.
    The actual state is that this paper's distractors were never tagged,
    which is a job for the mapping queue and nothing to do with the
    student — and it is the state a new institute is in on day one.
    """
    student = f.make_student(cohort, "Untagged")
    paper = f.make_paper(cohort, "Mock 1", f.AS_OF.date())
    organic = cohort.chapter("Hydrocarbons")
    f.answer(student, f.ask(paper, organic, "Q1", "Stem.", correct="A"), "C")

    with pytest.raises(ValueError) as exc:
        dx.diagnose(student)

    message = str(exc.value)
    assert "misconception" in message
    assert "Tag them first" in message
    assert "No wrong answers" not in message


def test_a_student_who_never_recorded_an_option_is_refused_too(cohort):
    """The state every institute starts in: marks imported, options not.

    Before `Attempt.chosen_option` was populated this was the whole
    database, and it is what the 422 on the diagnosis endpoint means.
    """
    student = f.make_student(cohort, "Marks Only")
    paper = f.make_paper(cohort, "Mock 1", f.AS_OF.date())
    f.record(student, cohort.chapter("Hydrocarbons"), "wwww", paper=paper)

    assert dx.build_context(student)["totals"]["answered"] == 0
    with pytest.raises(ValueError, match="No wrong answers"):
        dx.diagnose(student)
