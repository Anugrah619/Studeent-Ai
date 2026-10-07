"""Steps 0 and 1 — fetch the originals, then build the skeleton. No model is involved in either.

`fetch` downloads a file only if it is missing, and records it in the
manifest with its SHA-256. `prepare` then refuses to go on unless every
checksum still matches, parses the official key and the paper's layout,
proves the booklet code (NEET) or maps the option ids (JEE), and writes
the skeleton of `data/extracted/<paper>.json`: every question with its
official answer and nothing read yet.
"""

from __future__ import annotations

import urllib.request
from datetime import date

from . import papers_dir, store
from . import manifest as mf
from .keys import (
    all_neet_codes,
    jee_official_answer,
    neet_official_answer,
    parse_jee_key,
    parse_neet_key,
)
from .papers import PaperSpec, SourceFile
from .pdf import page_count, page_texts
from .structure import StructureError, jee_slots, neet_slots, verify_booklet


def fetch(spec: PaperSpec, *, downloaded_on: str | None = None) -> list[dict]:
    """Download (if absent) and record both originals. Returns manifest entries."""
    out = []
    for src in (spec.paper, spec.key):
        target = papers_dir() / src.file
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            req = urllib.request.Request(src.url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=120) as resp:   # noqa: S310 — fixed https URLs
                target.write_bytes(resp.read())
        existing = mf.lookup(src.file) or {}
        out.append(mf.record(_manifest_entry(
            spec, src, mf.sha256_file(target), page_count(target),
            downloaded_on or existing.get("downloaded_on") or date.today().isoformat(),
        )))
    return out


def _manifest_entry(spec: PaperSpec, src: SourceFile, sha: str, pages: int,
                    downloaded_on: str) -> dict:
    entry = {
        "file": f"papers/{src.file}",
        "kind": src.kind,
        "exam": spec.exam_label,
        "year": spec.year,
        "shift_or_booklet": spec.shift_or_booklet,
        "source_url": src.url,
        "listed_at": src.listed_at,
        "publisher": src.publisher,
        "provenance": "official" if src.official else "mirror",
        "downloaded_on": downloaded_on,
        "sha256": sha,
        "pages": pages,
        "note": src.note,
        "recorded_by": "question factory",
    }
    if spec.layout == "neet_booklet" and src.kind == "question_paper":
        entry["question_pages"] = list(spec.question_pages)
        entry["never_sent_to_model"] = (
            f"pages {spec.mirror_key_page}-{pages} (publisher's answer key and solutions)"
        )
    return entry


def _verified_path(src: SourceFile):
    mf.verify(f"papers/{src.file}")
    return papers_dir() / src.file


def prepare(spec: PaperSpec) -> dict:
    """Build (or rebuild) the skeleton, keeping any work already done per question."""
    paper_path = _verified_path(spec.paper)
    key_path = _verified_path(spec.key)
    paper_texts = page_texts(str(paper_path))
    key_texts = page_texts(str(key_path))
    first, last = spec.question_pages

    booklet_check = None
    if spec.layout == "neet_booklet":
        slots = neet_slots(paper_texts, first, last, spec.total_questions, spec.subjects)
        key = parse_neet_key(key_texts, spec.booklet_code, spec.total_questions)
        official = {n: neet_official_answer(key[n]) for n in key}
        if spec.mirror_key_page:
            every_code = {c: parse_neet_key(key_texts, c, spec.total_questions)
                          for c in all_neet_codes(key_texts)}
            booklet_check = verify_booklet(
                paper_texts[spec.mirror_key_page - 1], every_code, spec.booklet_code
            )
            if not booklet_check["ok"]:
                raise StructureError(
                    f"Booklet code check failed: {booklet_check['matches_by_code']}. "
                    f"The paper is not code {spec.booklet_code}, or the key is wrong."
                )
    else:
        slots = jee_slots(paper_texts, first, last, spec.total_questions)
        rows = {r.question_id: r for r in parse_jee_key(key_texts, spec.key_exam_date,
                                                         spec.key_shift, spec.key_centre)}
        missing = [s.question_id for s in slots if s.question_id not in rows]
        extra = set(rows) - {s.question_id for s in slots}
        if missing or extra:
            raise StructureError(
                f"Paper and key disagree on question ids: missing from key {missing[:5]}, "
                f"in key but not paper {sorted(extra)[:5]}."
            )
        official = {s.number: jee_official_answer(rows[s.question_id].value, s.qtype,
                                                  s.option_ids)
                    for s in slots}

    previous = store.load(spec.slug) or {}
    kept = {q["number"]: q for q in previous.get("questions", [])}

    questions = []
    for s in slots:
        old = kept.get(s.number, {})
        if old.get("question_id", "") not in ("", s.question_id):
            old = {}     # a different question now sits at this number — start clean
        # Skeleton fields are rebuilt from the documents; everything a later
        # step wrote (read, solve, check, tags, their histories, review
        # notes) is carried over untouched.
        questions.append({
            "read": None, "solve": None, "check": None, "tags": None,
            **old,
            "number": s.number,
            "subject": s.subject,
            "section": s.section,
            "pages": s.pages,
            "question_id": s.question_id,
            "option_ids": s.option_ids,
            "answer_type": s.answer_type,
            "official": official[s.number].as_dict(),
        })

    doc = {
        "paper": {
            "slug": spec.slug,
            "display_name": spec.display_name,
            "exam_code": spec.exam_code,
            "exam_label": spec.exam_label,
            "year": spec.year,
            "held_on": spec.held_on.isoformat(),
            "shift_or_booklet": spec.shift_or_booklet,
            "total_questions": spec.total_questions,
            "marking": {"correct": spec.marks_correct, "wrong": spec.marks_wrong},
            "question_pages": list(spec.question_pages),
            "question_paper": mf.lookup(f"papers/{spec.paper.file}"),
            "answer_key": mf.lookup(f"papers/{spec.key.file}"),
            "booklet_check": booklet_check,
            "answer_rule": "The answer is NTA's official key, parsed from NTA's PDF. "
                           "The model's answer is kept only for the cross-check.",
        },
        "prepared_at": store.now(),
        "questions": questions,
        "runs": previous.get("runs", []),
    }
    store.save(spec.slug, doc)
    return doc
