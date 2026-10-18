"""Reading an institute's export, as CSV, without trusting it.

An institute's results file is whatever their OMR vendor or Excel produced
that morning. It arrives with a byte-order mark or without, in UTF-8 or in
Windows-1252, comma- or semicolon-separated (Excel in an Indian locale writes
semicolons less often than a European one, but it happens), with a header row
whose wording nobody agreed with us. And it comes from the internet. So this
module does two jobs and keeps them apart: be forgiving about *format*, and be
strict about *size*.

CSV ONLY, FOR NOW
    `.xlsx` is what many institutes will actually have, but reading it means a
    new dependency (`openpyxl`) parsing zip archives from strangers — an
    attack surface worth adding on purpose, not as a side effect. Until then:
    "Save As → CSV" is one menu item, and the API says so when it is handed a
    workbook rather than failing with an encoding error.

NOTHING HERE KNOWS WHAT A PAPER IS
    It returns rows of strings, keyed by header. What the strings mean is
    `results.py`'s and `blueprint.py`'s business.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass

#: 2 MB holds a few hundred students × a few hundred questions with room to
#: spare; a real export is tens of kilobytes. The ceiling is about what a
#: person could plausibly have typed or exported, not about our hardware.
MAX_BYTES = 2_000_000

#: Data rows, not counting the header. Long layout is one row per answer, so
#: 300 students × 90 questions is 27,000 — the cap is generous for wide files
#: and a deliberate limit for long ones.
MAX_ROWS = 40_000

#: A file starting with these is a spreadsheet (zip) or a legacy Excel
#: workbook, not text. Named so the error can say what to do.
_ZIP_MAGIC = b"PK\x03\x04"
_OLE_MAGIC = b"\xd0\xcf\x11\xe0"


class UnreadableFile(ValueError):
    """The upload cannot be understood. The message is for the person who sent it."""


@dataclass
class Table:
    header: list[str]
    #: (line number in the file, cells). Line numbers are 1-based and count the
    #: header, so they match what the person sees when they open the file.
    rows: list[tuple[int, list[str]]]


def _norm(text: str) -> str:
    """Lowercase, with underscores, dots and `#` read as spaces, then collapsed.

    So `Roll No.`, `roll_no`, `ROLL  NO` and `Roll #` are one name.
    """
    for noise in "_.#":
        text = text.replace(noise, " ")
    return " ".join(text.split()).lower()


def read_table(raw: bytes) -> Table:
    if len(raw) > MAX_BYTES:
        raise UnreadableFile(
            f"That file is {len(raw) / 1_000_000:.1f} MB; the limit is {MAX_BYTES / 1_000_000:.0f} MB."
        )
    if raw.startswith(_ZIP_MAGIC) or raw.startswith(_OLE_MAGIC):
        raise UnreadableFile(
            "That looks like an Excel workbook. Open it and use File → Save As → "
            "CSV (Comma delimited), then upload the .csv."
        )
    if not raw.strip():
        raise UnreadableFile("The file is empty.")

    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        # Excel on Windows writes "CSV" in the legacy code page, not UTF-8.
        text = raw.decode("cp1252", errors="replace")
    if "\x00" in text:
        raise UnreadableFile("That file is not plain text (it contains binary data).")

    # The delimiter is whichever candidate appears most in the header line,
    # comma winning ties. Not `csv.Sniffer`: on an answer sheet — columns of
    # single letters — its statistics are a coin toss.
    first_line = next((line for line in text.splitlines() if line.strip()), "")
    delimiter = max(",;\t|", key=lambda d: (first_line.count(d), d == ","))

    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    header: list[str] | None = None
    rows: list[tuple[int, list[str]]] = []
    try:
        for cells in reader:
            cells = [c.strip() for c in cells]
            if not any(cells):
                continue                                   # blank line
            if header is None:
                header = cells
                continue
            if len(rows) >= MAX_ROWS:
                raise UnreadableFile(f"That file has more than {MAX_ROWS:,} rows.")
            rows.append((reader.line_num, cells))
    except csv.Error as exc:
        raise UnreadableFile(f"That file could not be read as CSV ({exc}).") from exc

    if header is None:
        raise UnreadableFile("The file has no header row.")
    if not rows:
        raise UnreadableFile("The file has a header but no data rows.")
    if any(not h for h in header):
        raise UnreadableFile("The header row has an empty column name.")
    names = [_norm(h) for h in header]
    if len(set(names)) != len(names):
        dupes = sorted({h for h, n in zip(header, names) if names.count(n) > 1})
        raise UnreadableFile(f"Column names must be unique; repeated: {', '.join(dupes)}.")
    return Table(header=header, rows=rows)


#: How a field is named to the person who sent the file, where the field's
#: own name would read as a variable.
_FIELD_NOUNS = {
    "roll_no": "roll number",
    "question_id": "question id",
    "time_spent": "time",
    "correct_option": "correct option",
}


def canonical_header(
    header: list[str], aliases: dict[str, list[str]], column_map: dict[str, str] | None = None,
    *, repeatable: frozenset[str] = frozenset(),
) -> list[str]:
    """Rename recognised columns to their canonical field; leave the rest as written.

    `column_map` is the institute's own mapping (`{"Roll No.": "roll_no"}`),
    and wins over the built-in aliases. Anything neither recognises keeps its
    original text, because in the wide layout those columns *are* the data —
    one per question.

    Two columns resolving to the same field is an error, not a tie to break:
    guessing which "roll number" column was meant is how a file gets imported
    against the wrong students. Fields named in `repeatable` (the "ignore"
    pile: Total, Rank, Percentile…) may legitimately appear many times.
    """
    explicit = {_norm(k): v for k, v in (column_map or {}).items()}
    by_alias = {_norm(a): field for field, names in aliases.items() for a in (field, *names)}

    out: list[str] = []
    claimed: dict[str, str] = {}
    for original in header:
        key = _norm(original)
        field = explicit.get(key) or by_alias.get(key)
        if field is None:
            out.append(original)
            continue
        if field in repeatable:
            out.append(field)
            continue
        if field in claimed:
            noun = _FIELD_NOUNS.get(field, field.replace("_", " "))
            raise UnreadableFile(
                f"Both '{claimed[field]}' and '{original}' look like the {noun} "
                "column. Say which one with a column mapping."
            )
        claimed[field] = original
        out.append(field)
    return out
