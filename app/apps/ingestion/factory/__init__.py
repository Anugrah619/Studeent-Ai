"""The question factory — real past papers in, through a pipeline that makes them trustworthy.

    manage.py factory fetch   <paper>   download if missing, checksum, record in manifest
    manage.py factory prepare <paper>   official key + paper skeleton, no model involved
    manage.py factory read    <paper>   Gemini transcribes the paper, a few pages per call
    manage.py factory solve   <paper>   Gemini solves it blind — it never sees the key
    manage.py factory check   <paper>   compare with the official key: agreed / disagreed / unverifiable
    manage.py factory tag     <paper>   chapter, difficulty, draft misconception per wrong option
    manage.py factory load    <paper>   into the database as a TestPaper, disagreements unconfirmed
    manage.py factory report  <paper>

**Open book, not closed book.** Gemini reads the official PDF; it is never
the source of a question, an answer, or a year. The answer is always the
official NTA key, parsed deterministically from NTA's own PDF. Gemini's
solution exists only to be compared with it: agreement accepts a question,
disagreement sends it to a person, and a person only ever reviews the
disagreements.

Everything the model touches is resumable and cached (one `ReasoningTrace`
per call), so a free-tier quota running out mid-paper stops the run cleanly
and the next run picks up exactly where it stopped. What was read lives in
`data/extracted/<paper>.json` — out of git, because the repository is public
and the question text is not ours to publish.
"""

from __future__ import annotations

from pathlib import Path

from django.conf import settings


def data_dir() -> Path:
    """`<repo>/data`, overridable so tests never write to the real shelves."""
    override = getattr(settings, "FACTORY_DATA_DIR", None)
    return Path(override) if override else Path(settings.BASE_DIR).parent / "data"


def papers_dir() -> Path:
    return data_dir() / "raw" / "papers"


def manifest_path() -> Path:
    return data_dir() / "raw" / "manifest.json"


def extracted_dir() -> Path:
    return data_dir() / "extracted"


def syllabus_dir() -> Path:
    return data_dir() / "syllabus"
