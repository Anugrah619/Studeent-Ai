"""diagnose_misconception — the first and most important reasoning task.

Turns "Aarav is weak at Organic Chemistry" — which his teacher already
knows and cannot act on — into "Aarav has the directing-effects rule
backwards; it cost him 20 marks on this paper and it is an afternoon's
work to fix."

The deterministic layer does the counting. The model does the judgement:
which of several competing explanations the evidence actually supports,
how confident to be, and what follows from it.
"""

from __future__ import annotations

from collections import defaultdict

from apps.events.models import Attempt
from apps.ingestion.models import QuestionOption
from apps.reasoning.models import ReasoningTrace
from apps.reasoning.services import gemini

PROMPT_VERSION = "diagnose-v1"

SYSTEM_PROMPT = """\
You are an experienced JEE/NEET faculty member reviewing one student's answer
sheet. You are looking for the *mechanism* behind their errors, not a score.

You are given, for one student:
  - each question they got wrong, the option they chose, and what wrong
    belief that option is known to indicate
  - the questions they got RIGHT on the same chapters
  - how many marks each error pattern has cost

Your job is to decide what is actually going on. Specifically:

1. Is there a SYSTEMATIC misconception, or is this scattered carelessness?
   A misconception repeats and is consistent. Carelessness is random across
   unrelated topics. Say which you see, and say so plainly if it is the
   latter — "no clear pattern" is a valid and useful finding.

2. Use the CORRECT answers as evidence too. A student who fails only when a
   condition is implicit, and succeeds when it is stated, does not have a
   topic gap — they have a specific trigger. That distinction changes the
   remedy completely, and noticing it is the main thing you are here for.

3. Be honest about confidence. Four instances of one pattern is evidence.
   One is not. Do not dress up a thin signal.

4. Every claim must cite the question ids it rests on. A mentor will check.

Write for a teacher who has thirty seconds and forty students. Name the
belief, not the chapter. Be specific enough to act on before the next class.
Never invent a number that is not in the data you were given.
"""

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {
            "type": "string",
            "description": "One sentence a teacher can act on. Names the belief, not the chapter.",
        },
        "pattern_found": {
            "type": "boolean",
            "description": "False if the errors are scattered rather than systematic.",
        },
        "hypotheses": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "misconception_code": {"type": "string"},
                    "claim": {"type": "string"},
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                    "evidence_questions": {"type": "array", "items": {"type": "string"}},
                    "counter_evidence": {
                        "type": "string",
                        "description": "Correct answers that narrow or complicate this. Empty if none.",
                    },
                    "marks_at_stake": {"type": "integer"},
                },
                "required": ["misconception_code", "claim", "confidence",
                             "evidence_questions", "counter_evidence", "marks_at_stake"],
            },
        },
        "recommended_action": {
            "type": "string",
            "description": "What the mentor should do, concretely, this week.",
        },
        "time_to_fix": {
            "type": "string",
            "description": "Honest estimate, e.g. 'one 40-minute sitting'.",
        },
    },
    "required": ["headline", "pattern_found", "hypotheses",
                 "recommended_action", "time_to_fix"],
}


def build_context(student, paper=None) -> dict:
    """Assemble the de-identified payload.

    This is the ONLY place a reasoning payload is constructed, so it is the
    only place that has to get PII right. No name, roll number, phone, DOB
    or institute — just an opaque ref, the questions, and the counts.
    """
    attempts = (
        Attempt.objects
        .filter(student=student, chosen_option__gt="")
        .select_related("topic", "test_paper")
        .order_by("question_id")
    )
    if paper is not None:
        attempts = attempts.filter(test_paper=paper)

    # One query for every option on the papers in play, rather than one per
    # attempt — this loop runs over a whole paper.
    paper_ids = {a.test_paper_id for a in attempts if a.test_paper_id}
    options = {
        (o.question.test_paper_id, o.question.question_id, o.label): o
        for o in QuestionOption.objects
        .filter(question__test_paper_id__in=paper_ids)
        .select_related("question", "misconception")
    }

    wrong, right = [], []
    marks_by_code: dict[str, int] = defaultdict(int)
    seen_codes: dict[str, dict] = {}

    for a in attempts:
        opt = options.get((a.test_paper_id, a.question_id, a.chosen_option))
        if opt is None:
            continue
        entry = {
            "q": a.question_id,
            "chapter": a.topic.name,
            "chose": a.chosen_option,
            "time_sec": a.time_spent,
        }
        if a.status == Attempt.CORRECT:
            right.append(entry)
            continue

        mis = opt.misconception
        entry["option_text"] = opt.text
        if mis:
            entry["indicates"] = mis.code
            marks_by_code[mis.code] += 5      # the 4 lost plus the 1 penalty
            seen_codes.setdefault(mis.code, {
                "code": mis.code,
                "name": mis.name,
                "means": mis.description,
            })
        wrong.append(entry)

    return {
        "student_ref": f"S-{student.id}",
        "exam": student.batch.exam.code if student.batch_id else None,
        "paper": paper.name if paper else "all papers",
        "wrong_answers": wrong,
        "correct_answers": right,
        "misconception_glossary": list(seen_codes.values()),
        "marks_lost_by_pattern": dict(marks_by_code),
        "totals": {
            "answered": len(wrong) + len(right),
            "wrong": len(wrong),
            "wrong_with_known_cause": sum(1 for w in wrong if "indicates" in w),
        },
    }


def diagnose(student, paper=None, force: bool = False) -> tuple[dict, ReasoningTrace]:
    """Run the diagnosis. Raises if there is nothing to reason about."""
    context = build_context(student, paper)

    if context["totals"]["wrong"] == 0:
        raise ValueError("No wrong answers with a recorded option — nothing to diagnose.")
    if context["totals"]["wrong_with_known_cause"] == 0:
        raise ValueError(
            "This student's wrong answers are on questions whose distractors "
            "are not yet tagged with a misconception. Tag them first — "
            "without that the model can only repeat the chapter name back."
        )

    return gemini.reason(
        task=ReasoningTrace.DIAGNOSE,
        context=context,
        system_prompt=SYSTEM_PROMPT,
        response_schema=RESPONSE_SCHEMA,
        institute_id=student.institute_id,
        student_id=student.id,
        prompt_version=PROMPT_VERSION,
        force=force,
    )
