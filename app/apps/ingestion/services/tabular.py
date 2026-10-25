"""Reading an institute's export — CSV or `.xlsx` — without trusting it.

An institute's results file is whatever their OMR vendor or Excel produced
that morning. It arrives with a byte-order mark or without, in UTF-8 or in
Windows-1252, comma- or semicolon-separated (Excel in an Indian locale writes
semicolons less often than a European one, but it happens), with a header row
whose wording nobody agreed with us. And it comes from the internet. So this
module does two jobs and keeps them apart: be forgiving about *format*, and be
strict about *size*.

CSV AND .XLSX, ONE TABLE
    Which one a file is follows from its first bytes, not from its name: a
    `.csv` that is really a workbook (it happens — "Save As" keeps the old
    name) is read as the workbook it is. Both come out as the same `Table` of
    strings, and a workbook's cells are written as the strings Excel's own
    "Save As → CSV" would have produced: `7` not `7.0`, `B` as `B`, an empty
    cell as `""`. So `results.py` and `blueprint.py` cannot tell, and every
    rule they apply to a CSV applies unchanged to a workbook.

    Legacy `.xls` (the OLE format) is still refused, with the menu item that
    fixes it. Reading it would mean a second parser for a binary format from
    1997, for files any Excel since 2007 can re-save in one click.

A WORKBOOK IS A ZIP FROM A STRANGER
    `openpyxl` parses zip archives of XML, which is a new attack surface and
    is treated as one. Before `openpyxl` sees a byte, `_check_workbook_zip`
    refuses: an archive with more than `MAX_XLSX_MEMBERS` members; one whose
    members *declare* more than `MAX_XLSX_UNCOMPRESSED` bytes in total (a zip
    bomb — `zipfile` will not inflate past a member's declared size, so the
    declaration is a real bound); and any XML member that opens with a DTD,
    which no Excel file has and which is how entity-expansion attacks start.
    Then the workbook is opened read-only and formula-free (`data_only`),
    only the first worksheet is read, its declared dimensions are ignored (a
    forged `<dimension ref="A1:XFD1048576">` would otherwise make openpyxl
    pad every row to sixteen thousand cells), a row wider than `MAX_COLUMNS`
    is refused, and reading stops at `MAX_ROWS`.

NOTHING HERE KNOWS WHAT A PAPER IS
    It returns rows of strings, keyed by header. What the strings mean is
    `results.py`'s and `blueprint.py`'s business.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import math
import zipfile
from dataclasses import dataclass

#: 2 MB holds a few hundred students × a few hundred questions with room to
#: spare; a real export is tens of kilobytes. The ceiling is about what a
#: person could plausibly have typed or exported, not about our hardware.
#: For a workbook it is the *compressed* size; see `MAX_XLSX_UNCOMPRESSED`.
MAX_BYTES = 2_000_000

#: Data rows, not counting the header. Long layout is one row per answer, so
#: 300 students × 90 questions is 27,000 — the cap is generous for wide files
#: and a deliberate limit for long ones.
MAX_ROWS = 40_000

#: Columns in any one row of a workbook. A wide results sheet is a roll
#: number, a few labels and one column per question — under 300 for any real
#: paper. The cap exists because openpyxl builds each row as a list as wide
#: as its right-most cell, so one cell parked in column XFD costs 16,384
#: slots, and forty thousand such rows would cost gigabytes.
MAX_COLUMNS = 1_000

#: The sum of every member's declared uncompressed size. A genuine export of
#: `MAX_ROWS` rows is a few megabytes of XML; 25 MB is room for formatting
#: and styles, and nowhere near what a 2 MB zip can declare if it is a bomb.
MAX_XLSX_UNCOMPRESSED = 25_000_000

#: Members in the archive. Excel writes about a dozen for a one-sheet book;
#: a workbook with many sheets, images or charts might reach a hundred.
MAX_XLSX_MEMBERS = 200

#: How far into each XML member to look for a DTD. A DOCTYPE must precede the
#: root element, so it is always within the first few hundred bytes.
_DTD_PROBE_BYTES = 4096

#: Row numbers a worksheet may claim. Excel's own limit; a forged row number
#: beyond it is refused rather than iterated up to.
_EXCEL_MAX_ROWS = 1_048_576

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
    """A CSV or `.xlsx` file as a header and rows of strings. Raises `UnreadableFile`.

    The format is decided by the content, not the filename. Every refusal is
    a sentence for the person who sent the file.
    """
    if len(raw) > MAX_BYTES:
        raise UnreadableFile(
            f"That file is {len(raw) / 1_000_000:.1f} MB; the limit is {MAX_BYTES / 1_000_000:.0f} MB."
        )
    if raw.startswith(_OLE_MAGIC):
        raise UnreadableFile(
            "That looks like an older Excel workbook (.xls), or a password-protected "
            "one. Open it and use File → Save As → Excel Workbook (.xlsx) or CSV "
            "(Comma delimited), then upload that."
        )
    if raw.startswith(_ZIP_MAGIC):
        header, rows = _read_xlsx(raw)
    else:
        header, rows = _read_csv(raw)
    return _finish(header, rows)


def _read_csv(raw: bytes) -> tuple[list[str] | None, list[tuple[int, list[str]]]]:
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
    return header, rows


# ------------------------------------------------------------------- .xlsx

_NOT_A_WORKBOOK = (
    "That file is a zip archive but not an Excel workbook that can be read. If it "
    "is a spreadsheet, open it and use File → Save As → Excel Workbook (.xlsx) or "
    "CSV (Comma delimited), then upload that."
)


def _check_workbook_zip(raw: bytes) -> None:
    """Refuse a workbook before openpyxl opens it. See the module docstring.

    Only the central directory and the first few kilobytes of each XML member
    are read here, so this costs almost nothing on a genuine file and cannot
    be made to cost much on a hostile one.
    """
    try:
        archive = zipfile.ZipFile(io.BytesIO(raw))
    except (zipfile.BadZipFile, ValueError, OSError):
        raise UnreadableFile(_NOT_A_WORKBOOK) from None
    with archive:
        members = archive.infolist()
        if len(members) > MAX_XLSX_MEMBERS:
            raise UnreadableFile(
                f"That workbook has {len(members):,} parts inside it; a results sheet "
                f"has a few dozen at most (the limit is {MAX_XLSX_MEMBERS}). Copy the "
                "results into a new workbook, or save it as CSV, and upload that."
            )
        declared = sum(m.file_size for m in members)
        if declared > MAX_XLSX_UNCOMPRESSED:
            raise UnreadableFile(
                f"That workbook unpacks to {declared / 1_000_000:,.0f} MB; the limit is "
                f"{MAX_XLSX_UNCOMPRESSED / 1_000_000:.0f} MB. Save it as CSV and upload that."
            )
        names = {m.filename for m in members}
        if "[Content_Types].xml" not in names or "xl/workbook.xml" not in names:
            raise UnreadableFile(_NOT_A_WORKBOOK)
        for member in members:
            if not member.filename.lower().endswith((".xml", ".rels")):
                continue
            try:
                with archive.open(member) as fh:
                    head = fh.read(_DTD_PROBE_BYTES)
            except (zipfile.BadZipFile, NotImplementedError, OSError, RuntimeError):
                # Damaged, encrypted, or a compression method zipfile lacks.
                raise UnreadableFile(_NOT_A_WORKBOOK) from None
            if b"<!DOCTYPE" in head.upper() or b"<!ENTITY" in head.upper():
                raise UnreadableFile(
                    "That workbook contains markup Excel never writes, so it was not "
                    "opened. Save it as CSV and upload that."
                )


def _cell_text(value) -> str:
    """One workbook cell as the string Excel's own CSV export would write.

    The point is that a workbook and its CSV twin import identically. Whole
    numbers lose the `.0` openpyxl gives them (`7.0` → `7`), so a numeric key
    of 7 and a roll number typed as 1041 read the same as in a CSV; other
    numbers keep Excel's 15 significant digits rather than float noise.
    Option letters pass through untouched, and an empty cell is `""` — which
    `results.py` reads as a blank, exactly as an empty CSV field.
    """
    if value is None:
        return ""
    if isinstance(value, bool):                 # before int: bool is an int
        return "TRUE" if value else "FALSE"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            return str(value)
        if value.is_integer():
            return str(int(value))
        return format(value, ".15g")
    if isinstance(value, dt.datetime):
        if value.time() == dt.time(0, 0):
            return value.date().isoformat()
        return value.isoformat(sep=" ")
    if isinstance(value, (dt.date, dt.time)):
        return value.isoformat()
    return str(value).strip()


def _trim(cells: list[str]) -> list[str]:
    """Drop trailing empty cells — a workbook row is as wide as its widest cell."""
    end = len(cells)
    while end and not cells[end - 1]:
        end -= 1
    return cells[:end]


def _read_xlsx(raw: bytes) -> tuple[list[str] | None, list[tuple[int, list[str]]]]:
    """The first worksheet of an `.xlsx`, as (header, rows). Line numbers are
    Excel's own row numbers, so an error names the row the person sees."""
    _check_workbook_zip(raw)

    # Imported here so a CSV-only deployment never loads it, and so the guard
    # above has run before any openpyxl code touches the archive.
    import openpyxl

    try:
        workbook = openpyxl.load_workbook(
            io.BytesIO(raw), read_only=True, data_only=True, keep_links=False
        )
    except Exception:
        raise UnreadableFile(_NOT_A_WORKBOOK) from None

    header: list[str] | None = None
    rows: list[tuple[int, list[str]]] = []
    try:
        if not workbook.worksheets:
            raise UnreadableFile("That workbook has no worksheet.")
        sheet = workbook.worksheets[0]
        # Ignore the sheet's own claim about its size; see the module docstring.
        sheet.reset_dimensions()
        for line, values in enumerate(sheet.iter_rows(values_only=True), start=1):
            if line > _EXCEL_MAX_ROWS:
                raise UnreadableFile(_NOT_A_WORKBOOK)
            if len(values) > MAX_COLUMNS:
                raise UnreadableFile(
                    f"Row {line} of that workbook reaches past column {MAX_COLUMNS:,}. "
                    "Delete the unused columns to the right of the data, or save it "
                    "as CSV, and upload again."
                )
            cells = _trim([_cell_text(v) for v in values])
            if not cells:
                continue                                   # blank row
            if header is None:
                header = cells
                continue
            if len(rows) >= MAX_ROWS:
                raise UnreadableFile(f"That file has more than {MAX_ROWS:,} rows.")
            rows.append((line, cells))
    except UnreadableFile:
        raise
    except Exception:
        # openpyxl raising on a malformed sheet: still the sender's file, not
        # our bug, and still owed a sentence rather than a 500.
        raise UnreadableFile(_NOT_A_WORKBOOK) from None
    finally:
        workbook.close()
    if header is None:
        raise UnreadableFile("The first worksheet of that workbook is empty.")
    return header, rows


# ------------------------------------------------------------------ common


def _finish(header: list[str] | None, rows: list[tuple[int, list[str]]]) -> Table:
    """The checks every format shares, so a workbook cannot slip past one."""
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
