"""Repair LaTeX that a model wrote into JSON without escaping its backslashes.

Seen live on the NEET 2025 read: the model writes `"\\theta"` correctly most
of the time and `"\theta"` some of the time. JSON reads the second as a TAB
followed by "heta" — and it does so *silently*, because \t, \r, \f, \b and
\n are all legal JSON escapes. `\rho` arrives as CR + "ho", `\frac` as a
form feed + "rac", `\beta` as a backspace + "eta". (Commands starting with
any other letter would have made the JSON invalid and failed loudly.)

The repair is mechanical and safe: a TAB, CR, FF or backspace directly
followed by a letter never occurs in a transcribed exam question, so it can
only be a lost backslash. A real newline is legitimate text, so it is only
restored as `\n…` inside $...$ math and only before a known LaTeX command.

The trace keeps the model's output exactly as it arrived; the repair is
applied when the factory stores and uses it, and is idempotent.
"""

from __future__ import annotations

import re

_CONTROL = {"\t": "\\t", "\r": "\\r", "\f": "\\f", "\b": "\\b"}
_LOST_CONTROL = re.compile(r"[\t\r\f\b](?=[A-Za-z])")

# What follows the "n" of a LaTeX command that begins with \n.
_N_COMMANDS = (r"(?:u|eq|e|abla|ot|otin|i|eg|earrow|warrow|leq|geq|mid|parallel|"
               r"subseteq|exists|ewline)(?![A-Za-z])")
_LOST_N = re.compile(r"\n(?=" + _N_COMMANDS + ")")
_MATH = re.compile(r"\$[^$]+\$")


def repair(value):
    if not isinstance(value, str):
        return value
    value = _LOST_CONTROL.sub(lambda m: _CONTROL[m.group()], value)
    return _MATH.sub(lambda m: _LOST_N.sub(r"\\n", m.group()), value)


def repair_read(read: dict | None) -> dict | None:
    """Repair a stored transcription in place. Safe to run any number of times."""
    if not read:
        return read
    read["text"] = repair(read.get("text", ""))
    read["note"] = repair(read.get("note", ""))
    for o in read.get("options", []):
        o["text"] = repair(o.get("text", ""))
    return read


def normalise(doc: dict) -> dict:
    """Apply every repair to everything a model wrote into the extracted file."""
    for q in doc.get("questions", []):
        repair_read(q.get("read"))
        for key in ("solve",):
            step = q.get(key)
            if step:
                for k in ("working", "issue", "reason"):
                    step[k] = repair(step.get(k, ""))
        tags = q.get("tags")
        if tags:
            for d in tags.get("distractors", []):
                d["name"] = repair(d.get("name", ""))
                d["belief"] = repair(d.get("belief", ""))
    return doc
