"""The paper blueprint: which chapter each question tests, and its right answer.

This is the first rung of the mapping ladder in TECHNICAL_DOC §8.2 — "the
institute already tags by chapter" — and the gate in front of everything else.
A student's answer is only a number until it is attached to a chapter and
marked against a key, and neither can be inferred at upload time. So an
institute sets the blueprint once, per paper, and every student's results file
is read against it.

    question_id, chapter, correct_option
    Q1,          Kinematics, B
    Q2,          Thermodynamics, D
    ...

Columns (any case; the common alternative wordings are accepted):

    question_id      required. Unique within the paper. "Q1", "D16", "17".
    chapter          required unless topic_id. The chapter's name.
    subject          optional. Needed only where one chapter name exists in two
                     subjects — "Thermodynamics" is both Physics and Chemistry.
    topic_id         optional. The chapter's id, instead of its name.
    correct_option   A–D for a multiple-choice question…
    answer           …or a number for a numerical-value question. One of the two.
    difficulty       optional: easy / medium / hard.

ALL OR NOTHING
    Unlike results, a blueprint with one bad row writes nothing. A half-applied
    key is worse than none: students would be marked against a paper whose
    questions 1–40 are right and 41–45 are absent, and the totals would look
    plausible. The report lists every problem at once so one round trip fixes
    them all, and `dry_run` lets someone find them before committing.

A KEY CANNOT CHANGE UNDER RESULTS
    Re-uploading an identical blueprint is a no-op. Re-uploading a corrected
    key changes it — unless students already have answers recorded against that
    question, in which case it is refused: their stored `correct`/`wrong` and
    marks were decided by the old key, and quietly changing the key would leave
    them marked against one that no longer exists. (Correcting a key after
    results are in is a real need; it deserves a deliberate re-marking step,
    not a side effect of a CSV.)
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from django.db import transaction
from django.utils import timezone

from apps.events.models import Attempt
from apps.ingestion.models import QuestionOption, QuestionTopicMap, Source, TestPaper
from apps.syllabus.models import SyllabusVersion, Topic

from .tabular import Table, canonical_header

ALIASES = {
    "question_id": ["question", "q", "qno", "q no", "question no", "question number", "q id"],
    "chapter": ["chapter name", "topic", "topic name"],
    "subject": [],
    "topic_id": ["topic id", "chapter id"],
    "correct_option": ["correct", "key", "answer key", "correct answer", "option"],
    "answer": ["numeric answer", "numerical answer", "value"],
    "difficulty": ["level"],
}

OPTION_LABELS = "ABCD"
DIFFICULTIES = {"easy", "medium", "hard"}
MAX_REPORTED_ERRORS = 100


@dataclass
class RowError:
    row: int
    question_id: str
    message: str


@dataclass
class BlueprintReport:
    dry_run: bool
    paper_id: int
    questions_in_file: int = 0
    created: int = 0
    updated: int = 0
    unchanged: int = 0
    errors: list[RowError] = field(default_factory=list)
    errors_total: int = 0
    #: Questions the paper is said to have (`total_questions`) that the file
    #: does not cover. A warning, not an error: a half-length mock is real.
    expected_questions: int = 0

    @property
    def ok(self) -> bool:
        return self.errors_total == 0

    def error(self, row: int, question_id: str, message: str) -> None:
        self.errors_total += 1
        if len(self.errors) < MAX_REPORTED_ERRORS:
            self.errors.append(RowError(row, question_id, message))


def _chapters_by_name(paper: TestPaper) -> dict[str, list[Topic]]:
    """Chapters of this institute's active syllabus for the paper's exam."""
    syllabus = (
        SyllabusVersion.objects.filter(
            institute_id=paper.institute_id, exam_id=paper.exam_id, is_active=True
        ).order_by("-version").first()
    )
    if syllabus is None:
        return {}
    out: dict[str, list[Topic]] = {}
    for topic in Topic.objects.filter(syllabus=syllabus, kind=Topic.CHAPTER).select_related(
        "parent__parent"
    ):
        out.setdefault(topic.name.strip().lower(), []).append(topic)
    return out


def _subject_of(topic: Topic) -> str:
    node = topic
    while node.parent_id is not None:
        node = node.parent
    return node.name


def _parse_number(text: str) -> float | None:
    try:
        value = float(text)
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def import_blueprint(*, paper: TestPaper, table: Table, user, dry_run: bool = False) -> BlueprintReport:
    report = BlueprintReport(dry_run=dry_run, paper_id=paper.id, expected_questions=paper.total_questions)
    header = canonical_header(table.header, ALIASES)
    index = {name: i for i, name in enumerate(header)}

    if "question_id" not in index:
        report.error(1, "", "There is no question column. Name it question_id (or Q, Qno).")
    if "chapter" not in index and "topic_id" not in index:
        report.error(1, "", "There is no chapter column. Name it chapter, or use topic_id.")
    if "correct_option" not in index and "answer" not in index:
        report.error(1, "", "There is no answer column. Use correct_option (A–D) or answer (a number).")
    if report.errors_total:
        return report

    chapters = _chapters_by_name(paper)
    chapters_by_id = {t.id: t for ts in chapters.values() for t in ts}

    def cell(cells, name):
        i = index.get(name)
        return cells[i].strip() if i is not None and i < len(cells) else ""

    existing = {
        q.question_id.lower(): q
        for q in QuestionTopicMap.objects.filter(test_paper=paper).prefetch_related("options")
    }
    answered = {
        qid.lower() for qid in
        Attempt.objects.filter(test_paper=paper).values_list("question_id", flat=True).distinct()
    }

    plan: list[dict] = []
    seen: dict[str, int] = {}
    for line, cells in table.rows:
        qid = cell(cells, "question_id")
        if not qid:
            report.error(line, "", "This row has no question id.")
            continue
        if qid.lower() in seen:
            report.error(line, qid, f"{qid} appears twice (first on row {seen[qid.lower()]}).")
            continue
        seen[qid.lower()] = line

        # --- the chapter
        topic = None
        if cell(cells, "topic_id"):
            raw = cell(cells, "topic_id")
            topic = chapters_by_id.get(int(raw)) if raw.isdigit() else None
            if topic is None:
                report.error(line, qid, f"topic_id {raw} is not a chapter of your {paper.exam.name} syllabus.")
                continue
        else:
            name = cell(cells, "chapter")
            matches = chapters.get(name.lower(), [])
            wanted = cell(cells, "subject").lower()
            if wanted:
                matches = [t for t in matches if _subject_of(t).lower() == wanted]
            if not matches:
                report.error(line, qid, f"'{name}' is not a chapter of your {paper.exam.name} syllabus.")
                continue
            if len(matches) > 1:
                subjects = ", ".join(sorted(_subject_of(t) for t in matches))
                report.error(line, qid, f"'{name}' exists in more than one subject ({subjects}). "
                                        "Add a subject column.")
                continue
            topic = matches[0]

        # --- the key
        letter, number = cell(cells, "correct_option").upper(), cell(cells, "answer")
        if letter and number:
            report.error(line, qid, "Give either a correct option or a numeric answer, not both.")
            continue
        if letter:
            if letter in "1234" and len(letter) == 1:
                letter = OPTION_LABELS["1234".index(letter)]
            if letter not in tuple(OPTION_LABELS):
                report.error(line, qid, f"'{letter}' is not one of {', '.join(OPTION_LABELS)}.")
                continue
            kind, key = QuestionTopicMap.MCQ, letter
        elif number:
            value = _parse_number(number)
            if value is None:
                report.error(line, qid, f"'{number}' is not a number.")
                continue
            kind, key = QuestionTopicMap.NUMERICAL, value
        else:
            report.error(line, qid, "This row has no answer.")
            continue

        difficulty = cell(cells, "difficulty").lower()
        if difficulty and difficulty not in DIFFICULTIES:
            report.error(line, qid, f"Difficulty must be easy, medium or hard, not '{difficulty}'.")
            continue

        plan.append({"line": line, "qid": qid, "topic": topic, "kind": kind, "key": key,
                     "difficulty": difficulty})

    report.questions_in_file = len(seen)

    # --- decide what each row would do, refusing key changes under results
    actions = []
    for item in plan:
        current = existing.get(item["qid"].lower())
        if current is None:
            actions.append(("create", item, None))
        elif _same_key(current, item):
            # Chapter and key agree. Difficulty is a label with no bearing on
            # how anyone was marked, so it may change even under results.
            same = current.difficulty == item["difficulty"]
            actions.append(("unchanged" if same else "relabel", item, current))
        elif item["qid"].lower() in answered:
            report.error(item["line"], item["qid"],
                         "Students already have answers recorded for this question, so its "
                         "chapter and key cannot be changed here.")
        else:
            actions.append(("update", item, current))

    if report.errors_total:
        return report                                     # all or nothing

    report.created = sum(1 for a, *_ in actions if a == "create")
    report.updated = sum(1 for a, *_ in actions if a in ("update", "relabel"))
    report.unchanged = sum(1 for a, *_ in actions if a == "unchanged")
    if dry_run:
        return report

    with transaction.atomic():
        now = timezone.now()
        for action, item, current in actions:
            if action == "unchanged":
                continue
            if action == "relabel":
                current.difficulty = item["difficulty"]
                current.save(update_fields=["difficulty"])
                continue
            fields = dict(
                topic=item["topic"], answer_type=item["kind"],
                official_answer=item["key"] if item["kind"] == QuestionTopicMap.MCQ else format(item["key"], "g"),
                numeric_answer=item["key"] if item["kind"] == QuestionTopicMap.NUMERICAL else None,
                difficulty=item["difficulty"],
                subject_name=_subject_of(item["topic"]), chapter_name=item["topic"].name,
                proposed_by=QuestionTopicMap.BLUEPRINT, confirmed_by=user, confirmed_at=now,
            )
            if action == "create":
                question = QuestionTopicMap.objects.create(
                    institute_id=paper.institute_id, test_paper=paper, question_id=item["qid"],
                    source=Source.INSTITUTE, **fields,
                )
            else:
                question = current
                for name, value in fields.items():
                    setattr(question, name, value)
                question.save()
                question.options.all().delete()
            if item["kind"] == QuestionTopicMap.MCQ:
                QuestionOption.objects.bulk_create([
                    QuestionOption(question=question, label=label, text="",
                                   is_correct=(label == item["key"]))
                    for label in OPTION_LABELS
                ])
    return report


def _same_key(question: QuestionTopicMap, item: dict) -> bool:
    """Same chapter and same right answer — the part results were marked against."""
    if question.topic_id != item["topic"].id or question.answer_type != item["kind"]:
        return False
    if item["kind"] == QuestionTopicMap.NUMERICAL:
        return question.numeric_answer is not None and math.isclose(
            question.numeric_answer, item["key"], rel_tol=1e-9, abs_tol=1e-9)
    correct = [o.label for o in question.options.all() if o.is_correct]
    return correct == [item["key"]]
