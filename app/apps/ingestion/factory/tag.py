"""Step 5 — tag: chapter, difficulty, and a *draft* misconception for every wrong option.

Tagging happens after the cross-check and is told the official answer —
the point of tagging a distractor is to explain why a student would pick
it *instead of the right one*, which needs to know the right one. That is
safe here because tagging is not a verification step; the blind solve
already happened in its own traces.

Chapters come from the official syllabus trees in `data/syllabus/*.json`
when they exist (the model must choose one of those names, verbatim), so
a question links to a real chapter rather than a paraphrase of one.

Misconceptions are drafts. The model reuses an existing taxonomy code only
where it genuinely fits, otherwise proposes a new code with the belief
written as the student would hold it — or says "none" when a distractor is
just a slip, which is a perfectly good answer. New codes proposed earlier
in the same paper are fed back in, so one belief does not come out under
three different names. None of it is ever written to
`QuestionOption.misconception`; that FK is what diagnosis reads, and only
a person may set it.
"""

from __future__ import annotations

import json

from apps.ingestion.models import Misconception
from apps.reasoning.models import ReasoningTrace
from apps.reasoning.services import documents, gemini

from . import store, syllabus_dir
from .papers import PaperSpec
from .read import paper_label
from .runner import Budget, StepStopped, attempts_now, classify_stop, is_bad_json

#: v1 told the model that "none" was a good answer for a distractor, and a
#: Lite model took the invitation: 161 of 165 JEE distractors came back
#: "none", which leaves the product nothing to diagnose with. v2 makes it
#: first work out *how* each wrong option is produced (property ordering
#: puts that field first, so it reasons before it labels), and widens the
#: target from "a stable belief" to "the specific mistake" — conceptual or
#: procedural — which is what the product's taxonomy actually names
#: (MIS-ROT-AXIS is "used the centre-of-mass axis"). "none" stays available
#: for options no specific mistake produces.
PROMPT_VERSION = "tag-v2"
TASK = ReasoningTrace.TAG_QUESTIONS

#: Its own order, so tagging and solving draw on different per-model daily
#: quotas (the free tier allows 20 requests per model per day).
TAG_MODELS = [
    "gemini-3.1-flash-lite-preview",
    "gemini-flash-lite-latest",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
    "gemini-3.7-flash",
    "gemini-3-flash-preview",
]

SYLLABUS_FILES = {"NEET_UG": "neet_ug_2026.json", "JEE_MAIN": "jee_main_2026.json"}

SYSTEM_PROMPT = """You are a senior NEET/JEE teacher tagging official past-paper questions for a diagnostic product. For each question you are given its text, its options and the OFFICIAL correct answer (from NTA's key — treat it as correct).

For each question return:
1. chapter: the syllabus chapter it tests. If a chapter list is provided, copy one name from it exactly. If none fits, use "OTHER: <short name>".
2. difficulty: "easy", "medium" or "hard" for a typical serious aspirant.
3. distractors: one entry per WRONG option (never a correct one). Examiners build wrong options from the mistakes students actually make, so for each one:
   - how_produced FIRST: the specific wrong step that leads a student to this option (e.g. "used ML^2/12, the centre-of-mass axis, for rotation about the end"; "forgot to transpose"; "took the fact for X to be the fact for Y"). One sentence. Write it before deciding anything else.
   - kind "existing" if one of the existing misconception codes names exactly that mistake; "new" if the mistake is specific and nameable; "none" only if no specific mistake produces this option (an arbitrary value, or the option is a figure you cannot see).
   - code: for "existing", the code; for "new", propose "MIS-<AREA>-<SHORT>" (uppercase, at most 32 characters; reuse a draft code from earlier in this paper when it is the same mistake).
   - name: a short name for the mistake.
   - belief: the mistake in the student's voice ("I think ...", "I used ...").
Numerical questions have no options: return an empty distractors list.
"""

_DISTRACTOR_ORDER = ["label", "how_produced", "kind", "code", "name", "belief"]
RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "number": {"type": "integer"},
                    "chapter": {"type": "string"},
                    "difficulty": {"type": "string", "enum": ["easy", "medium", "hard"]},
                    "distractors": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string"},
                                "how_produced": {"type": "string"},
                                "kind": {"type": "string",
                                         "enum": ["existing", "new", "none"]},
                                "code": {"type": "string"},
                                "name": {"type": "string"},
                                "belief": {"type": "string"},
                            },
                            "required": ["label", "how_produced", "kind"],
                            "property_ordering": _DISTRACTOR_ORDER,
                        },
                    },
                },
                "required": ["number", "chapter", "difficulty", "distractors"],
                "property_ordering": ["number", "chapter", "difficulty", "distractors"],
            },
        }
    },
    "required": ["questions"],
}


def chapter_lists(exam_code: str) -> dict[str, list[str]]:
    """{subject: [chapter names]} from the official syllabus file, or {} if absent.

    NEET Biology chapters are listed under "Biology" and also under their
    Botany / Zoology section, so either label finds the full list.
    """
    path = syllabus_dir() / SYLLABUS_FILES.get(exam_code, "")
    if not path.is_file():
        return {}
    tree = json.loads(path.read_text(encoding="utf-8"))
    out: dict[str, list[str]] = {}
    for subject in tree.get("subjects", []):
        for unit in subject.get("units", []):
            for chapter in unit.get("chapters", []):
                out.setdefault(subject["name"], []).append(chapter["name"])
                section = (chapter.get("paper_section") or {}).get("section")
                if section:
                    out.setdefault(section, []).append(chapter["name"])
    return out


