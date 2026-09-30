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
from apps.ingestion.models import QuestionOption, QuestionTopicMap, TestPaper
from apps.reasoning.models import ReasoningTrace
from apps.reasoning.services import gemini

PROMPT_VERSION = "diagnose-v1"

#: What one wrong answer costs: the 4 marks forgone plus the 1-mark
#: penalty. Extracted from the literal that used to sit inside
#: `build_context` so the payload the model reads and the totals the API
#: publishes cannot drift apart — they are now the same constant.
#:
#: Flat rather than read from `TestPaper.marks_correct / marks_wrong`
#: because changing it would change every stored `context`, and the
#: context hash is the reasoning cache key: a different number here
#: silently re-reasons every student on the next page load. When papers
#: with other marking schemes arrive this becomes a per-paper lookup, and
#: that is a deliberate cache flush, not an accident.
MARKS_PER_WRONG = 5

#: Written when the model leaves `counter_evidence` empty AND the derived
#: `counter_evidence_by_pattern` had nothing for that code either. The
#: prompt (rule 2) already instructs the model to say exactly this; the
#: contract now guarantees it rather than hoping.
COUNTER_EVIDENCE_ABSENT = (
    "No counter-evidence on this paper: the student was not asked a question "
    "in these chapters where this belief could not have fired, so nothing "
    "here narrows the weakness. It may be chapter-wide rather than specific "
    "to one kind of question."
)

#: The other case, and a different claim: there WERE correct answers that
#: could have narrowed this, and the model did not use them. Saying "no
#: counter-evidence" here would be false, so it says what is true.
COUNTER_EVIDENCE_UNSTATED = (
    "The model did not state the counter-evidence for this finding, although "
    "the student did answer related questions correctly. Treat this finding "
    "as un-narrowed: it has not been shown where the error starts."
)


class NothingToDiagnose(ValueError):
    """Not enough tagged evidence to reason over. A real state, not a crash.

    Subclasses `ValueError` so existing handlers keep working, and splits
    into two cases so the API can explain *which* one without matching on
    the text of an exception message.
    """


class NoOptionsRecorded(NothingToDiagnose):
    """The results carry right/wrong but not which option was chosen."""


class NoMisconceptionTags(NothingToDiagnose):
    """The options are recorded, but nobody has said what the wrong ones mean."""


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
                        "description": (
                            "Correct answers that narrow or complicate this, "
                            "naming the question ids and what was different "
                            "about them. Never empty: if there are none, say "
                            "plainly that there is no counter-evidence on "
                            "this paper and that the weakness may therefore "
                            "be chapter-wide."
                        ),
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
        entry["_key"] = (a.test_paper_id, a.question_id)
        entry["option_text"] = opt.text
        if mis:
            entry["indicates"] = mis.code
            marks_by_code[mis.code] += MARKS_PER_WRONG
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
    # Key on (paper, question), not question alone. Every paper numbers its
    # questions Q1..Q75, so matching on the label only meant a diagnosis
    # spanning two mocks gave every same-numbered wrong answer whichever
    # stem happened to be found first — and the model would then quote to a
    # mentor, as evidence, a question the student never sat.
    #
    # The counter-evidence lookup twenty lines above always used the full
    # key; this line simply did not. Only bites when `?paper=` is omitted,
    # which is why it survived every single-paper test.
    for w in wrong:
        stem = stems.get(w.pop("_key", None))
        if stem:
            w["stem"] = stem[:220]

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
    """Run the diagnosis. Raises `NothingToDiagnose` if there is no evidence.

    Returns the **presented** output — the model's judgement plus the
    derived fields in `present()`. The trace keeps the model's raw JSON
    untouched, because that is the training example.
    """
    context = build_context(student, paper)

    if context["totals"]["wrong"] == 0:
        raise NoOptionsRecorded(
            "No wrong answers with a recorded option — nothing to diagnose."
        )
    if context["totals"]["wrong_with_known_cause"] == 0:
        raise NoMisconceptionTags(
            "This student's wrong answers are on questions whose distractors "
            "are not yet tagged with a misconception. Tag them first — "
            "without that the model can only repeat the chapter name back."
        )

    output, trace = gemini.reason(
        task=ReasoningTrace.DIAGNOSE,
        context=context,
        system_prompt=SYSTEM_PROMPT,
        response_schema=RESPONSE_SCHEMA,
        institute_id=student.institute_id,
        student_id=student.id,
        prompt_version=PROMPT_VERSION,
        force=force,
    )
    return present(output, context=context, student=student, paper=paper), trace


# ----------------------------------------------------------- presentation


