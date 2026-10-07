"""`data/raw/manifest.json` — what each original file is, where it came from, and its checksum.

Shelf 1 is only trustworthy if every file on it can be traced: the URL it
was fetched from, the day, whether that URL is NTA's own or a mirror, and a
SHA-256 so a silently replaced file is caught before anything is read out
of it. Other agents append to the same manifest (the syllabus PDFs live on
this shelf too), so writes are upserts keyed on `file`, never rewrites of
the whole list from memory.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path

from . import manifest_path, papers_dir


class ChecksumMismatch(RuntimeError):
    """The file on disk is not the file the manifest recorded."""


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _read() -> tuple[object, list[dict]]:
    """Return (container, entries). Tolerates a bare list or {"files": [...]}."""
    path = manifest_path()
    if not path.exists():
        container: dict = {"files": []}
        return container, container["files"]
    data = json.loads(path.read_text(encoding="utf-8") or "{}")
    if isinstance(data, list):
        return data, data
    for key in ("files", "entries", "documents"):
        if isinstance(data.get(key), list):
            return data, data[key]
    data["files"] = []
    return data, data["files"]


def _write(container: object) -> None:
    path = manifest_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".manifest-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(container, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, path)


def entries() -> list[dict]:
    return _read()[1]


def lookup(file: str) -> dict | None:
    return next((e for e in entries() if e.get("file") == file), None)


def record(entry: dict) -> dict:
    """Upsert one entry by `file`. Returns the stored entry."""
    container, items = _read()
    for i, existing in enumerate(items):
        if existing.get("file") == entry["file"]:
            items[i] = {**existing, **entry}
            _write(container)
            return items[i]
    items.append(entry)
    _write(container)
    return entry


def verify(file: str) -> str:
    """Recompute the checksum of `data/raw/papers/<file>` against the manifest."""
    entry = lookup(file)
    if entry is None:
        raise ChecksumMismatch(f"{file} is not in the manifest. Run `factory fetch` first.")
    actual = sha256_file(papers_dir() / Path(file).name)
    if actual != entry.get("sha256"):
        raise ChecksumMismatch(
            f"{file}: checksum {actual[:12]}… does not match the manifest's "
            f"{str(entry.get('sha256'))[:12]}…. The original has changed since it "
            f"was recorded — re-fetch it rather than reading a file nobody traced."
        )
    return actual
