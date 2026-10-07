"""The two things the factory needs from a PDF without a model: its text layer, and a page subset.

The subset matters more than it looks. A mirrored paper often carries the
publisher's own answer key and worked solutions after the questions; the
NEET 2025 mirror does, from page 26 on. Sending the whole file to a model
that is meant to solve the paper blind would hand it the answers. So the
model only ever receives the question pages, cut out here.
"""

from __future__ import annotations

import io
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=8)
def page_texts(path: str) -> tuple[str, ...]:
    from pypdf import PdfReader

    reader = PdfReader(path)
    return tuple((page.extract_text() or "") for page in reader.pages)


def page_count(path: Path | str) -> int:
    return len(page_texts(str(path)))


def subset(path: Path | str, pages: list[int] | tuple[int, ...]) -> bytes:
    """A new PDF holding only `pages` (1-based) of `path`, in that order."""
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(str(path))
    writer = PdfWriter()
    for p in pages:
        if not 1 <= p <= len(reader.pages):
            raise ValueError(f"page {p} is outside {Path(path).name} (1–{len(reader.pages)})")
        writer.add_page(reader.pages[p - 1])
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()
