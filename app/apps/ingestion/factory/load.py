"""Step 6 — load into the database as a TestPaper a director recognises.

Additive and narrow by construction:

* It only ever touches the one TestPaper whose name it owns
  ("NEET UG 2025 · Code 45 · Official"), and refuses if a paper of that
  name exists that is not an official past paper, or that has a single
  attempt recorded against it. Demo papers, students and attempts cannot
  be reached from here.
* Every question loads with `source=official_pyq`, its citation, NTA's
  official answer, the model's blind answer, and the cross-check verdict.
  Agreed questions are *accepted*; disagreements and unverifiable ones load
  too, but carry their verdict so nothing downstream can mistake them for
  checked.
* `confirmed_at` is left empty on every question. In this schema it means
  "a person confirmed the chapter mapping" (see the admin's mapping
  queue), and no person has. A machine cross-check is recorded in
  `verification`, not passed off as a human confirmation.
* Draft misconceptions go in `draft_misconception_*`, never in the
  `misconception` FK that diagnosis reads.
"""

from __future__ import annotations

from collections import Counter

from django.db import transaction
from django.utils import timezone

from apps.events.models import Attempt
from apps.ingestion.models import QuestionOption, QuestionTopicMap, Source, TestPaper
from apps.syllabus.models import Exam, SyllabusVersion, Topic

from . import store
from .papers import PaperSpec

OPTION_MAX = QuestionOption._meta.get_field("text").max_length
DIFFICULTIES = {"easy", "medium", "hard"}


class LoadRefused(RuntimeError):
    """Loading would touch something it must not, or has nothing to load."""


def find_exam(spec: PaperSpec) -> Exam:
    for code in (spec.exam_code, *spec.exam_code_aliases):
        exam = Exam.objects.filter(code=code).first()
        if exam:
            return exam
    raise LoadRefused(
        f"Exam {spec.exam_code} does not exist in the database yet. The syllabus "
        f"loader creates it: manage.py load_official_syllabus --exam {spec.exam_code} "
        f"--institute <slug>. The factory does not create exams."
    )


def topic_index(institute, exam) -> tuple[dict, SyllabusVersion | None]:
    """Chapters of the institute's official NTA tree for this exam, by (subject, name).

    Only the official tree: the demo's version 1 was typed from memory, and
    linking a real question to a placeholder chapter would launder it.
    """
    version = (SyllabusVersion.objects
               .filter(institute=institute, exam=exam, note__startswith="Official NTA")
               .order_by("-version").first())
    if version is None:
        return {}, None
    index = {}
    for t in Topic.objects.filter(syllabus=version, kind=Topic.CHAPTER).select_related(
            "parent__parent", "parent"):
        root = t
        while root.parent_id is not None:
            root = root.parent
        index[(root.name, t.name)] = t
        index.setdefault(("*", t.name), t)
    return index, version


def resolve_topic(index: dict, subject: str, chapter: str):
    if not chapter or chapter.startswith("OTHER"):
        return None
    return index.get((subject, chapter)) or index.get(("*", chapter))


def load(spec: PaperSpec, doc: dict, institute, *, replace: bool = False) -> dict:
    exam = find_exam(spec)
    ready = [q for q in doc["questions"] if q.get("read")]
    if not ready:
        raise LoadRefused("Nothing has been read yet — run `factory read` first.")
    too_long = [(q["number"], o["label"]) for q in ready for o in q["read"]["options"]
                if len(o["text"]) > OPTION_MAX]
    if too_long:
        raise LoadRefused(f"Option text longer than {OPTION_MAX} characters: {too_long}")

    with transaction.atomic():
        paper = TestPaper.objects.filter(institute=institute, name=spec.display_name).first()
        if paper is not None:
            if paper.source != Source.OFFICIAL_PYQ:
                raise LoadRefused(f"A non-official paper is already called "
                                  f"'{spec.display_name}'. Refusing to touch it.")
            if Attempt.objects.filter(test_paper=paper).exists():
                raise LoadRefused(f"'{spec.display_name}' has attempts recorded against it; "
                                  f"rebuilding it would orphan them.")
            if not replace:
                raise LoadRefused(f"'{spec.display_name}' is already loaded. Pass --replace "
                                  f"to rebuild it from the extracted file.")
            paper.question_map.all().delete()
        else:
            paper = TestPaper(institute=institute, name=spec.display_name)

        index, version = topic_index(institute, exam)
        verdicts = Counter((q.get("check") or {}).get("status", "") for q in ready)
        paper.exam = exam
        paper.held_on = spec.held_on
        paper.total_questions = len(ready)
        paper.max_marks = len(ready) * spec.marks_correct
        paper.marks_correct = spec.marks_correct
        paper.marks_wrong = spec.marks_wrong
        paper.duration_min = spec.duration_min
        paper.source = Source.OFFICIAL_PYQ
        paper.exam_year = spec.year
        paper.shift_or_booklet = spec.shift_or_booklet
        paper.provenance = {
            "question_paper": doc["paper"]["question_paper"],
            "answer_key": doc["paper"]["answer_key"],
            "booklet_check": doc["paper"].get("booklet_check"),
            "answer_rule": doc["paper"]["answer_rule"],
            "questions_in_paper": spec.total_questions,
            "questions_loaded": len(ready),
            "cross_check": dict(verdicts),
            "syllabus_version_id": version.id if version else None,
            "extracted_file": f"data/extracted/{spec.slug}.json",
            "loaded_at": store.now(),
        }
        paper.save()

        made = Counter()
        for q in ready:
            made.update(_load_question(spec, paper, institute, q, index))
    return {"paper": paper, "loaded": len(ready), "of": spec.total_questions,
            "verdicts": dict(verdicts), "made": dict(made),
            "syllabus_version": version}


