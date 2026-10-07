"""The question factory's model-facing steps and its loader — with a fake Gemini.

WHY THIS FILE EXISTS

    Four promises hold the factory together, and each one fails silently:

      1. The solver never sees the official answer. If it did, "the model
         agreed with NTA" would be worth nothing and nobody would notice.
      2. A model is only ever sent question pages. The NEET mirror carries
         the publisher's answer key from page 26 on.
      3. Running out of quota stops a step cleanly with its work saved —
         it never invents the rest, and never crashes the run.
      4. Loading adds an official paper and touches nothing else: demo
         papers keep their meaning (`source=demo`), drafts never reach the
         misconception FK that diagnosis reads, and a paper with attempts
         is never rebuilt.

    No test here reaches Google: `conftest.no_gemini_network` closes the
    door and each test opens it onto a `FakeGemini`.
"""

from __future__ import annotations

import dataclasses
import io
import json
import types
from datetime import date

import pytest
from pypdf import PdfReader, PdfWriter

from apps.events.models import Attempt
from apps.ingestion.factory import check, load, read, solve, store
from apps.ingestion.factory import manifest as mf
from apps.ingestion.factory.papers import PaperSpec, SourceFile
from apps.ingestion.factory.runner import Budget
from apps.ingestion import models as ingestion
from apps.ingestion.models import QuestionOption, QuestionTopicMap, Source
from apps.reasoning.models import ReasoningTrace
from apps.reasoning.services import documents, gemini
from tests import factories as f

pytestmark = pytest.mark.django_db


# ------------------------------------------------------------------ doubles


class ApiError(Exception):
    def __init__(self, code: int, message: str = "the server said no"):
        super().__init__(message)
        self.code = code


class FakeGemini:
    """Answers a script; records the models tried and what each call was sent."""

    def __init__(self, *script):
        self._script = list(script)
        self.calls: list[str] = []
        self.sent: list[list] = []
        self.models = self

    def generate_content(self, *, model, contents, config):
        self.calls.append(model)
        self.sent.append(contents)
        step = self._script[min(len(self.calls) - 1, len(self._script) - 1)]
        if isinstance(step, BaseException):
            raise step
        if callable(step):
            step = step(contents)
        return types.SimpleNamespace(
            text=step,
            usage_metadata=types.SimpleNamespace(prompt_token_count=10,
                                                 candidates_token_count=5),
        )


def pdf_bytes(pages: int) -> bytes:
    w = PdfWriter()
    for _ in range(pages):
        w.add_blank_page(width=200, height=200)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def pages_in(part) -> int:
    return len(PdfReader(io.BytesIO(part.inline_data.data)).pages)


# ------------------------------------------------------------------ fixtures


@pytest.fixture
def shelves(tmp_path, settings):
    """A private data/ directory, so no test writes to the real shelves."""
    settings.FACTORY_DATA_DIR = str(tmp_path / "data")
    (tmp_path / "data" / "raw" / "papers").mkdir(parents=True)
    return tmp_path / "data"


@pytest.fixture
def spec(cohort):
    """A four-page paper: page 1 instructions, 2-3 questions, 4 the publisher's key."""
    src = SourceFile(file="paper.pdf", url="https://example.invalid/paper.pdf",
                     listed_at="test", official=False, publisher="mirror",
                     kind="question_paper")
    key = dataclasses.replace(src, file="key.pdf", official=True, kind="answer_key")
    return PaperSpec(
        slug="test_paper", exam_code=cohort.exam.code, exam_label="JEE Main", year=2025,
        held_on=date(2025, 1, 22), shift_or_booklet="Test Shift",
        display_name="Test Exam 2025 · Official", paper=src, key=key,
        layout="neet_booklet", question_pages=(2, 3), total_questions=3,
        subjects=((1, 3, "Physics"),), read_batch=10, solve_batch=10, tag_batch=10,
    )


@pytest.fixture
def doc(shelves, spec):
    path = shelves / "raw" / "papers" / "paper.pdf"
    path.write_bytes(pdf_bytes(4))
    mf.record({"file": "papers/paper.pdf", "sha256": mf.sha256_file(path)})
    official = [("2",), ("1", "3"), ("4",)]
    d = {
        "paper": {"slug": spec.slug, "display_name": spec.display_name,
                  "question_paper": mf.lookup("papers/paper.pdf"),
                  "answer_key": {"file": "papers/key.pdf"},
                  "answer_rule": "official key"},
        "questions": [
            {"number": n, "subject": "Physics", "section": "Physics",
             "pages": [2] if n < 3 else [3, 4],   # Q3 'ends' on the key page
             "question_id": "", "option_ids": [], "answer_type": "mcq",
             "official": {"answer_type": "mcq", "labels": list(official[n - 1]),
                          "numeric": "", "dropped": False,
                          "raw": ",".join(official[n - 1]),
                          "display": ",".join(official[n - 1])},
             "read": None, "solve": None, "check": None, "tags": None}
            for n in (1, 2, 3)
        ],
    }
    store.save(spec.slug, d)
    return d


