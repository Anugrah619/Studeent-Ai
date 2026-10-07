"""Step 2 — Gemini reads the paper: a few pages per call, transcription only.

The model is given the question pages (never a publisher's key pages) and
the list of question numbers to transcribe — numbers, ids and option ids
come from the PDF's own text layer (`structure.py`), not from the model.
What comes back is checked against that skeleton: right numbers, four
options for a multiple-choice question, none for a numerical one, and for
JEE Main the exact option ids NTA printed. Anything that does not check
out is recorded as an issue on the question rather than smoothed over.

Figures are flagged, never described. A model asked to describe a circuit
it can half see will describe *a* circuit; the question would then be
answerable from the description and wrong.
"""

from __future__ import annotations

from apps.reasoning.models import ReasoningTrace
from apps.reasoning.services import documents, gemini

from . import papers_dir, store
from .papers import PaperSpec
from .pdf import subset
from .runner import Budget, StepStopped, attempts_now, classify_stop, is_bad_json
from .text import repair_read

PROMPT_VERSION = "read-v1"
TASK = ReasoningTrace.READ_PAPER

SYSTEM_PROMPT = """\
You transcribe questions from an official Indian entrance-exam paper (NEET UG or \
JEE Main) into structured JSON. You are a careful copy typist, not a teacher.

Rules:
1. Transcribe only the questions listed under "transcribe", exactly as printed, in \
English. Do not paraphrase, correct, shorten, or complete anything.
2. Do NOT solve anything and never indicate which option is correct. Ignore any \
answer marking that may appear on a page.
3. Mathematics, physical quantities, units and chemical formulas go in LaTeX inside \
$...$, e.g. $\\frac{d^2y}{dx^2}=\\frac{\\rho g}{S}x$, $\\mathrm{H_2SO_4}$, \
$9\\times10^{-31}\\,\\mathrm{kg}$.
4. Keep the structure: "Statement I: ..." lines, lettered lists (A. B. C. D.), and \
Match-List tables written one row per line as "A. ... | I. ...".
5. Figures. If the question or any option contains a figure, graph, circuit, \
diagram, drawn chemical structure or picture, set has_diagram to true and write \
[Figure] where it appears. Never describe what a figure shows and never take \
values from it; transcribe only words and symbols printed as ordinary text. An \
option that is itself a figure has text "[Figure]" and is_figure true.
6. If something is illegible, transcribe what you can, write [illegible] for the \
gap, and set legibility accordingly. Never guess.
7. Options are printed (1) to (4); return them in printed order with labels \
"1".."4". On JEE Main papers every option is printed next to an option id: return \
that id in option_id exactly as printed.
8. Numerical-answer questions (answer_type "numerical") have no options: return \
an empty options list.
"""

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "number": {"type": "integer"},
                    "question_id": {"type": "string"},
                    "text": {"type": "string"},
                    "options": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string"},
                                "option_id": {"type": "string"},
                                "text": {"type": "string"},
                                "is_figure": {"type": "boolean"},
                            },
                            "required": ["label", "text", "is_figure"],
                        },
                    },
                    "has_diagram": {"type": "boolean"},
                    "legibility": {"type": "string",
                                   "enum": ["clear", "partial", "illegible"]},
                    "note": {"type": "string"},
                },
                "required": ["number", "text", "options", "has_diagram", "legibility"],
            },
        }
    },
    "required": ["questions"],
}


def paper_label(spec: PaperSpec) -> str:
    lang = " (English)" if spec.layout == "neet_booklet" else ""
    return f"{spec.exam_label} {spec.year}, {spec.shift_or_booklet}{lang}"


def pages_for(spec: PaperSpec, questions: list[dict]) -> list[int]:
    """Every page these questions touch, clipped to the question pages.

    The clip is the guarantee that a mirror's answer-key pages are never
    attached, whatever a skeleton bug might claim about where a question ends.
    """
    first, last = spec.question_pages
    lo = min(min(q["pages"]) for q in questions)
    hi = max(max(q["pages"]) for q in questions)
    return [p for p in range(max(lo, first), min(hi, last) + 1)]


def document_for(spec: PaperSpec, doc: dict, pages: list[int]) -> documents.Document:
    first, last = spec.question_pages
    assert all(first <= p <= last for p in pages), "attempted to send a non-question page"
    sha = doc["paper"]["question_paper"]["sha256"]
    return documents.Document(
        file=spec.paper.file, sha256=sha, pages=tuple(pages),
        data=subset(papers_dir() / spec.paper.file, pages),
    )


def _context(spec: PaperSpec, batch: list[dict], pages: list[int]) -> dict:
    return {
        "paper": paper_label(spec),
        "attached": f"pages {pages[0]}-{pages[-1]} of the original paper, in order",
        "transcribe": [
            {
                "number": q["number"],
                **({"question_id": q["question_id"]} if q["question_id"] else {}),
                "answer_type": q["answer_type"],
                **({"option_ids": q["option_ids"]} if q["option_ids"] else {}),
            }
            for q in batch
        ],
        "note": "Transcribe exactly these question numbers and nothing else.",
    }


