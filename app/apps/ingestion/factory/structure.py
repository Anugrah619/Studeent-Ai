"""The paper's skeleton — question numbers, pages, ids — read from the text layer, not by a model.

The model is asked to transcribe questions; it is never trusted to decide
how many there are, which page each starts on, or (for JEE Main) which id
an option carries. Those come from here, and the model's transcription is
then checked against them.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .keys import parse_mirror_key


class StructureError(ValueError):
    """The paper's layout did not parse into the expected questions."""


@dataclass
class Slot:
    """One question as the paper lays it out, before anyone reads its content."""

    number: int
    start_page: int
    end_page: int = 0
    subject: str = ""
    section: str = ""
    question_id: str = ""                         # JEE only
    qtype: str = "MCQ"                            # "MCQ" | "SA" (JEE's numerical)
    option_ids: list[str] = field(default_factory=list)   # JEE only, printed order

    @property
    def pages(self) -> list[int]:
        return list(range(self.start_page, max(self.end_page, self.start_page) + 1))

    @property
    def answer_type(self) -> str:
        return "numerical" if self.qtype == "SA" else "mcq"


def _close_ranges(slots: list[Slot], last_page: int) -> None:
    """A question ends on the page where the next one starts (inclusive —
    the next header can sit below the end of this one's options)."""
    for this, nxt in zip(slots, slots[1:]):
        this.end_page = nxt.start_page
    if slots:
        slots[-1].end_page = last_page


_NEET_START = re.compile(r"(?m)^\s*(\d{1,3})\s*\.(?!\d)")


def neet_slots(texts, first_page: int, last_page: int, total: int,
               subjects=()) -> list[Slot]:
    """Questions 1..total, each at the page where "N." first appears in sequence.

    Sequential on purpose: a stray "12." inside a question (a list, a
    statement number) cannot be mistaken for question 12 unless it appears
    exactly when 12 is next expected *and* before the real one — which the
    count check below and the model's own numbering would both catch.
    """
    slots: list[Slot] = []
    expected = 1
    for page in range(first_page, last_page + 1):
        for m in _NEET_START.finditer(texts[page - 1]):
            if int(m.group(1)) == expected:
                slots.append(Slot(number=expected, start_page=page))
                expected += 1
    if len(slots) != total:
        raise StructureError(
            f"Found {len(slots)} question starts on pages {first_page}-{last_page}, "
            f"expected {total}."
        )
    _close_ranges(slots, last_page)
    for s in slots:
        for first, last, name in subjects:
            if first <= s.number <= last:
                s.subject = s.section = name
    return slots


_JEE_HEADER = re.compile(
    r"Question Number : (\d+) Question Id : (\d+) Question Type : (\w+)"
)
_JEE_OPTION = re.compile(r"(?m)^\s*(\d{6,})\.\s")
_JEE_SECTION = re.compile(r"(?m)^\s*((?:Mathematics|Physics|Chemistry)\s+Section\s+[AB])\s*$")


def jee_slots(texts, first_page: int, last_page: int, total: int) -> list[Slot]:
    """Questions with their NTA question id, type and option ids, in printed order."""
    # Walk page by page, in order of appearance, remembering the section.
    slots: list[Slot] = []
    section = ""
    for page in range(first_page, last_page + 1):
        text = texts[page - 1]
        events = [(m.start(), "section", m) for m in _JEE_SECTION.finditer(text)]
        events += [(m.start(), "q", m) for m in _JEE_HEADER.finditer(text)]
        events += [(m.start(), "opt", m) for m in _JEE_OPTION.finditer(text)]
        for _, kind, m in sorted(events, key=lambda e: e[0]):
            if kind == "section":
                section = m.group(1)
            elif kind == "q":
                slots.append(Slot(
                    number=int(m.group(1)), start_page=page, section=section,
                    subject=section.split()[0] if section else "",
                    question_id=m.group(2), qtype=m.group(3),
                ))
            elif kind == "opt" and slots:
                slots[-1].option_ids.append(m.group(1))
    numbers = [s.number for s in slots]
    if numbers != list(range(1, total + 1)):
        raise StructureError(f"JEE paper numbering is {numbers[:5]}…, expected 1..{total}.")
    for s in slots:
        if s.qtype == "MCQ" and len(s.option_ids) != 4:
            raise StructureError(f"Q{s.number} ({s.question_id}) has options {s.option_ids}.")
        if s.qtype != "MCQ" and s.option_ids:
            raise StructureError(f"Q{s.number} is {s.qtype} but lists options.")
    _close_ranges(slots, last_page)
    return slots


def verify_booklet(mirror_text: str, official: dict[str, dict[int, tuple[str, ...]]],
                   claimed: str) -> dict:
    """Prove a mirror's question order belongs to the booklet code it claims.

    The mirror's own key (printed in the same file) is compared with NTA's
    final key for every code. The claimed code must match on nearly every
    question and every other code must look like chance (~25%). This costs
    no model call and catches the single most damaging mistake available:
    the right paper read against the wrong code's key.
    """
    mirror = parse_mirror_key(mirror_text)
    total = max((len(k) for k in official.values()), default=0)
    scores = {}
    diffs = {}
    for code, key in official.items():
        same = 0
        for n, labels in key.items():
            got = mirror.get(n)
            if got and set(got) & set(labels):
                same += 1
        scores[code] = same
        diffs[code] = [
            {"q": n, "mirror": ",".join(mirror.get(n, ())), "official": ",".join(labels)}
            for n, labels in key.items() if not (set(mirror.get(n, ())) & set(labels))
        ]
    best = max(scores, key=scores.get) if scores else ""
    others = [v for c, v in scores.items() if c != claimed]
    ok = (
        best == claimed and len(mirror) == total
        and scores[claimed] >= 0.95 * total
        and all(v < 0.5 * total for v in others)
    )
    return {
        "claimed_code": claimed, "best_match": best, "ok": ok,
        "mirror_answers_found": len(mirror), "questions": total,
        "matches_by_code": scores,
        "claimed_code_differences": diffs.get(claimed, []),
        "method": "mirror's printed key vs NTA final key, every code",
    }
