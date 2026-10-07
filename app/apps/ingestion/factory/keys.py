"""Official answer keys, parsed from NTA's own PDFs — by rule, never by a model.

The whole cross-check rests on these being exactly right, so they are read
with plain regular expressions over the PDF text layer and then made to
prove their own completeness: every question number 1..N present exactly
once, every value well-formed. A key that parses to 179 answers is a
failure, not a warning — one missing line shifts nothing visibly and makes
one question silently unanswerable.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation


class KeyParseError(ValueError):
    """The key PDF did not parse into a complete, unambiguous key."""


class KeyMappingError(ValueError):
    """The key names an option id that is not one of the question's options."""


# ---------------------------------------------------------------- NEET

_NEET_LINE = re.compile(r"(?m)^\s*(\d{1,3})\s+([1-4](?:\s*,\s*[1-4])*)\s*$")


def parse_neet_key(texts: list[str] | tuple[str, ...], booklet_code: str,
                   total: int = 180) -> dict[int, tuple[str, ...]]:
    """{question number: accepted option labels} for one test-booklet code.

    NTA's final key prints one page per code. Two accepted options ("1,2")
    happen when NTA upheld a challenge; both are kept, and either is right.
    """
    header = re.compile(rf"Test Booklet Code\s*:\s*{re.escape(booklet_code)}\b")
    pages = [t for t in texts if header.search(t)]
    if len(pages) != 1:
        raise KeyParseError(
            f"Expected exactly one key page for booklet code {booklet_code}, "
            f"found {len(pages)}."
        )
    key: dict[int, tuple[str, ...]] = {}
    for num, ans in _NEET_LINE.findall(pages[0]):
        n = int(num)
        if n in key:
            raise KeyParseError(f"Code {booklet_code}: Q{n} appears twice in the key.")
        key[n] = tuple(a.strip() for a in ans.split(","))
    missing = [n for n in range(1, total + 1) if n not in key]
    if missing or len(key) != total:
        raise KeyParseError(
            f"Code {booklet_code}: key has {len(key)} answers; missing {missing[:10]}."
        )
    return key


def all_neet_codes(texts) -> list[str]:
    return re.findall(r"Test Booklet Code\s*:\s*(\d+)", "\n".join(texts))


_MIRROR_ANSWER = re.compile(r"(\d{1,3})\.\s*\(([1-4](?:\s*,\s*[1-4])*)\)")


def parse_mirror_key(text: str) -> dict[int, tuple[str, ...]]:
    """A mirror publisher's own key page, "1. (2) 2. (2) …".

    Used for one thing only: proving which booklet code the mirror's
    question order belongs to. It is never an answer source.
    """
    return {int(n): tuple(a.strip() for a in ans.split(","))
            for n, ans in _MIRROR_ANSWER.findall(text)}


# ---------------------------------------------------------------- JEE Main


@dataclass(frozen=True)
class JeeKeyRow:
    section: str          # "MATHEMATICS"
    question_id: str
    value: str            # an option id, a numeric value, or e.g. "Drop"


_JEE_ROW = re.compile(r"(?m)^\s*(\d{6,})\s+(\S+)\s*$")
_JEE_SECTION = re.compile(r"\(\s*([A-Z][A-Z ]+?)\s*\)")


def parse_jee_key(texts: list[str] | tuple[str, ...], exam_date: str,
                  shift: str, centre: str = "For Centers in India") -> list[JeeKeyRow]:
    """The rows for one date, shift and centre group, in printed order.

    Read from that one page only. Ids are not unique across shifts — on the
    Session 2 key, shift 2's question ids (691121151…) are the same strings
    as shift 1's option ids — so a parser over the whole file would happily
    match a question to another shift's answer. Centres outside India sat a
    different paper with different ids, printed on pages of their own.
    """
    date_re = re.compile(rf"Exam Date\s*:\s*{re.escape(exam_date)}")
    shift_re = re.compile(rf"Exam Shift\s*:\s*{re.escape(shift)}\b", re.I)
    centre_re = re.compile(re.escape(centre), re.I)
    pages = [t for t in texts
             if date_re.search(t) and shift_re.search(t) and centre_re.search(t)]
    if len(pages) != 1:
        raise KeyParseError(
            f"Expected one key page for {exam_date} shift {shift} ({centre}), "
            f"found {len(pages)}."
        )
    rows: list[JeeKeyRow] = []
    section = ""
    for line in pages[0].splitlines():
        sec = _JEE_SECTION.fullmatch(line.strip())
        if sec:
            section = sec.group(1).strip()
            continue
        m = _JEE_ROW.match(line)
        if m:
            rows.append(JeeKeyRow(section, m.group(1), m.group(2)))
    ids = [r.question_id for r in rows]
    if len(set(ids)) != len(ids):
        raise KeyParseError(f"{exam_date} {shift}: a question id appears twice.")
    return rows


@dataclass(frozen=True)
class OfficialAnswer:
    """The official answer, translated onto this paper's printed labels."""

    answer_type: str                  # "mcq" | "numerical"
    labels: tuple[str, ...] = ()      # accepted option labels, "1".."4"
    numeric: str = ""                 # the value exactly as printed
    dropped: bool = False
    raw: str = ""                     # the key cell, untouched

    @property
    def display(self) -> str:
        if self.dropped:
            return "dropped"
        return ",".join(self.labels) if self.answer_type == "mcq" else self.numeric

    def as_dict(self) -> dict:
        return {"answer_type": self.answer_type, "labels": list(self.labels),
                "numeric": self.numeric, "dropped": self.dropped, "raw": self.raw,
                "display": self.display}


def is_dropped(value: str) -> bool:
    return value.strip().lower().startswith("drop") or value.strip().lower() in {"bonus", "-"}


def jee_official_answer(value: str, qtype: str, option_ids: list[str]) -> OfficialAnswer:
    """Translate one key cell through the paper's option ids.

    MCQ: the cell is an option id (or several, comma-separated, if NTA
    accepted more than one). Its position in *this paper's printed order*
    becomes the label. An id that is not among the question's own options
    is a mapping failure and raises — guessing a position here is exactly
    the bug that makes every answer quietly wrong.
    """
    if is_dropped(value):
        return OfficialAnswer("mcq" if qtype == "MCQ" else "numerical",
                              dropped=True, raw=value)
    if qtype == "MCQ":
        labels = []
        for oid in value.split(","):
            oid = oid.strip()
            if oid not in option_ids:
                raise KeyMappingError(
                    f"Key gives option id {oid}, which is not one of this question's "
                    f"options {option_ids}."
                )
            labels.append(str(option_ids.index(oid) + 1))
        return OfficialAnswer("mcq", labels=tuple(labels), raw=value)
    try:
        Decimal(value)
    except InvalidOperation:
        raise KeyMappingError(f"Numerical key value {value!r} is not a number.") from None
    return OfficialAnswer("numerical", numeric=value, raw=value)


def neet_official_answer(labels: tuple[str, ...]) -> OfficialAnswer:
    return OfficialAnswer("mcq", labels=tuple(labels), raw=",".join(labels))