def chapters_for(lists: dict[str, list[str]], subject: str) -> list[str]:
    if subject in ("Biology", "Botany", "Zoology") and "Biology" in lists:
        return lists["Biology"]      # either section may draw on any Biology chapter
    return lists.get(subject, [])


def taxonomy(subject: str) -> list[dict]:
    wanted = {"Botany": "Biology", "Zoology": "Biology", "Mathematics": "Maths"}.get(
        subject, subject)
    return [
        {"code": m.code, "name": m.name, "belief": m.description[:300]}
        for m in Misconception.objects.filter(subject__in={subject, wanted}).order_by("code")
    ]


def run(spec: PaperSpec, doc: dict, *, institute_id: int, budget: Budget,
        force: bool = False, log=print) -> dict:
    lists = chapter_lists(spec.exam_code)
    for q in doc["questions"]:
        old = q.get("tags")
        if old and old.get("prompt_version") != PROMPT_VERSION:
            q.setdefault("tags_history", []).append(old)
            q["tags"] = None
    todo = [q for q in doc["questions"] if q.get("read") and (force or not q.get("tags"))]
    if force:
        for q in todo:
            q["tags"] = None
    # Batch within a subject, so the chapter list and taxonomy sent are the
    # subject's own and the context stays small.
    queue: list[list[dict]] = []
    current: list[dict] = []
    for q in todo:
        if current and (len(current) >= spec.tag_batch or q["subject"] != current[0]["subject"]):
            queue.append(current)
            current = []
        current.append(q)
    if current:
        queue.append(current)

    done = 0
    try:
        while queue:
            batch = queue.pop(0)
            done += _tag_batch(spec, doc, batch, lists, institute_id, budget, force, log,
                               queue) or 0
    except StepStopped as stop:
        budget.notes.append(str(stop))
        log(f"  tag stopped: {stop}")
    store.log_run(doc, "tag", tagged=done, **budget.summary())
    store.save(spec.slug, doc)
    return {"tagged": done}


def drafts_so_far(doc: dict, subject: str) -> list[dict]:
    seen: dict[str, dict] = {}
    for q in doc["questions"]:
        if q["subject"] != subject or not q.get("tags"):
            continue
        for d in q["tags"]["distractors"]:
            if d.get("kind") == "new" and d.get("code") and d["code"] not in seen:
                seen[d["code"]] = {"code": d["code"], "name": d.get("name", "")}
    return list(seen.values())


def _tag_batch(spec, doc, batch, lists, institute_id, budget, force, log, queue):
    budget.check()
    subject = batch[0]["subject"]
    context = {
        "exam": paper_label(spec),
        "subject": subject,
        "chapter_list": chapters_for(lists, subject) or None,
        "existing_misconceptions": taxonomy(subject),
        "draft_codes_from_this_paper": drafts_so_far(doc, subject),
        "questions": [
            {
                "number": q["number"],
                "answer_type": q["answer_type"],
                "text": q["read"]["text"],
                "options": [{"label": o["label"], "text": o["text"]}
                            for o in q["read"]["options"]],
                "official_answer": q["official"]["display"],
            }
            for q in batch
        ],
    }
    nums = f"Q{batch[0]['number']}-{batch[-1]['number']}"
    before = attempts_now(TASK)
    try:
        out, trace = documents.ask(
            task=TASK, context=context, system_prompt=SYSTEM_PROMPT,
            response_schema=RESPONSE_SCHEMA, institute_id=institute_id,
            prompt_version=PROMPT_VERSION, temperature=0.2, force=force,
            models=TAG_MODELS,
        )
    except (gemini.GeminiUnavailable, gemini.NoCredentialsAndNoCache) as exc:
        budget.attempts += attempts_now(TASK) - before
        if is_bad_json(exc) and len(batch) > 2:
            half = len(batch) // 2
            budget.failed_batches += 1
            queue[:0] = [batch[:half], batch[half:]]
            return None
        raise StepStopped(classify_stop(exc)) from exc
    budget.count(trace, TASK, before)

    known = {m["code"] for m in context["existing_misconceptions"]}
    chapters = set(context["chapter_list"] or [])
    wanted = {q["number"]: q for q in batch}
    n = 0
    for item in out.get("questions", []):
        q = wanted.get(item.get("number"))
        if q is None or q.get("tags"):
            continue
        wrong = {o["label"] for o in q["read"]["options"]} - set(q["official"]["labels"])
        distractors = []
        for d in item.get("distractors", []):
            label = str(d.get("label", "")).strip("() ")
            if label not in wrong:
                continue                     # never tag a correct option
            kind = d.get("kind") or "none"
            code = (d.get("code") or "").strip().upper()[:32]
            if kind == "existing" and code not in known:
                kind = "new"                 # claimed an existing code that isn't one
            if kind == "none":
                code = ""
            distractors.append({"label": label, "kind": kind, "code": code,
                                "how_produced": (d.get("how_produced") or "").strip(),
                                "name": (d.get("name") or "").strip()[:120],
                                "belief": (d.get("belief") or "").strip()})
        chapter = (item.get("chapter") or "").strip()
        q["tags"] = {
            "chapter": chapter,
            "chapter_in_syllabus": chapter in chapters,
            "difficulty": item.get("difficulty") or "",
            "distractors": distractors,
            "trace_id": trace.id, "model": trace.model, "prompt_version": PROMPT_VERSION,
        }
        n += 1
    src = "cache" if getattr(trace, "_from_cache", False) else trace.model
    log(f"  tag {nums} ({subject}): {n} tagged  [{src}]")
    store.save(spec.slug, doc)
    return n