def _load_question(spec, paper, institute, q, index) -> Counter:
    read, check, tags = q["read"], q.get("check") or {}, q.get("tags") or {}
    official, solve = q["official"], q.get("solve") or {}
    topic = resolve_topic(index, q["subject"], tags.get("chapter", ""))
    numeric = None
    if q["answer_type"] == "numerical" and official["numeric"]:
        numeric = float(official["numeric"])

    row = QuestionTopicMap.objects.create(
        institute=institute, test_paper=paper,
        question_id=f"Q{q['number']}",
        topic=topic,
        question_text=read["text"],
        difficulty=tags.get("difficulty") if tags.get("difficulty") in DIFFICULTIES else "",
        proposed_by=QuestionTopicMap.LLM,
        source=Source.OFFICIAL_PYQ,
        source_ref=spec.source_ref(q["number"]),
        nta_question_id=q["question_id"],
        subject_name=q["subject"],
        chapter_name=tags.get("chapter", ""),
        answer_type=q["answer_type"],
        official_answer=official["display"],
        numeric_answer=numeric,
        model_answer=check.get("model", solve.get("answer", "")),
        verification=check.get("status", ""),
        verification_detail={
            "why": check.get("why", ""),
            "model_confidence": solve.get("confidence", ""),
            "model_working": solve.get("working", ""),
            "model_issue": solve.get("issue", ""),
            "model_saw_pages": solve.get("saw_pages", []),
            "read_issues": read.get("issues", []),
            "legibility": read.get("legibility", ""),
            "option_ids": q["option_ids"],
            "pages": q["pages"],
            "traces": {"read": read.get("trace_id"), "solve": solve.get("trace_id"),
                       "tag": tags.get("trace_id")},
            # A first look at a disagreement, written by the agent that ran
            # the factory — explicitly not a human review. It does not change
            # `verification`; a person still decides.
            "agent_review": q.get("agent_review"),
        },
        has_diagram=read["has_diagram"],
    )
    drafts = {d["label"]: d for d in tags.get("distractors", [])}
    QuestionOption.objects.bulk_create([
        QuestionOption(
            question=row, label=o["label"], text=o["text"],
            is_correct=o["label"] in official["labels"],
            draft_misconception_code=(drafts.get(o["label"]) or {}).get("code", ""),
            draft_misconception=(
                {"kind": drafts[o["label"]]["kind"],
                 "is_new": drafts[o["label"]]["kind"] == "new",
                 "how_produced": drafts[o["label"]].get("how_produced", ""),
                 "name": drafts[o["label"]]["name"],
                 "belief": drafts[o["label"]]["belief"],
                 "trace_id": tags.get("trace_id"), "status": "draft"}
                if o["label"] in drafts else None
            ),
        )
        for o in read["options"]
    ])
    return Counter({"questions": 1, "options": len(read["options"]),
                    "linked_topic": 1 if topic else 0,
                    "draft_tags": sum(1 for d in drafts.values() if d["code"])})


def render(result: dict) -> str:
    paper = result["paper"]
    v = result["verdicts"]
    sv = result["syllabus_version"]
    return "\n".join([
        f"  loaded '{paper.name}' (id {paper.id}) under {paper.institute.slug}: "
        f"{result['loaded']} of {result['of']} questions, "
        f"{result['made'].get('options', 0)} options",
        f"  accepted (agreed) {v.get('agreed', 0)} · unconfirmed: disagreed "
        f"{v.get('disagreed', 0)}, unverifiable {v.get('unverifiable', 0)}, "
        f"not yet checked {v.get('', 0)}",
        f"  chapters linked to the official syllabus: {result['made'].get('linked_topic', 0)}"
        + (f" (version {sv.version}, id {sv.id})" if sv else
           " — no official syllabus version loaded for this exam yet; chapter kept as text"),
        f"  draft misconception tags: {result['made'].get('draft_tags', 0)} "
        f"(drafts only — QuestionOption.misconception left empty)",
        f"  loaded at {timezone.now():%Y-%m-%d %H:%M}",
    ])
