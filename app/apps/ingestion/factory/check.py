"""Step 4 — the cross-check. Pure comparison; no model, no network.

    agreed        the blind solution matches NTA's official key → accepted
    disagreed     it does not → review queue. Either the reading or the
                  solving was wrong, and a person decides which.
    unverifiable  the model could not solve it (a figure it could not
                  read), the question was not read, or NTA dropped it

The official answer never changes here. A disagreement is a reason to
look, not a reason to doubt the key: NTA's final key has already been
through a public challenge.
"""

from __future__ import annotations

import re
from collections import Counter
from decimal import Decimal, InvalidOperation

from . import store
from .papers import PaperSpec

AGREED, DISAGREED, UNVERIFIABLE = "agreed", "disagreed", "unverifiable"


def normalise_label(answer: str) -> str:
    """"(2)", "2", "Option 2", "option (2)" → "2". Anything else → as given."""
    m = re.fullmatch(r"\s*(?:option\s*)?\(?\s*([1-4])\s*\)?\s*\.?\s*", answer or "", re.I)
    return m.group(1) if m else (answer or "").strip()


def to_decimal(value: str) -> Decimal | None:
    try:
        return Decimal(str(value).strip().replace(",", ""))
    except (InvalidOperation, ValueError):
        return None


def same_number(a: str, b: str) -> bool:
    x, y = to_decimal(a), to_decimal(b)
    if x is None or y is None:
        return False
    return abs(x - y) <= Decimal("1e-6") * max(Decimal(1), abs(y))


def check_question(q: dict) -> dict | None:
    """The verdict for one question, or None if it is not ready to judge."""
    official = q["official"]
    read, solve = q.get("read"), q.get("solve")
    base = {"official": official["display"], "has_diagram": bool(read and read["has_diagram"])}

    if official["dropped"]:
        return {**base, "status": UNVERIFIABLE, "why": "dropped by NTA — no official answer",
                "model": (solve or {}).get("answer", "")}
    if read is None:
        return None
    if solve is None:
        return None
    if solve["status"] == "cannot_solve":
        return {**base, "status": UNVERIFIABLE, "model": "",
                "why": f"model could not solve it ({solve.get('reason') or 'no reason given'})"}

    if q["answer_type"] == "mcq":
        model = normalise_label(solve["answer"])
        ok = model in official["labels"]
    else:
        model = solve["answer"].strip()
        ok = same_number(model, official["numeric"])
    return {
        **base, "status": AGREED if ok else DISAGREED, "model": model,
        "why": "" if ok else "model's blind answer differs from the official key",
        "confidence": solve.get("confidence", ""),
        "issue": solve.get("issue", ""),
        "read_issues": read.get("issues", []),
    }


def run(spec: PaperSpec, doc: dict) -> dict:
    for q in doc["questions"]:
        q["check"] = check_question(q)
    s = stats(doc)
    store.log_run(doc, "check", **{k: s[k] for k in ("agreed", "disagreed", "unverifiable",
                                                      "pending")})
    doc["paper"]["cross_check"] = {k: s[k] for k in
                                   ("agreed", "disagreed", "unverifiable", "pending",
                                    "agreement_rate", "agreement_rate_all")}
    store.save(spec.slug, doc)
    return s


def stats(doc: dict) -> dict:
    qs = doc["questions"]
    status = Counter((q.get("check") or {}).get("status", "pending") for q in qs)
    judged = status[AGREED] + status[DISAGREED]
    by_subject: dict[str, Counter] = {}
    for q in qs:
        by_subject.setdefault(q["subject"] or "?", Counter())[
            (q.get("check") or {}).get("status", "pending")] += 1
    return {
        "paper": doc["paper"]["display_name"],
        "questions": len(qs),
        "read": sum(1 for q in qs if q.get("read")),
        "solved": sum(1 for q in qs if q.get("solve")),
        "tagged": sum(1 for q in qs if q.get("tags")),
        "diagrams": sum(1 for q in qs if q.get("read") and q["read"]["has_diagram"]),
        "read_issues": [q["number"] for q in qs if q.get("read") and q["read"]["issues"]],
        AGREED: status[AGREED], DISAGREED: status[DISAGREED],
        UNVERIFIABLE: status[UNVERIFIABLE], "pending": status["pending"],
        # Of the questions the model could actually judge.
        "agreement_rate": round(status[AGREED] / judged, 4) if judged else None,
        # Of every question in the paper — the stricter number.
        "agreement_rate_all": round(status[AGREED] / len(qs), 4) if qs else None,
        "by_subject": {k: dict(v) for k, v in by_subject.items()},
        "disagreements": [
            {"number": q["number"], "subject": q["subject"],
             "official": q["check"]["official"], "model": q["check"]["model"],
             "confidence": q["check"].get("confidence", ""),
             "has_diagram": q["check"]["has_diagram"],
             "issue": q["check"].get("issue", ""),
             "working": (q.get("solve") or {}).get("working", ""),
             "read_issues": q["check"].get("read_issues", [])}
            for q in qs if (q.get("check") or {}).get("status") == DISAGREED
        ],
        "unverifiable_list": [
            {"number": q["number"], "why": q["check"]["why"]}
            for q in qs if (q.get("check") or {}).get("status") == UNVERIFIABLE
        ],
    }


def render(s: dict, detail: bool = False) -> str:
    rate = f"{s['agreement_rate']:.1%}" if s["agreement_rate"] is not None else "—"
    rate_all = f"{s['agreement_rate_all']:.1%}" if s["agreement_rate_all"] is not None else "—"
    lines = [
        f"  {s['paper']}: {s['questions']} questions · read {s['read']} · solved "
        f"{s['solved']} · tagged {s['tagged']} · diagrams {s['diagrams']}",
        f"  agreed {s['agreed']} · disagreed {s['disagreed']} · unverifiable "
        f"{s['unverifiable']} · pending {s['pending']}",
        f"  agreement {rate} of questions the model could judge; {rate_all} of the whole paper",
    ]
    for subj, c in s["by_subject"].items():
        lines.append(f"    {subj:12} " + " · ".join(f"{k} {v}" for k, v in sorted(c.items())))
    if s["read_issues"]:
        lines.append(f"  transcription issues flagged on: {s['read_issues']}")
    if detail or s["disagreements"]:
        for d in s["disagreements"]:
            lines.append(
                f"  ✗ Q{d['number']} ({d['subject']}{', figure' if d['has_diagram'] else ''}): "
                f"official {d['official']}, model {d['model']} [{d['confidence']}]"
                + (f" — {d['issue']}" if d["issue"] else "")
            )
            if detail and d["working"]:
                lines.append(f"      model's working: {d['working']}")
    if detail:
        for u in s["unverifiable_list"]:
            lines.append(f"  ? Q{u['number']}: {u['why']}")
    return "\n".join(lines)
