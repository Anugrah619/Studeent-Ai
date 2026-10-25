"""A class's results file → attempts. The step that turns marks into evidence.

Until this existed, every attempt in the system came from a seeder. This is
the road real data comes in on, and it is built around three promises.

1. **A student is ingested completely, or not at all.**
   One unreadable cell — a stray "E" in an A–D column — fails that student's
   whole row, and none of their answers are written. A half-ingested student
   is worse than an absent one: their score would be wrong in a way that looks
   plausible, and the analysis would be confidently built on the part that
   happened to parse. The other students in the file are unaffected, and every
   failure is reported with its row so the file can be fixed and re-sent.

2. **An unmapped question stops the upload.**
   "An unmapped question is a number with no meaning" (§8.2). If the file
   mentions a question the paper's blueprint does not know, or one with no
   answer key, nothing is written — silently dropping a column would make
   every student's total wrong and every "marks lost" figure understate. The
   report names the questions; the fix is the blueprint, once, for everyone.

3. **Re-sending is always safe.**
   The same file twice is refused outright (`IngestBatch.file_hash`). A
   corrected file that overlaps the first writes only what is new: an answer
   already recorded for (student, paper, question) is skipped and counted,
   never doubled. The event log is append-only, and a duplicate is not a
   correction.

TWO LAYOUTS, ONE PARSER
    Wide — one row per student, a column per question::

        roll_no, Q1, Q2, Q3 …
        A-1041,  B,  A,       D

    Long — one row per answer::

        roll_no, question_id, answer, time_spent
        A-1041,  Q1,          B,      95

    Wide is what OMR exports look like; long is what an app would send and the
    only layout that carries per-question time. Which one a file is follows
    from its columns, so the institute never has to say. Either layout may
    arrive as a CSV or as an `.xlsx` workbook; `tabular.read_table` hands both
    over as the same strings.

WHAT A CELL MEANS
    A–D (or 1–4, which NTA's own keys use) is the option chosen. A numeric-value
    question takes a number, compared to the key with a tolerance. Empty, "-",
    "skip" or "NA" is a question the student *chose* to leave; "NR" is one they
    ran out of time before reaching. The distinction is the one the whole
    marks-lost taxonomy rests on, so it is never guessed: a blank is a blank.
    Marking follows the paper's own scheme.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import logging
import math
import re
from collections import defaultdict
from dataclasses import dataclass, field

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.events.models import Attempt
from apps.ingestion.models import IngestBatch, QuestionTopicMap, TestPaper
from apps.tenancy.models import Student

from .tabular import Table, UnreadableFile, canonical_header

logger = logging.getLogger(__name__)

ALIASES = {
    "roll_no": ["roll", "roll number", "rollno", "roll no", "reg no", "registration number",
                "enrollment no", "enrolment no"],
    "batch": [],
    "question_id": ["question", "q", "qno", "q no", "question no", "question number", "q id"],
    "answer": ["response", "chosen", "chosen option", "marked", "marked option", "option",
               "answer given", "given answer", "selected"],
    "time_spent": ["time", "seconds", "time taken", "time spent"],
    # Columns an export carries that are about the student or the total, not a
    # question. Recognised so they are not mistaken for question columns.
    "ignore": ["name", "student name", "student", "email", "phone", "mobile", "total", "score",
               "marks", "rank", "air", "percentile", "percent", "percentage", "correct", "wrong",
               "incorrect", "unattempted", "attempted", "result", "remarks", "total marks",
               "marks obtained"],
}
#: These and nothing else are the fields a saved column mapping may name.
MAPPABLE_FIELDS = frozenset({"roll_no", "batch", "question_id", "answer", "time_spent", "ignore"})

BLANK_TOKENS = {"", "-", "--", "na", "n/a", "skip", "skipped", "blank", "none", "unattempted"}
NOT_REACHED_TOKENS = {"nr", "n r", "not reached", "not_reached", "ran out of time"}
OPTION_LABELS = "ABCD"

MAX_REPORTED_ERRORS = 100
#: Midday on the day of the paper. Attempts need a timestamp and a results
#: file has none; the date of the sitting is the honest part of it.
SITTING_TIME = dt.time(12, 0)


class AlreadyImported(Exception):
    def __init__(self, batch: IngestBatch):
        super().__init__(f"already imported as batch {batch.id}")
        self.batch = batch


@dataclass
class RowError:
    row: int
    roll_no: str
    message: str


@dataclass
class ResultsReport:
    dry_run: bool
    paper_id: int
    layout: str = ""
    students_in_file: int = 0
    students_ingested: int = 0
    students_already_recorded: int = 0
    students_failed: int = 0
    attempts_created: int = 0
    attempts_already_recorded: int = 0
    batch_id: int | None = None
    errors: list[RowError] = field(default_factory=list)
    errors_total: int = 0
    unmapped_questions: list[str] = field(default_factory=list)
    unkeyed_questions: list[str] = field(default_factory=list)
    ignored_columns: list[str] = field(default_factory=list)
    questions_not_in_file: list[str] = field(default_factory=list)
    flags_raised: int | None = None
    derived_refreshed: bool = False
    #: Set on a dry run when this exact file has already been imported, so the
    #: check finds out before the real upload is refused.
    duplicate_of_batch: int | None = None

    @property
    def refused(self) -> bool:
        """The file could not be used at all — nothing to do with any one student."""
        return bool(self.unmapped_questions or self.unkeyed_questions)

    @property
    def ok(self) -> bool:
        """Whether a real run would write anything (or has nothing left to write)."""
        return (
            not self.refused
            and self.duplicate_of_batch is None
            and (self.students_ingested > 0 or self.students_already_recorded > 0)
        )

    def error(self, row: int, roll_no: str, message: str) -> None:
        self.errors_total += 1
        if len(self.errors) < MAX_REPORTED_ERRORS:
            self.errors.append(RowError(row, roll_no, message))


# ------------------------------------------------------------------ questions


@dataclass(frozen=True)
class Question:
    pk: int
    question_id: str
    topic_id: int | None
    answer_type: str
    correct_label: str | None
    numeric_answer: float | None

    @property
    def keyed(self) -> bool:
        if self.answer_type == QuestionTopicMap.NUMERICAL:
            return self.numeric_answer is not None
        return self.correct_label is not None


def _qkey(text: str) -> str:
    """`Q.1`, `q 1` and `Q1` are the same question."""
    return re.sub(r"[\s_.\-]", "", text).lower()


def load_questions(paper: TestPaper) -> dict[str, Question]:
    """The paper's questions by normalised id, plus a digits-only alias.

    Exports often head the columns `1, 2, 3` where the paper says `Q1, Q2`.
    The bare number is accepted when it is unambiguous — one question ends in
    that number — and not otherwise, so a paper with both P1 and C1 never has
    a "1" guessed at.
    """
    out: dict[str, Question] = {}
    trailing: dict[str, list[Question]] = defaultdict(list)
    for q in QuestionTopicMap.objects.filter(test_paper=paper).prefetch_related("options"):
        correct = [o.label for o in q.options.all() if o.is_correct]
        question = Question(
            pk=q.pk, question_id=q.question_id, topic_id=q.topic_id, answer_type=q.answer_type,
            correct_label=correct[0] if len(correct) == 1 else None,
            numeric_answer=q.numeric_answer,
        )
        out[_qkey(q.question_id)] = question
        match = re.search(r"(\d+)$", q.question_id)
        if match:
            trailing[str(int(match.group(1)))].append(question)
    for number, candidates in trailing.items():
        if len(candidates) == 1 and number not in out:
            out[number] = candidates[0]
    return out


# --------------------------------------------------------------------- cells


@dataclass(frozen=True)
class Parsed:
    status: str
    chosen: str
    marks: float
    #: Seconds on the question. Only the long layout can carry it.
    time_spent: int | None = None


def parse_cell(raw: str, q: Question, paper: TestPaper) -> Parsed:
    """One answer → its status, the option chosen and the marks. Raises ValueError."""
    text = raw.strip()
    lowered = text.lower()
    if lowered in NOT_REACHED_TOKENS:
        return Parsed(Attempt.NOT_REACHED, "", 0.0)
    if lowered in BLANK_TOKENS:
        return Parsed(Attempt.BLANK, "", 0.0)

    if q.answer_type == QuestionTopicMap.NUMERICAL:
        try:
            value = float(text)
        except ValueError:
            raise ValueError(f"'{raw}' is not a number (question {q.question_id}).") from None
        if not math.isfinite(value):
            raise ValueError(f"'{raw}' is not a number (question {q.question_id}).")
        right = math.isclose(value, q.numeric_answer, rel_tol=1e-9, abs_tol=1e-9)
        return Parsed(
            Attempt.CORRECT if right else Attempt.WRONG, "",
            float(paper.marks_correct if right else paper.marks_wrong),
        )

    label = text.upper()
    if len(label) == 1 and label in "1234":
        label = OPTION_LABELS["1234".index(label)]
    if label not in tuple(OPTION_LABELS):
        raise ValueError(
            f"'{raw}' is not an option for question {q.question_id} "
            f"(use {', '.join(OPTION_LABELS)}, or leave it blank)."
        )
    right = label == q.correct_label
    return Parsed(
        Attempt.CORRECT if right else Attempt.WRONG, label,
        float(paper.marks_correct if right else paper.marks_wrong),
    )


# ------------------------------------------------------------------- students


@dataclass
class Submission:
    line: int
    roll_no: str
    batch: str
    #: (line, question key, raw cell, raw time)
    answers: list[tuple[int, str, str, str]] = field(default_factory=list)


class StudentIndex:
    """Resolve a roll number (and optionally a batch) to exactly one student."""

    def __init__(self, institute_id: int):
        self.by_roll: dict[str, list[Student]] = defaultdict(list)
        for s in Student.objects.filter(institute_id=institute_id).select_related("batch"):
            self.by_roll[s.roll_no.strip().lower()].append(s)

    def find(self, roll_no: str, batch: str) -> Student:
        candidates = self.by_roll.get(roll_no.strip().lower(), [])
        if batch:
            candidates = [s for s in candidates if s.batch.name.strip().lower() == batch.strip().lower()]
        if not candidates:
            where = f" in batch '{batch}'" if batch else ""
            raise LookupError(f"No student with roll number {roll_no}{where}.")
        if len(candidates) > 1:
            names = ", ".join(sorted(s.batch.name for s in candidates))
            raise LookupError(
                f"Roll number {roll_no} exists in more than one batch ({names}). "
                "Add a batch column."
            )
        return candidates[0]


# ----------------------------------------------------------------- the import


def import_results(
    *, paper: TestPaper, table: Table, filename: str, file_hash: str,
    column_map: dict[str, str] | None = None, dry_run: bool = False,
) -> ResultsReport:
    report = ResultsReport(dry_run=dry_run, paper_id=paper.id)

    previous = IngestBatch.objects.filter(
        institute_id=paper.institute_id, file_hash=file_hash
    ).first()
    if previous is not None:
        if not dry_run:
            raise AlreadyImported(previous)
        report.duplicate_of_batch = previous.id

    header = canonical_header(table.header, ALIASES, column_map, repeatable=frozenset({"ignore"}))
    if "roll_no" not in header:
        raise UnreadableFile("There is no roll number column. Name it roll_no (or Roll No).")
    positions = {name: i for i, name in enumerate(header) if name != "ignore"}
    report.ignored_columns = [table.header[i] for i, n in enumerate(header) if n == "ignore"]

    questions = load_questions(paper)
    submissions, referenced = _read_submissions(table, header, positions, questions, report)

    # --- the gate: every question the file mentions must be mapped and keyed
    for key in sorted(referenced):
        q = questions.get(key)
        if q is None:
            report.unmapped_questions.append(referenced[key])
        elif q.topic_id is None:
            report.unmapped_questions.append(q.question_id)
        elif not q.keyed:
            report.unkeyed_questions.append(q.question_id)
    mentioned = {questions[k].question_id for k in referenced if k in questions}
    report.questions_not_in_file = sorted(
        {q.question_id for q in questions.values()} - mentioned
    )
    if report.refused:
        return report

    # --- per student, all or nothing
    index = StudentIndex(paper.institute_id)
    resolved: list[tuple[Student, dict[str, Parsed]]] = []
    seen: dict[int, int] = {}
    for sub in submissions:
        report.students_in_file += 1
        try:
            student = index.find(sub.roll_no, sub.batch)
        except LookupError as exc:
            report.students_failed += 1
            report.error(sub.line, sub.roll_no, str(exc))
            continue
        if student.id in seen:
            report.students_failed += 1
            report.error(sub.line, sub.roll_no,
                         f"{sub.roll_no} appears twice (first on row {seen[student.id]}).")
            continue
        seen[student.id] = sub.line

        parsed: dict[str, Parsed] = {}
        problems: list[str] = []
        for _, key, raw, raw_time in sub.answers:
            q = questions[key]
            if q.question_id in parsed:
                problems.append(f"Question {q.question_id} is answered twice.")
                continue
            try:
                cell = parse_cell(raw, q, paper)
            except ValueError as exc:
                problems.append(str(exc))
                continue
            parsed[q.question_id] = (
                dataclasses.replace(cell, time_spent=int(float(raw_time))) if raw_time else cell
            )
        if problems:
            report.students_failed += 1
            for message in problems:
                report.error(sub.line, sub.roll_no, message)
            continue
        resolved.append((student, parsed))

    # --- skip what is already on file
    known = set(
        Attempt.objects.filter(
            test_paper=paper, student_id__in=[s.id for s, _ in resolved]
        ).values_list("student_id", "question_id")
    )
    to_write: list[tuple[Student, str, Parsed]] = []
    ingested: set[int] = set()
    for student, parsed in resolved:
        fresh = [(qid, p) for qid, p in parsed.items() if (student.id, qid) not in known]
        report.attempts_already_recorded += len(parsed) - len(fresh)
        if not fresh:
            report.students_already_recorded += 1
            continue
        report.students_ingested += 1
        ingested.add(student.id)
        to_write.extend((student, qid, p) for qid, p in fresh)
    report.attempts_created = len(to_write)

    if dry_run or not to_write:
        return report

    sitting = timezone.make_aware(dt.datetime.combine(paper.held_on, SITTING_TIME))
    topic_of = {q.question_id: q.topic_id for q in questions.values()}

    try:
        with transaction.atomic():
            batch = IngestBatch.objects.create(
                institute_id=paper.institute_id, filename=filename[:500], file_hash=file_hash,
                test_paper=paper, row_count=report.students_in_file,
                rows_ok=report.students_ingested, rows_failed=report.students_failed,
                status=IngestBatch.DONE,
                raw_snapshot={"header": table.header, "rows": [cells for _, cells in table.rows]},
            )
            Attempt.objects.bulk_create([
                Attempt(
                    institute_id=paper.institute_id, student=student, topic_id=topic_of[qid],
                    test_paper=paper, question_id=qid, status=p.status, chosen_option=p.chosen,
                    time_spent=p.time_spent, marks=p.marks,
                    source=Attempt.MOCK, ts=sitting, ingest_batch=batch,
                )
                for student, qid, p in to_write
            ], batch_size=2000)
    except IntegrityError:
        # Two identical uploads raced and the other won the unique
        # (institute, file_hash) constraint. Report it as the duplicate it is.
        winner = IngestBatch.objects.filter(
            institute_id=paper.institute_id, file_hash=file_hash
        ).first()
        if winner is None:                                  # pragma: no cover
            raise
        raise AlreadyImported(winner) from None
    report.batch_id = batch.id

    _refresh_derived(paper.institute_id, sorted(ingested), report)
    return report


def _read_submissions(table, header, positions, questions, report):
    """Rows → one Submission per student, in either layout.

    Returns the submissions and `{question key: the id as the file wrote it}`
    for every question the file mentions, so the gate can name the ones the
    paper does not know in the institute's own words.
    """
    roll_i, batch_i = positions["roll_no"], positions.get("batch")
    long_layout = "question_id" in positions and "answer" in positions
    if ("question_id" in positions) != ("answer" in positions):
        raise UnreadableFile(
            "The file has a question column or an answer column but not both. "
            "Either give one column per question, or question_id with answer."
        )
    report.layout = "long" if long_layout else "wide"

    def cell(cells, i):
        return cells[i].strip() if i is not None and i < len(cells) else ""

    referenced: dict[str, str] = {}
    submissions: list[Submission] = []

    if long_layout:
        q_i, a_i, t_i = positions["question_id"], positions["answer"], positions.get("time_spent")
        grouped: dict[tuple[str, str], Submission] = {}
        for line, cells in table.rows:
            roll, batch = cell(cells, roll_i), cell(cells, batch_i)
            qid = cell(cells, q_i)
            if not roll or not qid:
                report.error(line, roll, "A row needs both a roll number and a question id.")
                continue
            key = _qkey(qid)
            referenced.setdefault(key, qid)
            sub = grouped.setdefault((roll.lower(), batch.lower()), Submission(line, roll, batch))
            raw_time = cell(cells, t_i)
            if raw_time and not re.fullmatch(r"\d+(\.\d+)?", raw_time):
                report.error(line, roll, f"'{raw_time}' is not a time in seconds.")
                raw_time = ""
            sub.answers.append((line, key, cell(cells, a_i), raw_time))
        submissions = list(grouped.values())
    else:
        question_cols = [(i, name) for i, name in enumerate(header)
                         if name not in ("roll_no", "batch", "time_spent", "ignore")]
        if not question_cols:
            raise UnreadableFile("The file has a roll number but no question columns.")
        for i, name in question_cols:
            referenced.setdefault(_qkey(name), name)
        for line, cells in table.rows:
            roll = cell(cells, roll_i)
            if not roll:
                report.error(line, "", "This row has no roll number.")
                continue
            sub = Submission(line, roll, cell(cells, batch_i))
            sub.answers = [(line, _qkey(name), cell(cells, i), "") for i, name in question_cols]
            submissions.append(sub)
    return submissions, referenced


def _refresh_derived(institute_id: int, student_ids: list[int], report: ResultsReport) -> None:
    """Counts, then flags, for exactly the students this file touched.

    The write is the truth and has already committed; this is the "update
    counts / reason / surface" tail of the pipeline (§8.2 steps 7–9), and it is
    best effort for the same reason `refresh_derived_state` is: derived state
    is disposable and the nightly rebuild heals it. A detector failure must not
    turn a successful import into an error the institute retries — and a
    retry would be refused as a duplicate anyway.
    """
    from apps.derived.services import detectors, features

    try:
        features.recompute(institute_id, student_ids)
        report.derived_refreshed = True
        report.flags_raised = detectors.run_detectors(institute_id, student_ids).raised
    except Exception:                                       # pragma: no cover
        logger.exception("could not refresh derived state after ingest (institute %s)", institute_id)
