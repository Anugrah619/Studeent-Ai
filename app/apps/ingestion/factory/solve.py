"""Step 3 — Gemini solves the paper blind. It never sees the official key.

The solver is given *our transcription* of each question, not the PDF —
deliberately. Agreement with the official key then proves two things at
once: the model can solve it, and what we stored is a faithful enough copy
of the question to be solved. A garbled transcription tends to surface as a
disagreement, which is exactly where a person should look.

The one exception is a figure. A question with `has_diagram` gets the
page(s) it sits on attached (question pages only — see
`read.document_for`), and the model is told to say "cannot solve" rather
than guess if it cannot read the figure. Those become *unverifiable*, not
disagreements.

`solver_payload` is the only function that builds what the model sees,
and it copies an explicit whitelist of fields. The official answer is not
among them; `tests/test_factory_pipeline.py` holds that line.
"""

from __future__ import annotations

from apps.reasoning.models import ReasoningTrace
from apps.reasoning.services import documents, gemini

from . import store
from .papers import PaperSpec
from .read import document_for, pages_for, paper_label
from .runner import (
    Budget,
    StepStopped,
    attempts_now,
    classify_stop,
    is_bad_json,
    with_capacity_retries,
)

#: Three versions, each a lesson worth keeping:
#:
#: v1  Default fallback chain, "working" listed last in the schema. Gemini
#:     orders schema properties alphabetically unless told otherwise, so
#:     `answer` was generated *before* `working`: the model committed to an
#:     answer and then justified it. A Lite model solving that way disagreed
#:     with NTA on 10 of the first 20 JEE maths questions; the one checked
#:     by hand (Q1) was the model's error, not the key's.
#: v2  Full Flash models only, waiting out capacity. Ran straight into the
#:     free tier's 20 requests per model per day — and 503s appear to count
#:     against it, so waiting burned quota for nothing.
#: v3  `property_ordering` puts the working first, so the model reasons
#:     before it answers. The same Lite model then went from 6/10 to 8/10 on
#:     Q1-10 (the two misses: one figure question tested without its page,
#:     one genuine). On the day of the first run every full Flash model was
#:     503 — each failure taking up to three minutes to arrive — so the
#:     working-first Lite models go first and full Flash is the fallback.
#:     No waiting. Each answer records which model gave it; re-solving the
#:     disagreements with a full model when capacity returns is the obvious
#:     next pass.
#:
#: Earlier answers are kept in each question's `solve_history`.
PROMPT_VERSION = "solve-v3"
TASK = ReasoningTrace.SOLVE_BLIND

SOLVER_MODELS = [
    "gemini-3.1-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-3.1-flash-lite-preview",
    "gemini-3.5-flash-lite",
    "gemini-3.7-flash",
    "gemini-3-flash-preview",
]
#: Opt-in waiting when every model is busy (`--wait`); off by default because
#: failed requests seem to count against the daily per-model cap.
CAPACITY_ROUNDS = 0
CAPACITY_WAIT_S = 120

SYSTEM_PROMPT = """You are an expert solver of NEET UG and JEE Main questions. Solve each question independently and carefully. Nobody has given you an answer key: work every answer out yourself.

Rules:
1. The question text in the request is the statement to solve. Mathematics is written in LaTeX.
2. Where a question has a figure (has_diagram true, [Figure] in the text), the page(s) holding it are attached; read the figure there. If you cannot see the figure clearly enough to solve with confidence, return status "cannot_solve" with reason "figure". Never guess what a figure shows, and never invent data that is only in a figure.
3. Write the working FIRST: reason step by step (at most 150 words), check the result, and only then give the answer.
4. Multiple choice: answer with exactly one option label, "1", "2", "3" or "4". Numerical: the final value as a plain number such as "225" or "0.5", in the unit the question asks for.
5. If a question looks ambiguous, mis-transcribed, or has no correct option, still give your best answer, set confidence "low", and say why in issue.
"""

_ORDER = ["number", "working", "status", "answer", "confidence", "reason", "issue"]
RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "answers": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "number": {"type": "integer"},
                    "working": {"type": "string"},
                    "status": {"type": "string", "enum": ["solved", "cannot_solve"]},
                    "answer": {"type": "string"},
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                    "reason": {"type": "string"},
                    "issue": {"type": "string"},
                },
                "required": ["number", "working", "status", "answer", "confidence"],
                # Reason before answering. Without this Gemini emits the
                # properties alphabetically and `answer` comes first.
                "property_ordering": _ORDER,
            },
        }
    },
    "required": ["answers"],
}

#: Exactly what the solver may see of a question. Adding a field here is a
#: decision about independence, not a convenience.
SOLVER_FIELDS = ("number", "subject", "answer_type")


