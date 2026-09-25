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

2. COUNTER-EVIDENCE. This is the most important part of your answer, and the
   payload hands it to you already worked out in
   `counter_evidence_by_pattern`: for each misconception, the questions the
   student answered CORRECTLY in the same chapters, where that belief could
   not have fired.

   Write `counter_evidence` as a specific, concrete sentence naming those
   exact question ids and saying what they prove. It has two parts:
     (a) which questions, and what was DIFFERENT about them — read the stems
         and find the actual difference, do not assert one;
     (b) what that difference implies about where the student's reasoning
         breaks.

   Here is the SHAPE, deliberately from a domain that is not in your data so
   you cannot reuse the words — an algebra case:

     "<ids>: the equation was already isolated, and they solved it correctly
      each time. The algebra is sound; the loss happens at the rearranging
      step before it."

   Your sentence must be built from THIS student's stems and ids. If you
   find yourself writing a sentence that would be equally true of a student
   you have not seen, you have not read the stems.

   That sentence is the difference between a chapter-wide weakness and a
   specific trigger, and it changes the remedy completely.

   Do NOT hedge. Do not write "other questions were either not tested or
   successfully navigated", do not list ids without saying what they show,
   and do not pad the list with questions from unrelated chapters. If
   `counter_evidence_by_pattern` is empty for a misconception, say plainly
   that there is no counter-evidence on this paper and that the weakness may
   therefore be chapter-wide — that is an honest and useful finding.

3. Be honest about confidence. Four instances of one pattern is evidence.
   One is not. Do not dress up a thin signal.

4. Every claim must cite the question ids it rests on. A mentor will check.

5. ACCOUNT FOR EVERY WRONG ANSWER. If your hypotheses explain five errors and
   the student got ten wrong, the mentor's next question is "so what about
   the other five?" — and a diagnosis that cannot answer it looks like
   cherry-picking. State plainly what the unexplained errors look like:
   scattered across unrelated chapters, concentrated somewhere you have no
   misconception tag for, or too few to read. Say it in
   `recommended_action`, in one sentence, after the instruction.

6. THE HEADLINE IS A LINE IN A LIST OF FORTY STUDENTS.
   - Do NOT begin it with "Student", "The student", or "This student" —
     every headline would start the same way and they stop being scannable.
   - Lead with the belief in the plainest words that are still correct, then
     the cost. Aim for about fifteen words.
   - Good:  "Has the directing-effects rule backwards — 25 marks, fixable in one sitting."
   - Bad:   "Student consistently reverses electrophilic aromatic substitution
             directing effects when they must be deduced independently."
     The bad one is accurate and unreadable at a glance. Jargon belongs in
     `claim`, where the teacher has already decided to read on.

7. `recommended_action` is ONE instruction a teacher could act on tomorrow.
   Name the specific examples to work through. Not a paragraph, not a
   syllabus — the single highest-value thing to do first.

8. BE INTERNALLY CONSISTENT. `time_to_fix` is one of four fixed bands, and
   it must match the effort `recommended_action` describes — a board
   correction is `minutes`, working through six questions with resonance
   structures is `one_session`. A reader who spots the two disagreeing stops
   trusting both.

   Do not put a number of minutes anywhere in your prose either. You do not
   have the evidence to distinguish thirty from forty-five, and inventing
   the difference costs you the reader's trust on everything else in the
   card — which IS supported.