def accept(q: dict, got: dict, trace) -> dict:
    """Check one transcription against the skeleton; return what to store."""
    issues = []
    options = list(got.get("options") or [])
    if q["answer_type"] == "mcq":
        if q["option_ids"]:
            by_id = {str(o.get("option_id", "")).strip(): o for o in options}
            if set(by_id) != set(q["option_ids"]):
                issues.append(f"option ids read as {sorted(by_id)}, paper has {q['option_ids']}")
            else:
                options = [by_id[oid] for oid in q["option_ids"]]
        if len(options) != 4:
            issues.append(f"{len(options)} options read, expected 4")
        labelled = []
        for i, o in enumerate(options[:4], 1):
            labelled.append({
                "label": str(i),
                "text": (o.get("text") or "").strip(),
                "is_figure": bool(o.get("is_figure")),
                **({"option_id": q["option_ids"][i - 1]} if q["option_ids"] and not issues else {}),
            })
            printed = str(o.get("label", "")).strip("() ")
            if printed and printed != str(i) and not q["option_ids"]:
                issues.append(f"option printed '{printed}' read in position {i}")
        options = labelled
    else:
        if options:
            issues.append(f"numerical question came back with {len(options)} options")
        options = []

    text = (got.get("text") or "").strip()
    if not text:
        issues.append("empty question text")
    if q["question_id"] and str(got.get("question_id", "")).strip() not in ("", q["question_id"]):
        issues.append(f"question id read as {got.get('question_id')}")

    return repair_read({
        "text": text,
        "options": options,
        "has_diagram": bool(got.get("has_diagram")) or "[Figure]" in text
                       or any(o["is_figure"] for o in options),
        "legibility": got.get("legibility") or "clear",
        "note": (got.get("note") or "").strip(),
        "issues": issues,
        "trace_id": trace.id,
        "model": trace.model,
        "prompt_version": PROMPT_VERSION,
    })


def run(spec: PaperSpec, doc: dict, *, institute_id: int, budget: Budget,
        force: bool = False, log=print) -> dict:
    todo = [q for q in doc["questions"] if force or not q.get("read")]
    if force:
        for q in todo:
            q["read"] = None
    batches = [todo[i:i + spec.read_batch] for i in range(0, len(todo), spec.read_batch)]
    done = 0
    try:
        queue = list(batches)
        retried: set[int] = set()
        while queue:
            batch = queue.pop(0)
            got = _read_batch(spec, doc, batch, institute_id, budget, force, log, queue)
            if got is None:
                continue
            done += got
            missing = [q for q in batch if not q.get("read")]
            fresh = [q for q in missing if q["number"] not in retried]
            if fresh:
                retried.update(q["number"] for q in fresh)
                log(f"    {len(fresh)} not returned ({[q['number'] for q in fresh]}), re-asking")
                queue.insert(0, fresh)
    except StepStopped as stop:
        budget.notes.append(str(stop))
        log(f"  read stopped: {stop}")
    store.log_run(doc, "read", transcribed=done, **budget.summary())
    store.save(spec.slug, doc)
    return {"transcribed": done}


def _read_batch(spec, doc, batch, institute_id, budget, force, log, queue) -> int | None:
    budget.check()
    pages = pages_for(spec, batch)
    nums = f"Q{batch[0]['number']}-{batch[-1]['number']}"
    before = attempts_now(TASK)
    try:
        out, trace = documents.ask(
            task=TASK, context=_context(spec, batch, pages),
            system_prompt=SYSTEM_PROMPT, response_schema=RESPONSE_SCHEMA,
            institute_id=institute_id, documents=[document_for(spec, doc, pages)],
            prompt_version=PROMPT_VERSION, temperature=0.0, force=force,
        )
    except (gemini.GeminiUnavailable, gemini.NoCredentialsAndNoCache) as exc:
        budget.attempts += attempts_now(TASK) - before
        if is_bad_json(exc) and len(batch) > 3:
            half = len(batch) // 2
            log(f"    {nums}: response did not parse (likely cut off) — splitting")
            budget.failed_batches += 1
            queue[:0] = [batch[:half], batch[half:]]
            return None
        raise StepStopped(classify_stop(exc)) from exc
    budget.count(trace, TASK, before)

    wanted = {q["number"]: q for q in batch}
    n = 0
    for item in out.get("questions", []):
        q = wanted.get(item.get("number"))
        if q is None or q.get("read"):
            continue
        q["read"] = accept(q, item, trace)
        n += 1
    flagged = sum(1 for q in batch if q.get("read") and q["read"]["issues"])
    src = "cache" if getattr(trace, "_from_cache", False) else trace.model
    log(f"  read {nums} pages {pages[0]}-{pages[-1]}: {n} transcribed, "
        f"{flagged} with issues  [{src}]")
    store.save(spec.slug, doc)
    return n