def transcription(numbers, diagram=()):
    return json.dumps({"questions": [
        {"number": n, "text": f"Question {n} text", "has_diagram": n in diagram,
         "legibility": "clear",
         "options": [{"label": str(i), "text": f"opt {i}", "is_figure": False}
                     for i in range(1, 5)]}
        for n in numbers]})


def use(monkeypatch, client):
    monkeypatch.setattr(gemini, "_client", lambda: client)
    return client


# ================================================================ documents.ask


def test_document_traces_name_the_file_and_pages_not_the_bytes(monkeypatch, cohort):
    client = use(monkeypatch, FakeGemini('{"ok": true}'))
    d = documents.Document(file="p.pdf", sha256="abc", pages=(2, 3), data=pdf_bytes(2))
    out, trace = documents.ask(task=ReasoningTrace.READ_PAPER, context={"q": [1]},
                               system_prompt="s", response_schema={"type": "object"},
                               institute_id=cohort.institute.id, documents=[d])
    assert out == {"ok": True}
    assert trace.context["documents"] == [{"file": "p.pdf", "sha256": "abc", "pages": [2, 3]}]
    assert pages_in(client.sent[0][0]) == 2

    # Same file, same pages, same context: replayed from the trace, no call.
    _, again = documents.ask(task=ReasoningTrace.READ_PAPER, context={"q": [1]},
                             system_prompt="s", response_schema={"type": "object"},
                             institute_id=cohort.institute.id, documents=[d])
    assert again.id == trace.id and len(client.calls) == 1


def test_document_calls_fall_back_through_the_model_chain(monkeypatch, cohort):
    client = use(monkeypatch, FakeGemini(ApiError(503), '{"ok": true}'))
    _, trace = documents.ask(task=ReasoningTrace.SOLVE_BLIND, context={"x": 1},
                             system_prompt="s", response_schema={"type": "object"},
                             institute_id=cohort.institute.id)
    chain = gemini._model_chain(gemini.DEFAULT_MODEL)
    assert client.calls == chain[:2] and trace.model == chain[1]
    assert ReasoningTrace.objects.filter(task=ReasoningTrace.SOLVE_BLIND).count() == 2


# ================================================================ read


def test_only_question_pages_are_ever_sent(monkeypatch, cohort, spec, doc):
    """Q3 claims to run onto page 4, the publisher's key. The clip holds."""
    client = use(monkeypatch, FakeGemini(transcription([1, 2, 3])))
    read.run(spec, doc, institute_id=cohort.institute.id, budget=Budget(), log=lambda *_: None)
    assert pages_in(client.sent[0][0]) == 2                 # pages 2-3, not 4
    trace = ReasoningTrace.objects.get(task=ReasoningTrace.READ_PAPER)
    assert trace.context["documents"][0]["pages"] == [2, 3]
    assert all(q["read"]["text"] for q in doc["questions"])
    with pytest.raises(AssertionError):
        read.document_for(spec, doc, [3, 4])


def test_a_question_the_model_skipped_is_asked_for_again(monkeypatch, cohort, spec, doc):
    client = use(monkeypatch, FakeGemini(transcription([1, 3]), transcription([2])))
    read.run(spec, doc, institute_id=cohort.institute.id, budget=Budget(), log=lambda *_: None)
    assert len(client.calls) == 2
    assert all(q["read"] for q in doc["questions"])


def test_running_out_of_quota_stops_cleanly_and_keeps_what_was_done(
        monkeypatch, cohort, spec, doc):
    exhausted = ApiError(429, "RESOURCE_EXHAUSTED: quota")
    use(monkeypatch, FakeGemini(exhausted))
    budget = Budget()
    read.run(spec, doc, institute_id=cohort.institute.id, budget=budget, log=lambda *_: None)
    assert "quota" in budget.notes[0]
    assert not any(q["read"] for q in doc["questions"])      # nothing invented
    assert store.load(spec.slug)["runs"][-1]["step"] == "read"


# ================================================================ solve