Write for a teacher who has thirty seconds and forty students. Name the
belief, not the chapter. Be specific enough to act on before the next class.
Never invent a number that is not in the data you were given.
"""

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {
            "type": "string",
            "description": (
                "~15 words. Names the belief in plain language, then the cost. "
                "Must NOT begin with 'Student' or 'The student' — it is one "
                "line in a list of forty and they must stay scannable."
            ),
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
            "description": (
                "ONE instruction a teacher could act on tomorrow, naming the "
                "specific examples to work through. Then one sentence saying "
                "what the errors your hypotheses do NOT explain look like."
            ),
        },
        "time_to_fix": {
            "type": "string",
            "enum": ["minutes", "one_session", "several_sessions", "term_long"],
            "description": (
                "How much teaching time this costs. A bounded choice, not a "
                "number of minutes: asked for free text the model returned "
                "40, then 20, then 45 minutes for the same student and the "
                "same evidence. The action was stable across all three — only "
                "the estimate drifted, because it is a genuinely fuzzy "
                "judgement being forced into false precision. "
                "minutes = a correction at the board. "
                "one_session = one focused sitting. "
                "several_sessions = a few sittings over a week or two. "
                "term_long = a foundational gap needing sustained work."
            ),
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

    # Which misconceptions each question could possibly reveal. A question
    # that offers no option tagged X cannot show whether the student holds
    # X — and that is precisely what makes it useful as counter-evidence.
    codes_offered: dict[tuple[int, str], set[str]] = defaultdict(set)
    for (paper_id, qid, _label), opt in options.items():
        if opt.misconception_id:
            codes_offered[(paper_id, qid)].add(opt.misconception.code)

    wrong, right = [], []
    marks_by_code: dict[str, int] = defaultdict(int)
    seen_codes: dict[str, dict] = {}
    chapters_by_code: dict[str, set[str]] = defaultdict(set)

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
            entry["_key"] = (a.test_paper_id, a.question_id)
            right.append(entry)
            continue

        mis = opt.misconception
        entry["option_text"] = opt.text
        if mis:
            entry["indicates"] = mis.code
            marks_by_code[mis.code] += 5      # the 4 lost plus the 1 penalty
            chapters_by_code[mis.code].add(a.topic.name)
            seen_codes.setdefault(mis.code, {
                "code": mis.code,
                "name": mis.name,
                "means": mis.description,
            })
        wrong.append(entry)

    # Counter-evidence, derived rather than authored.
    #
    # This is the single most valuable thing in the payload and the model
    # cannot infer it: for each misconception the student got wrong, find
    # the questions they got RIGHT in the same chapters where that belief
    # could not have fired. Answering those correctly is what separates
    # "weak at this chapter" from "fails only when the condition is
    # implicit" — a completely different remedy.
    #
    # Derived from the data rather than read from a hand-authored marking,
    # because a real institute's paper will never carry one.
    # Carry the STEM, not just the id. Without the text the model can see
    # that seven questions qualify but not which of them are pointed, so it
    # hedges — "they can navigate these chapters" instead of "the directing
    # group was named in the stem and he was correct both times". The
    # specific sentence is the whole value, and it needs the words.
    stems = {
        (o.question.test_paper_id, o.question.question_id): o.question.question_text
        for o in options.values()
    }

    counter: dict[str, list[dict]] = {}
    for code, chapters in chapters_by_code.items():
        hits = [
            {"q": r["q"], "chapter": r["chapter"],
             "stem": stems.get(r["_key"], "")[:220]}
            for r in right
            if r["chapter"] in chapters and code not in codes_offered.get(r["_key"], ())
        ]
        if hits:
            counter[code] = sorted(hits, key=lambda h: h["q"])[:8]

    for r in right:
        r.pop("_key", None)

    # The wrong answers get their stems too, so the claim can name what the
    # student was actually asked rather than gesturing at a chapter.
    for w in wrong:
        key = next(
            (k for k in stems if k[1] == w["q"]), None
        )
        if key:
            w["stem"] = stems[key][:220]

    return {
        "student_ref": f"S-{student.id}",
        "exam": student.batch.exam.code if student.batch_id else None,
        "paper": paper.name if paper else "all papers",
        "wrong_answers": wrong,
        "correct_answers": right,
        "misconception_glossary": list(seen_codes.values()),
        "marks_lost_by_pattern": dict(marks_by_code),
        "counter_evidence_by_pattern": counter,
        "counter_evidence_note": (
            "For each misconception, these are questions the student answered "
            "CORRECTLY, in the same chapters as their errors, on which that "
            "belief could not have fired — the question offered no option "
            "matching it. READ THE STEMS. They are not equally interesting: "
            "pick the two or three where you can say concretely what was "
            "different about the question, and build your sentence on those. "
            "Listing all of them and saying they 'navigated the chapter' is "
            "the failure mode to avoid."
        ),
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