def solver_payload(q: dict) -> dict:
    read = q["read"]
    item = {k: q[k] for k in SOLVER_FIELDS}
    item["text"] = read["text"]
    item["options"] = [{"label": o["label"], "text": o["text"]} for o in read["options"]]
    item["has_diagram"] = read["has_diagram"]
    if read["has_diagram"]:
        item["figure_on_pages"] = q["pages"]
    return item


def run(spec: PaperSpec, doc: dict, *, institute_id: int, budget: Budget,
        force: bool = False, log=print, wait_rounds: int = CAPACITY_ROUNDS) -> dict:
    for q in doc["questions"]:
        old = q.get("solve")
        if old and old.get("prompt_version") != PROMPT_VERSION:
            # Solved under an earlier policy: keep it for the record, solve again.
            q.setdefault("solve_history", []).append(old)
            q["solve"] = None
            q["check"] = None
    todo = [q for q in doc["questions"] if q.get("read") and (force or not q.get("solve"))]
    if force:
        for q in todo:
            q["solve"] = None
    queue = [todo[i:i + spec.solve_batch] for i in range(0, len(todo), spec.solve_batch)]
    done = 0
    retried: set[int] = set()
    try:
        while queue:
            batch = queue.pop(0)
            n = _solve_batch(spec, doc, batch, institute_id, budget, force, log, queue,
                             wait_rounds)
            if n is None:
                continue
            done += n
            # Seen live: with a page attached for one figure, a model answered
            # only the questions printed on that page. Ask again, once, for
            # whatever it left out.
            fresh = [q for q in batch if not q.get("solve") and q["number"] not in retried]
            if fresh:
                retried.update(q["number"] for q in fresh)
                log(f"    {len(fresh)} not answered ({[q['number'] for q in fresh]}), re-asking")
                queue.insert(0, fresh)
    except StepStopped as stop:
        budget.notes.append(str(stop))
        log(f"  solve stopped: {stop}")
    store.log_run(doc, "solve", solved=done, **budget.summary())
    store.save(spec.slug, doc)
    return {"solved": done}


def _solve_batch(spec, doc, batch, institute_id, budget, force, log, queue,
                 wait_rounds=CAPACITY_ROUNDS) -> int | None:
    budget.check()
    with_figures = [q for q in batch if q["read"]["has_diagram"]]
    attach = []
    if with_figures:
        pages = pages_for(spec, with_figures)
        attach = [document_for(spec, doc, pages)]
    numbers = [q["number"] for q in batch]
    instruction = f"Answer every one of these {len(batch)} questions: {numbers}."
    if attach:
        instruction += (
            f" The attached page(s) are there only to show the figures for questions "
            f"{[q['number'] for q in with_figures]}. Other questions printed on those "
            f"pages are not part of this request — ignore them."
        )
    context = {
        "exam": paper_label(spec),
        "instruction": instruction,
        "questions": [solver_payload(q) for q in batch],
    }
    nums = f"Q{batch[0]['number']}-{batch[-1]['number']}"
    before = attempts_now(TASK)
    try:
        out, trace = with_capacity_retries(
            lambda: documents.ask(
                task=TASK, context=context, system_prompt=SYSTEM_PROMPT,
                response_schema=RESPONSE_SCHEMA, institute_id=institute_id,
                documents=attach, prompt_version=PROMPT_VERSION, temperature=0.0,
                models=SOLVER_MODELS, force=force,
            ),
            rounds=wait_rounds, wait_s=CAPACITY_WAIT_S, log=log,
        )
    except (gemini.GeminiUnavailable, gemini.NoCredentialsAndNoCache) as exc:
        budget.attempts += attempts_now(TASK) - before
        if is_bad_json(exc) and len(batch) > 2:
            half = len(batch) // 2
            budget.failed_batches += 1
            log(f"    {nums}: response did not parse — splitting")
            queue[:0] = [batch[:half], batch[half:]]
            return None
        raise StepStopped(classify_stop(exc)) from exc
    budget.count(trace, TASK, before)

    wanted = {q["number"]: q for q in batch}
    n = 0
    for item in out.get("answers", []):
        q = wanted.get(item.get("number"))
        if q is None or q.get("solve"):
            continue
        q["solve"] = {
            "status": item.get("status") or "solved",
            "answer": str(item.get("answer") or "").strip(),
            "confidence": item.get("confidence") or "",
            "reason": (item.get("reason") or "").strip(),
            "issue": (item.get("issue") or "").strip(),
            "working": (item.get("working") or "").strip(),
            "saw_pages": list(attach[0].pages) if attach and q["read"]["has_diagram"] else [],
            "trace_id": trace.id,
            "model": trace.model,
            "prompt_version": PROMPT_VERSION,
        }
        n += 1
    src = "cache" if getattr(trace, "_from_cache", False) else trace.model
    log(f"  solve {nums}: {n} answered"
        + (f", figures from pages {list(attach[0].pages)}" if attach else "")
        + f"  [{src}]")
    store.save(spec.slug, doc)
    return n
