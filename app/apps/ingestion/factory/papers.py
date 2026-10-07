"""The papers the factory knows how to build — one spec per (exam, year, booklet or shift).

A spec is the part of the job that is *not* read by a model: where the
files came from, which pages hold questions, which booklet code or shift
the official key must be read for, and how the paper is marked. Every
value here was taken from the documents themselves and is re-checked by
`factory prepare` against the PDFs before a model sees anything.

Two traps live in this file, and the specs exist mainly to defuse them:

* **NEET booklet codes.** NEET 2025 was printed in four test-booklet codes
  (45/46/47/48) with the same questions in different orders, and the final
  key is per code. Read code 45's paper against code 46's key and almost
  every answer is wrong while nothing looks broken. `booklet_code` pins it,
  and `prepare` proves it (see `structure.verify_booklet`).
* **JEE Main ids.** NTA's key maps a *question id* to a *correct option id*.
  Question and option order are both shuffled per candidate, so a position
  ("option 2") means nothing; only the ids do. And the ids are not unique
  across shifts — shift 2's question ids reuse shift 1's option-id range —
  so the key must be read on the one page for this date and shift only.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date


@dataclass(frozen=True)
class SourceFile:
    file: str                 # name under data/raw/papers/
    url: str                  # exactly what was downloaded
    listed_at: str            # the page that links to it
    official: bool            # NTA's own host, or a mirror
    publisher: str
    kind: str                 # "question_paper" | "answer_key"
    note: str = ""


@dataclass(frozen=True)
class PaperSpec:
    slug: str
    exam_code: str                       # Exam.code — candidates tried in order
    exam_label: str                      # "NEET (UG)"
    year: int
    held_on: date
    shift_or_booklet: str
    display_name: str                    # the TestPaper name a director sees
    paper: SourceFile
    key: SourceFile
    layout: str                          # "neet_booklet" | "jee_cbt"
    question_pages: tuple[int, int]      # inclusive, 1-based — the ONLY pages a model is sent
    total_questions: int
    marks_correct: int = 4
    marks_wrong: int = -1
    duration_min: int = 180
    booklet_code: str = ""               # NEET only
    key_exam_date: str = ""              # JEE only, as printed on the key: "02.04.2026"
    key_shift: str = ""                  # JEE only, as printed on the key: "First"
    key_centre: str = "For Centers in India"   # JEE only — outside-India centres sat other ids
    mirror_key_page: int | None = None   # a mirror's own key page — booklet check only, never sent
    subjects: tuple[tuple[int, int, str], ...] = ()   # (first, last, name); JEE reads them from the paper
    exam_code_aliases: tuple[str, ...] = field(default=())
    read_batch: int = 28                 # questions per reading call
    solve_batch: int = 10                # questions per solving call
    tag_batch: int = 10

    @property
    def max_marks(self) -> int:
        return self.total_questions * self.marks_correct

    def subject_of(self, number: int) -> str:
        for first, last, name in self.subjects:
            if first <= number <= last:
                return name
        return ""

    def source_ref(self, number: int) -> str:
        return f"{self.exam_label} {self.year} · {self.shift_or_booklet} · Q{number}"


NEET_UG_2025_CODE45 = PaperSpec(
    slug="neet_ug_2025_code45",
    exam_code="NEET_UG",
    exam_code_aliases=("NEET",),
    exam_label="NEET (UG)",
    year=2025,
    held_on=date(2025, 5, 4),
    shift_or_booklet="Test Booklet Code 45",
    display_name="NEET UG 2025 · Code 45 · Official",
    paper=SourceFile(
        file="neet_ug_2025_code45_english_pw_mirror.pdf",
        url="https://d2bps9p1kiy4ka.cloudfront.net/5b09189f7285894d9130ccd0/"
            "c9b2c6eb-e587-43e6-a0d7-b6a2ff93f247.pdf",
        listed_at="https://www.pw.live/neet/exams/neet-2025-question-paper",
        official=False,
        publisher="Physics Wallah (mirror)",
        kind="question_paper",
        note=(
            "NTA does not publish NEET question papers openly; this is PW's "
            "typeset of Test Booklet Code 45 (English), released on exam day. "
            "Pages 2-25 are the 180 questions. Pages 26-48 are PW's own answer "
            "key and solutions: never sent to a model, used only to prove the "
            "booklet code against NTA's official key."
        ),
    ),
    key=SourceFile(
        file="neet_ug_2025_final_answer_key.pdf",
        url="https://cdnbbsr.s3waas.gov.in/s37bc1ec1d9c3426357e69acd5bf320061/"
            "uploads/2025/06/2025061450.pdf",
        listed_at="https://neet.nta.nic.in/document-category/neetug-2025-public-notices/",
        official=True,
        publisher="National Testing Agency",
        kind="answer_key",
        note="FINAL ANSWER KEY FOR NEET (UG) - 2025 EXAM HELD ON 04.05.2025, "
             "one page per test booklet code (45, 46, 47, 48).",
    ),
    layout="neet_booklet",
    question_pages=(2, 25),
    mirror_key_page=26,
    total_questions=180,
    booklet_code="45",
    # NTA's bulletin gives Physics 45, Chemistry 45 and "Biology (Botany &
    # Zoology) 90" — it does not number a Botany block and a Zoology block,
    # and this paper mixes them (a nephron question sits at Q125). So the
    # paper is labelled Biology; Botany vs Zoology is a property of the
    # chapter, which the official syllabus tree already records.
    subjects=((1, 45, "Physics"), (46, 90, "Chemistry"), (91, 180, "Biology")),
    read_batch=30,
    solve_batch=15,
    tag_batch=15,
)


JEE_MAIN_2026_0402_S1 = PaperSpec(
    slug="jee_main_2026_0402_s1",
    exam_code="JEE_MAIN",
    exam_label="JEE Main",
    year=2026,
    held_on=date(2026, 4, 2),
    shift_or_booklet="02 Apr 2026 · Shift 1",
    display_name="JEE Main 2026 · 02 Apr · Shift 1 · Official",
    paper=SourceFile(
        file="jee_main_2026_s2_02apr_shift1_paper.pdf",
        url="https://cdnbbsr.s3waas.gov.in/s3f8e59f4b2fe7c5705bf878bbd494ccdf/"
            "uploads/2026/04/202604092096865379.pdf",
        listed_at="https://jeemain.nta.nic.in/ (menu: Question Papers → "
                  "B Tech 2nd Apr 2026 Shift 1)",
        official=True,
        publisher="National Testing Agency",
        kind="question_paper",
        note="NTA's master question paper for the shift: question ids and "
             "option ids as text, question and option content as images.",
    ),
    key=SourceFile(
        file="jee_main_2026_s2_final_answer_key.pdf",
        url="https://cdnbbsr.s3waas.gov.in/s3f8e59f4b2fe7c5705bf878bbd494ccdf/"
            "uploads/2026/04/20260420409057044.pdf",
        listed_at="https://jeemain.nta.nic.in/ (Final Answer Keys for JEE(Main) – "
                  "2026 [Session-II] (B.E. / B. Tech))",
        official=True,
        publisher="National Testing Agency",
        kind="answer_key",
        note="JEE (Main) - 2026 : SESSION - 2 FINAL ANSWER KEY OF B.E. / B.Tech ON "
             "WHICH RESULT COMPILED (For Centers in India). One page per shift; "
             "question id → correct option id, or the value for numericals.",
    ),
    layout="jee_cbt",
    question_pages=(1, 30),
    total_questions=75,
    key_exam_date="02.04.2026",
    key_shift="First",
    read_batch=15,
    solve_batch=15,
    tag_batch=15,
)


PAPERS: dict[str, PaperSpec] = {
    p.slug: p for p in (NEET_UG_2025_CODE45, JEE_MAIN_2026_0402_S1)
}


def get(slug: str) -> PaperSpec:
    try:
        return PAPERS[slug]
    except KeyError:
        raise KeyError(f"Unknown paper '{slug}'. Known: {', '.join(PAPERS)}") from None