def test_the_solver_never_sees_the_official_answer(monkeypatch, cohort, spec, doc):
    use(monkeypatch, FakeGemini(transcription([1, 2, 3], diagram=(3,))))
    read.run(spec, doc, institute_id=cohort.institute.id, budget=Budget(), log=lambda *_: None)

    for q in doc["questions"]:
        payload = solve.solver_payload(q)
        assert set(payload) <= {"number", "subject", "answer_type", "text", "options",
                                "has_diagram", "figure_on_pages"}
        assert all(set(o) == {"label", "text"} for o in payload["options"])

    answers = json.dumps({"answers": [
        {"number": 1, "status": "solved", "answer": "2", "confidence": "high", "working": "w"},
        {"number": 2, "status": "solved", "answer": "4", "confidence": "low", "working": "w"},
        {"number": 3, "status": "cannot_solve", "answer": "", "confidence": "low",
         "reason": "figure", "working": ""},
    ]})
    client = use(monkeypatch, FakeGemini(answers))
    solve.run(spec, doc, institute_id=cohort.institute.id, budget=Budget(), log=lambda *_: None)
    sent = client.sent[0]
    body = sent[-1]
    assert "official" not in body and '"labels"' not in body
    assert pages_in(sent[0]) == 1          # Q3's figure: page 3 only, never page 4
    trace = ReasoningTrace.objects.get(task=ReasoningTrace.SOLVE_BLIND)
    assert "official" not in json.dumps(trace.context)


def test_questions_the_solver_left_out_are_asked_for_again(monkeypatch, cohort, spec, doc):
    """Seen live: with one figure page attached, the model answered only the
    questions printed on that page and silently skipped the rest."""
    use(monkeypatch, FakeGemini(transcription([1, 2, 3], diagram=(3,))))
    read.run(spec, doc, institute_id=cohort.institute.id, budget=Budget(), log=lambda *_: None)

    def answers(*numbers):
        return json.dumps({"answers": [
            {"number": n, "working": "w", "status": "solved", "answer": "1",
             "confidence": "high"} for n in numbers]})

    client = use(monkeypatch, FakeGemini(answers(3), answers(1, 2)))
    solve.run(spec, doc, institute_id=cohort.institute.id, budget=Budget(), log=lambda *_: None)
    assert len(client.calls) == 2
    assert all(q["solve"] for q in doc["questions"])
    first = json.loads(client.sent[0][-1])
    assert "Answer every one of these 3 questions" in first["instruction"]
    assert len(client.sent[1]) == 1         # the re-ask had no figure, so no pages


# ================================================================ tag


def test_tagging_never_labels_a_correct_option_and_cannot_invent_existing_codes(
        monkeypatch, cohort, spec, doc):
    use(monkeypatch, FakeGemini(transcription([1, 2, 3])))
    read.run(spec, doc, institute_id=cohort.institute.id, budget=Budget(), log=lambda *_: None)
    from apps.ingestion.factory import tag

    tags = json.dumps({"questions": [
        {"number": 1, "chapter": "Rotational Motion", "difficulty": "hard", "distractors": [
            {"label": "2", "kind": "new", "code": "MIS-X", "name": "x", "belief": "b"},   # correct
            {"label": "1", "kind": "existing", "code": "MIS-NOT-REAL", "name": "n",
             "belief": "I think"},
            {"label": "3", "kind": "none"},
        ]},
    ]})
    client = use(monkeypatch, FakeGemini(tags))
    tag.run(spec, doc, institute_id=cohort.institute.id, budget=Budget(), log=lambda *_: None)
    t = doc["questions"][0]["tags"]
    assert {d["label"] for d in t["distractors"]} == {"1", "3"}
    claimed = next(d for d in t["distractors"] if d["label"] == "1")
    assert claimed["kind"] == "new"            # not in the taxonomy, so it is a proposal
    assert '"official_answer": "2"' in client.sent[0][-1]   # tagging is told the key


# ================================================================ check


def q(answer_type="mcq", labels=("2",), numeric="", status="solved", answer="2",
      dropped=False, diagram=False):
    return {
        "answer_type": answer_type,
        "official": {"labels": list(labels), "numeric": numeric, "dropped": dropped,
                     "display": numeric or ",".join(labels)},
        "read": {"has_diagram": diagram, "issues": []},
        "solve": {"status": status, "answer": answer, "confidence": "high",
                  "reason": "figure" if status == "cannot_solve" else ""},
    }