def present(output: dict, *, context: dict, student, paper=None) -> dict:
    """Turn the model's JSON into the payload the console can actually use.

    Three things the model must not be trusted with, all of them Tier A:

    1. **Linking.** The model cites `"D16"`, which is a label unique only
       within one paper. A console cannot build a URL from it. Every
       citation is resolved here against this student's own attempts, and
       comes back with the `QuestionTopicMap.id` that
       `GET /api/questions/{id}/` answers on — or with a null id if the
       citation does not correspond to a wrong answer this student
       actually gave, which the client must render as text rather than a
       dead link.

    2. **Arithmetic.** `marks_at_stake` is re-derived as
       `MARKS_PER_WRONG x (distinct resolved citations)`, and
       `total_marks_at_stake` as the same over the *union* across
       hypotheses. On every trace recorded so far the model's own number
       already equalled this; re-deriving it means a future drift shows
       up as nothing at all instead of as a card whose chips and total
       disagree in front of a director.

    3. **Saying nothing.** A blank `counter_evidence` is replaced with the
       sentence that is actually true for that hypothesis — see
       `COUNTER_EVIDENCE_ABSENT` / `COUNTER_EVIDENCE_UNSTATED`.

    The raw model output is *not* mutated: `ReasoningTrace.output` keeps
    exactly what came back, because a training example that has been
    quietly corrected is not a training example.
    """
    out = {
        **output,
        "hypotheses": [dict(h) for h in (output.get("hypotheses") or [])],
    }

    cited = {
        q
        for h in out["hypotheses"]
        for q in (h.get("evidence_questions") or [])
        if q
    }
    resolved = _resolve_evidence(student, paper, cited)
    derived_counter = context.get("counter_evidence_by_pattern") or {}

    accounted: set[str] = set()
    for h in out["hypotheses"]:
        labels = list(dict.fromkeys(h.get("evidence_questions") or []))
        h["evidence"] = [
            resolved.get(
                label,
                {"question_id": None, "label": label, "chose": "", "marks_at_stake": 0},
            )
            for label in labels
        ]
        hit = [label for label in labels if label in resolved]
        if hit:
            h["marks_at_stake"] = MARKS_PER_WRONG * len(hit)
        accounted |= set(hit)

        if not (h.get("counter_evidence") or "").strip():
            code = h.get("misconception_code") or ""
            h["counter_evidence"] = (
                COUNTER_EVIDENCE_UNSTATED
                if derived_counter.get(code)
                else COUNTER_EVIDENCE_ABSENT
            )

    out["total_marks_at_stake"] = MARKS_PER_WRONG * len(accounted)
    out["paper_id"] = paper.id if paper is not None else None
    out["paper_name"] = paper.name if paper is not None else None
    return out


def _resolve_evidence(student, paper, labels: set[str]) -> dict[str, dict]:
    """Map each cited label onto the attempt behind it, and a routable id.

    Resolved against `Attempt` rather than `QuestionTopicMap` directly,
    because the attempt is what says *which paper* a label like `"D16"`
    belongs to — the label alone repeats across papers. It is also the
    validation: a label that is not a wrong answer this student gave does
    not resolve, and so cannot be linked or counted.
    """
    if not labels or student is None:
        return {}

    attempts = (
        Attempt.objects
        .filter(
            student=student,
            status=Attempt.WRONG,
            chosen_option__gt="",
            question_id__in=labels,
        )
        # Most recent first, so the `setdefault` below keeps the newest
        # sitting when `paper` is None and a label repeats across papers.
        .order_by("-ts", "-id")
    )
    if paper is not None:
        attempts = attempts.filter(test_paper=paper)

    by_label: dict[str, Attempt] = {}
    for a in attempts:
        by_label.setdefault(a.question_id, a)

    pk_by = {
        (q.test_paper_id, q.question_id): q.id
        for q in QuestionTopicMap.objects.filter(
            institute_id=student.institute_id,
            test_paper_id__in={a.test_paper_id for a in by_label.values()},
            question_id__in=set(by_label),
        )
    }
    return {
        label: {
            "question_id": pk_by.get((a.test_paper_id, a.question_id)),
            "label": label,
            "chose": a.chosen_option,
            "marks_at_stake": MARKS_PER_WRONG,
        }
        for label, a in by_label.items()
    }


def paper_for_trace(trace) -> TestPaper | None:
    """Which paper a stored trace was run against.

    Recovered from `context["paper"]`, which holds the name, because the
    context is deliberately free of database ids — it is the de-identified
    payload that leaves the building. Replaying a stored diagnosis needs
    the paper back to resolve its evidence links, and looking the name up
    inside the trace's own institute is the cheapest way that does not
    change the payload (and therefore the cache key) to get it.
    """
    name = (trace.context or {}).get("paper")
    if not name or name == "all papers":
        return None
    return TestPaper.objects.filter(
        institute_id=trace.institute_id, name=name
    ).first()
