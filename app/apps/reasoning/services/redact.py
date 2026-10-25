"""Strip identifying text from what a student *types* before a model sees it.

WHY THIS IS A DIFFERENT PROBLEM FROM `diagnose.build_context`
    Every other payload in this codebase is built field by field from the
    database, so privacy there is a matter of not copying the wrong column.
    A question the student types is the opposite: free text, written by a
    minor, about themselves. Nothing structural stops "I'm Aarav, roll
    R7741, Priya ma'am says I'm weak at organic" from arriving, and the free
    tier may use what we send for training, with human review.

    So the text is scrubbed against everything we *know* identifies this
    student — their own name and its parts, their roll number and login,
    their mentor, their institute — plus the two shapes that identify anyone
    (phone numbers and email addresses). Each is replaced by a bracketed
    placeholder, so the model still reads a grammatical sentence and can
    answer it.

WHAT IT CANNOT DO — the residual risk, stated plainly
    It removes what it has been told about. It does not find:
      * names of other people — a classmate, a parent, a teacher who is not
        the assigned mentor;
      * misspellings, nicknames and transliterations ("Arav" for "Aarav",
        a Hindi name typed in Devanagari when it is stored in Latin script);
      * other identifiers: a school, a street, an Aadhaar number shorter
        than the phone pattern, a social handle;
      * a roll number of fewer than four digits (`MIN_NUMERIC_TOKEN`), which
        cannot be told apart from an ordinary number in a sentence;
      * things a student volunteers about health, family or money.
    The system prompt and the screen ("don't type personal details") are
    the other two layers. This is the one that is guaranteed.

    The scrubbed text is what is stored in `ReasoningTrace.context`; the raw
    text is never written anywhere.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

#: Shorter name parts are skipped. An initial ("A.") identifies nobody, and
#: stripping every one-letter token would shred the sentence ("I", "a").
MIN_PART_LENGTH = 2

#: A roll number or login made only of digits is scrubbed only from this
#: length up. "12" identifies almost nobody, and scrubbing it would turn
#: "Revision 1 was due 12 days ago" into nonsense. Longer numeric roll
#: numbers ("240117") are scrubbed like any other.
MIN_NUMERIC_TOKEN = 4

#: Words that appear in institute names but identify nothing on their own.
#: "Aarambh Classes" must lose "Aarambh"; it must not lose the word
#: "classes" from "I miss classes on Sunday".
GENERIC_INSTITUTE_WORDS = frozenset({
    "academy", "and", "career", "careers", "centre", "center", "classes",
    "coaching", "college", "education", "group", "institute", "of",
    "point", "pvt", "ltd", "school", "study", "studies", "the", "tutorials",
})

#: Nine or more digits, optionally `+`-prefixed and separated by single
#: spaces, dashes, dots or brackets: an Indian mobile (`98765 43210`,
#: `+91-98765-43210`) or a landline with its code. Nine, not eight, so a
#: date written `24.10.2026` (eight digits) is not mistaken for one.
PHONE = re.compile(r"(?<!\w)\+?\d(?:[\s\-.()]?\d){8,}(?!\w)")

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")

NAME, ROLL, LOGIN, MENTOR, INSTITUTE, PHONE_TOKEN, EMAIL_TOKEN = (
    "[name]", "[roll number]", "[username]", "[mentor]", "[institute]", "[phone]", "[email]",
)


@dataclass(frozen=True)
class Identifiers:
    """Everything known to identify one student, grouped by what it is.

    Grouped so each kind gets its own placeholder: the model reading
    "[mentor] says I should…" can still tell who is speaking.
    """

    names: list[str] = field(default_factory=list)          # the student
    tokens: list[str] = field(default_factory=list)         # roll number
    logins: list[str] = field(default_factory=list)         # sign-in username
    mentor: list[str] = field(default_factory=list)
    institute: list[str] = field(default_factory=list)
    emails: list[str] = field(default_factory=list)


def _parts(full: str) -> list[str]:
    """A name and each of its words, longest first."""
    full = (full or "").strip()
    if not full:
        return []
    words = [w.strip(".,") for w in full.split()]
    out = [full] + [w for w in words if len(w) >= MIN_PART_LENGTH]
    return sorted(dict.fromkeys(out), key=len, reverse=True)


def identifiers_for(student) -> Identifiers:
    """What to scrub for this student. Reads the database; pure otherwise."""
    user = getattr(student, "user", None)
    mentor = getattr(student, "mentor", None)
    institute = getattr(student, "institute", None)

    username = user.get_username() if user is not None else ""
    logins = [username] if username and username != student.roll_no else []

    institute_terms: list[str] = []
    if institute is not None:
        institute_terms = [institute.name, institute.slug, institute.slug.replace("-", " "),
                           institute.city]
        institute_terms += [
            w for w in re.split(r"[\s\-]+", institute.name)
            if len(w) >= 4 and w.lower() not in GENERIC_INSTITUTE_WORDS
        ]

    def worth_scrubbing(token: str) -> bool:
        return (
            len(token) >= MIN_PART_LENGTH
            and not (token.isdigit() and len(token) < MIN_NUMERIC_TOKEN)
        )

    emails = [e for e in (getattr(user, "email", ""), getattr(mentor, "email", "")) if e]
    return Identifiers(
        names=_parts(student.name),
        tokens=[t for t in [student.roll_no] if t and worth_scrubbing(t)],
        logins=[t for t in logins if worth_scrubbing(t)],
        mentor=_parts(mentor.name) if mentor is not None else [],
        institute=sorted({t for t in institute_terms if t}, key=len, reverse=True),
        emails=emails,
    )


def _whole_words(terms: list[str]) -> re.Pattern | None:
    """One case-insensitive pattern matching any term as a whole word.

    Whole word, so stripping a student called "Om" leaves "from" intact.
    Longest terms first, so "Priya Sharma" is replaced as one unit rather
    than as "[mentor] [mentor]". Never inside a placeholder, so running the
    scrub twice changes nothing: a mentor whose name contains the word
    "mentor" must not turn `[mentor]` into `[[mentor]]`.
    """
    terms = [t for t in dict.fromkeys(terms) if t]
    if not terms:
        return None
    alternatives = "|".join(re.escape(t) for t in sorted(terms, key=len, reverse=True))
    return re.compile(rf"(?<![\w\[])(?:{alternatives})(?![\w\]])", re.IGNORECASE)


def redact(text: str, ids: Identifiers) -> str:
    """`text` with every known identifier replaced by a placeholder.

    Order matters: emails before names (an address contains the name);
    the student's name before their login, so a username that *is* their
    first name reads as `[name]`; and phones last, so a roll number made of
    digits is called a roll number.
    """
    out = text or ""
    known_emails = _whole_words(ids.emails)
    if known_emails:
        out = known_emails.sub(EMAIL_TOKEN, out)
    out = EMAIL.sub(EMAIL_TOKEN, out)
    for terms, token in (
        (ids.names, NAME),
        (ids.tokens, ROLL),
        (ids.logins, LOGIN),
        (ids.mentor, MENTOR),
        (ids.institute, INSTITUTE),
    ):
        pattern = _whole_words(terms)
        if pattern:
            out = pattern.sub(token, out)
    return PHONE.sub(PHONE_TOKEN, out)