@pytest.mark.parametrize("question, verdict", [
    (q(answer="2"), "agreed"),
    (q(answer="(2)"), "agreed"),
    (q(answer="3"), "disagreed"),
    (q(labels=("1", "2"), answer="1"), "agreed"),            # NTA accepted two options
    (q(status="cannot_solve", answer="", diagram=True), "unverifiable"),
    (q(answer_type="numerical", labels=(), numeric="4", answer="4.0"), "agreed"),
    (q(answer_type="numerical", labels=(), numeric="225", answer="224"), "disagreed"),
    (q(dropped=True, answer="1"), "unverifiable"),
])
def test_cross_check_verdicts(question, verdict):
    assert check.check_question(question)["status"] == verdict


def test_nothing_is_judged_before_it_is_read_and_solved():
    assert check.check_question({**q(), "read": None}) is None
    assert check.check_question({**q(), "solve": None}) is None


# ================================================================ load


def ready_doc(doc):
    texts = {1: "Q1", 2: "Q2", 3: "Q3 [Figure]"}
    for item in doc["questions"]:
        n = item["number"]
        item["read"] = {"text": texts[n], "has_diagram": n == 3, "issues": [],
                        "legibility": "clear", "trace_id": 1,
                        "options": [{"label": str(i), "text": f"o{i}", "is_figure": False}
                                    for i in range(1, 5)]}
        item["solve"] = {"status": "solved", "answer": "2" if n == 1 else "4",
                         "confidence": "high", "working": "", "trace_id": 2}
        item["tags"] = {"chapter": "Rotational Motion", "difficulty": "medium",
                        "trace_id": 3,
                        "distractors": [{"label": "1", "kind": "existing",
                                         "code": "MIS-ROT-AXIS", "name": "axis",
                                         "belief": "I think..."}]}
        item["check"] = check.check_question(item)
    return doc


def test_loading_adds_an_official_paper_and_leaves_demo_rows_alone(cohort, spec, doc):
    demo = ingestion.TestPaper.objects.create(institute=cohort.institute, exam=cohort.exam,
                                              name="Mock 1", held_on=date(2026, 9, 1))
    demo_q = QuestionTopicMap.objects.create(institute=cohort.institute, test_paper=demo,
                                             question_id="D1", question_text="demo")
    assert demo.source == Source.DEMO and demo_q.source == Source.DEMO

    result = load.load(spec, ready_doc(doc), cohort.institute)
    paper = result["paper"]
    assert paper.source == Source.OFFICIAL_PYQ and paper.exam_year == 2025
    assert paper.provenance["questions_loaded"] == 3
    rows = {r.question_id: r for r in paper.question_map.all()}
    assert rows["Q1"].verification == "agreed"
    assert rows["Q2"].verification == "disagreed"            # model 4, official 1,3
    assert rows["Q3"].verification == "agreed" and rows["Q3"].has_diagram
    assert rows["Q2"].official_answer == "1,3"
    assert all(r.confirmed_at is None for r in rows.values())  # no human confirmed anything
    assert rows["Q1"].source_ref == "JEE Main 2025 · Test Shift · Q1"

    options = QuestionOption.objects.filter(question__test_paper=paper)
    assert not options.filter(misconception__isnull=False).exists()   # drafts stay drafts
    assert options.get(question=rows["Q1"], label="1").draft_misconception_code == "MIS-ROT-AXIS"
    assert set(options.filter(question=rows["Q2"], is_correct=True)
               .values_list("label", flat=True)) == {"1", "3"}

    demo.refresh_from_db()
    assert demo.question_map.count() == 1 and demo.source == Source.DEMO


def test_reloading_needs_replace_and_never_rebuilds_a_paper_with_attempts(cohort, spec, doc):
    ready = ready_doc(doc)
    paper = load.load(spec, ready, cohort.institute)["paper"]
    with pytest.raises(load.LoadRefused, match="--replace"):
        load.load(spec, ready, cohort.institute)
    assert load.load(spec, ready, cohort.institute, replace=True)["loaded"] == 3

    student = f.make_student(cohort)
    topic = next(iter(cohort.chapters.values()))
    Attempt.objects.create(institute=cohort.institute, student=student, topic=topic,
                           test_paper=paper, question_id="Q1", status=Attempt.CORRECT,
                           chosen_option="2", marks=4, source=Attempt.MOCK,
                           ts="2026-01-01T10:00:00Z")
    with pytest.raises(load.LoadRefused, match="attempts"):
        load.load(spec, ready, cohort.institute, replace=True)


def test_loading_refuses_to_overwrite_a_demo_paper_of_the_same_name(cohort, spec, doc):
    ingestion.TestPaper.objects.create(institute=cohort.institute, exam=cohort.exam,
                             name=spec.display_name, held_on=date(2026, 1, 1))
    with pytest.raises(load.LoadRefused, match="non-official"):
        load.load(spec, ready_doc(doc), cohort.institute, replace=True)
