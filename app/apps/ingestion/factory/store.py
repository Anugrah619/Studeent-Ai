"""Shelf 2 — `data/extracted/<paper>.json`, one file per paper, saved after every batch.

The file is the pipeline's memory between runs. Each question carries the
result of each step under its own key (`official`, `read`, `solve`,
`check`, `tags`), so a run interrupted by an exhausted quota leaves
everything it finished on disk and the next run only does what is missing.
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from . import extracted_dir


def path_for(slug: str) -> Path:
    return extracted_dir() / f"{slug}.json"


def load(slug: str) -> dict | None:
    """The extracted file, with model-JSON escaping defects repaired (see text.py)."""
    from .text import normalise

    p = path_for(slug)
    if not p.exists():
        return None
    return normalise(json.loads(p.read_text(encoding="utf-8")))


def save(slug: str, doc: dict) -> Path:
    p = path_for(slug)
    p.parent.mkdir(parents=True, exist_ok=True)
    doc["saved_at"] = now()
    fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=f".{slug}-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, p)
    return p


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def question(doc: dict, number: int) -> dict:
    return doc["questions"][number - 1]


def log_run(doc: dict, step: str, **stats) -> None:
    doc.setdefault("runs", []).append({"step": step, "at": now(), **stats})
