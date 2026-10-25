"""Describing a paper's options — what makes an institute's own paper diagnosable.

A blueprint gives each question a chapter and a key and nothing else: four
options with no text and no misconception. Results marked against it produce
scores, marks lost, derived state and flags — but not a diagnosis, because the
diagnosis is built on *which wrong option a student reached for and what
believing it means* (`reasoning.services.diagnose.build_context`). Until those
options are described, `GET /api/students/{id}/diagnosis/` answers 422
"options not described". This module is how they get described, once per
paper, by a person.

THE RULES, AND WHY EACH ONE
    * **The correct option never carries a misconception.** A misconception is
      the belief that produces a *wrong* answer; tagging the right one would
      make every student who got it right evidence of a mistake. Refused, for
      a real tag and for a proposal alike.
    * **A tag must exist in the taxonomy and belong to the question's
      subject.** `Misconception` is global and curated (TECHNICAL_DOC §4) —
      institutes share the vocabulary — so a console user picks from it and
      cannot add to it. A Physics belief on a Chemistry question is a typo
      with consequences: the diagnosis would quote it to a mentor.
    * **A proposal is a draft.** A belief the taxonomy lacks goes into
      `QuestionOption.draft_misconception*` — the same fields the factory's
      model proposals use — and counts for nothing: diagnosis reads only the
      foreign key. Promoting it means adding the code to the taxonomy (back
      office) and then tagging with it, which marks the draft `accepted`.
    * **Retagging under recorded answers is allowed.** Unlike a key (see
      `blueprint.py`), a tag changes no student's marks. It changes what a
      *future* diagnosis says, and the reasoning cache is keyed on the
      payload, so the next diagnosis is reasoned afresh rather than replayed.
    * **A key a reviewer found wrong cannot be tagged.** "Wrong option" is
      defined by the key; with the key in doubt, a tag could be pinned to the
      answer that is actually right. Option *text* may still be corrected —
      for a misread paper that is exactly the fix — and the question can then
      be reviewed again.
    * **All or nothing.** Every problem in the request is reported, against
      the option it concerns, and nothing is written unless there are none.

Options are always reached through their question, never by id: the option
table has no institute column and no row-level-security policy of its own, so
the question — which is policed — is the only safe way in.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from django.db import transaction
from django.utils import timezone

from apps.ingestion.models import Misconception, QuestionOption, QuestionTopicMap

logger = logging.getLogger(__name__)

#: Spellings of one subject. The NEET tree files Biology under its paper
#: sections (Botany, Zoology) while the taxonomy may say Biology; JEE's
#: official tree says Mathematics where the demo taxonomy says Maths.
SUBJECT_ALIASES = {
    "botany": "biology",
    "zoology": "biology",
    "mathematics": "maths",
    "math": "maths",
}

#: The lifecycle of a draft. `accepted`: a person tagged the option with the
#: draft's own code. `superseded`: a person tagged it with something else.
DRAFT_PENDING, DRAFT_ACCEPTED, DRAFT_SUPERSEDED = "draft", "accepted", "superseded"

#: Marks "the request did not mention this field", as distinct from null.
MISSING = object()


class ContentRejected(ValueError):
    """The request cannot be applied. `errors` is DRF's validation-error shape."""

    def __init__(self, errors: dict):
        super().__init__("content update rejected")
        self.errors = errors


@dataclass
class OptionEdit:
    """One entry of `options` in the request. `MISSING` means "leave as is"."""

    label: str
    text: object = MISSING
    misconception_code: object = MISSING
    draft: object = MISSING


@dataclass
class ContentEdit:
    question_text: object = MISSING
    solution: object = MISSING
    options: list[OptionEdit] = field(default_factory=list)


# ------------------------------------------------------------------ subjects


def canonical_subject(name: str | None) -> str:
    key = " ".join((name or "").split()).lower()
    return SUBJECT_ALIASES.get(key, key)


def question_subject(question: QuestionTopicMap) -> str:
    """The subject a question belongs to: its chapter's root, else the factory's label."""
    node = question.topic
    if node is not None:
        while node.parent_id is not None:
            node = node.parent
        return node.name
    return question.subject_name or ""


def subjects_matching(subject: str) -> list[str]:
    """Every `Misconception.subject` spelling that means the same subject."""
    wanted = canonical_subject(subject)
    return [
        s for s in Misconception.objects.order_by().values_list("subject", flat=True).distinct()
        if canonical_subject(s) == wanted
    ]


# -------------------------------------------------------------- presentation


def present_draft(option: QuestionOption) -> dict | None:
    """The draft on an option in one shape, whoever wrote it — or None.

    The factory writes `{kind, is_new, how_produced, name, belief, trace_id,
    status}` with the code beside it; a console proposal writes the same keys
    with `proposed_by: console` and no code. Callers see neither raw form.
    """
    draft = option.draft_misconception or {}
    code = option.draft_misconception_code or ""
    if not draft and not code:
        return None
    status = draft.get("status") or DRAFT_PENDING
    return {
        "code": code,
        "name": draft.get("name") or "",
        "description": draft.get("belief") or draft.get("description") or "",
        "is_new": bool(draft.get("is_new", not code)),
        "proposed_by": "console" if draft.get("proposed_by") == "console" else "model",
        "status": status if status in (DRAFT_PENDING, DRAFT_ACCEPTED, DRAFT_SUPERSEDED) else DRAFT_PENDING,
    }


def present_question(question: QuestionTopicMap, answered: set[str]) -> dict:
    """One question as the tagging screen needs it. `answered`: labels with attempts."""
    options = list(question.options.all())
    correct = [o.label for o in options if o.is_correct]
    topic = question.topic
    return {
        "id": question.id,
        "label": question.question_id,
        "topic": topic.name if topic is not None else None,
        "topic_id": question.topic_id,
        "subject": question_subject(question) or None,
        "answer_type": question.answer_type,
        "correct_option": ",".join(correct) if correct else None,
        "official_answer": question.official_answer,
        "question_text": question.question_text,
        "solution": question.solution,
        "difficulty": question.difficulty,
        "verification": question.verification,
        "has_answers": question.question_id in answered,
        "options": [
            {
                "label": o.label,
                "text": o.text,
                "is_correct": o.is_correct,
                "misconception": (
                    {"code": o.misconception.code, "name": o.misconception.name}
                    if o.misconception_id else None
                ),
                "draft_misconception": present_draft(o),
            }
            for o in options
        ],
    }


def summarise(questions: list[dict]) -> dict:
    """The counts a tagging screen leads with — how far the paper is through."""
    wrong = [o for q in questions for o in q["options"] if not o["is_correct"]]
    return {
        "questions": len(questions),
        "with_text": sum(1 for q in questions if (q["question_text"] or "").strip()),
        "wrong_options": len(wrong),
        "wrong_options_tagged": sum(1 for o in wrong if o["misconception"]),
        "wrong_options_with_draft": sum(
            1 for o in wrong
            if not o["misconception"] and o["draft_misconception"]
            and o["draft_misconception"]["status"] == DRAFT_PENDING
        ),
    }


# ------------------------------------------------------------------ the edit


def _validate(question: QuestionTopicMap, edit: ContentEdit) -> dict[str, Misconception]:
    """Every problem with the edit, or the misconceptions it names, by label."""
    if not edit.options:
        return {}
    options = {o.label: o for o in question.options.all()}
    if question.answer_type == QuestionTopicMap.NUMERICAL or not options:
        raise ContentRejected({"options": [
            "This is a numerical-value question; it has no options to describe."
        ]})

    # `c` names option `C`. Resolved once here, so everything after compares
    # the label as stored.
    by_upper = {label.upper(): label for label in options}
    for e in edit.options:
        e.label = by_upper.get(e.label.upper(), e.label)

    labels = [e.label for e in edit.options]
    repeated = sorted({lb for lb in labels if labels.count(lb) > 1})
    if repeated:
        raise ContentRejected({"options": [
            f"Option {', '.join(repeated)} appears more than once in the request."
        ]})

    subject = question_subject(question)
    key_in_doubt = question.verification == QuestionTopicMap.KEY_WRONG
    codes = {
        str(e.misconception_code).strip().upper()
        for e in edit.options
        if e.misconception_code not in (MISSING, None, "")
    }
    taxonomy = {m.code.upper(): m for m in Misconception.objects.filter(code__in=codes)} if codes else {}
    # `code__in` is case-sensitive; catch a lower-cased code on a second look.
    for code in codes - set(taxonomy):
        found = Misconception.objects.filter(code__iexact=code).first()
        if found is not None:
            taxonomy[code] = found

    errors: list[dict] = []
    chosen: dict[str, Misconception] = {}
    for e in edit.options:
        problems: dict[str, list[str]] = {}
        option = options.get(e.label)
        if option is None:
            problems["label"] = [
                f"There is no option '{e.label}' on this question; its options are "
                f"{', '.join(sorted(options))}."
            ]
            errors.append(problems)
            continue

        tagging = e.misconception_code not in (MISSING, None, "")
        proposing = e.draft not in (MISSING, None)
        if tagging and proposing:
            problems["draft_misconception"] = [
                "Give either a misconception from the taxonomy or a proposal for a "
                "new one, not both."
            ]
        if (tagging or proposing) and option.is_correct:
            problems["misconception_code" if tagging else "draft_misconception"] = [
                f"Option {e.label} is the correct answer, and the correct option "
                "cannot carry a misconception."
            ]
        elif (tagging or proposing) and key_in_doubt:
            problems["misconception_code" if tagging else "draft_misconception"] = [
                "A reviewer found this question's answer key wrong, so which options "
                "are wrong is not settled. Correct the key (or the option text) and "
                "review it again before describing its options."
            ]
        elif tagging:
            code = str(e.misconception_code).strip().upper()
            mis = taxonomy.get(code)
            if mis is None:
                problems["misconception_code"] = [
                    f"'{e.misconception_code}' is not in the misconception taxonomy."
                ]
            elif not subject:
                problems["misconception_code"] = [
                    "This question has no chapter or subject yet, so no misconception "
                    "can be checked against it. Map it to a chapter first."
                ]
            elif canonical_subject(mis.subject) != canonical_subject(subject):
                problems["misconception_code"] = [
                    f"{mis.code} is a {mis.subject} misconception; this is a "
                    f"{subject} question."
                ]
            else:
                chosen[e.label] = mis
        errors.append(problems)

    if any(errors):
        raise ContentRejected({"options": errors})
    return chosen


@transaction.atomic
def apply_content_edit(question: QuestionTopicMap, edit: ContentEdit, *, user) -> QuestionTopicMap:
    """Validate, then write, all of it or none of it. Raises `ContentRejected`."""
    question = (
        QuestionTopicMap.objects.select_for_update(of=("self",))
        .select_related("topic__parent__parent")
        .get(pk=question.pk)
    )
    chosen = _validate(question, edit)

    changed = []
    if edit.question_text is not MISSING:
        question.question_text = edit.question_text
        changed.append("question_text")
    if edit.solution is not MISSING:
        question.solution = edit.solution
        changed.append("solution")
    if changed:
        question.save(update_fields=changed)

    options = {o.label: o for o in question.options.all()}
    now = timezone.now()
    for e in edit.options:
        option = options[e.label]
        fields = []
        if e.text is not MISSING:
            option.text = e.text
            fields.append("text")
        if e.misconception_code is not MISSING:
            mis = chosen.get(e.label)
            option.misconception = mis
            fields.append("misconception")
            draft = option.draft_misconception
            if mis is not None and isinstance(draft, dict) and (
                (draft.get("status") or DRAFT_PENDING) == DRAFT_PENDING
            ):
                same = (option.draft_misconception_code or "").upper() == mis.code.upper()
                option.draft_misconception = {
                    **draft,
                    "status": DRAFT_ACCEPTED if same else DRAFT_SUPERSEDED,
                    "resolved_at": now.isoformat(),
                    "resolved_by_user": getattr(user, "id", None),
                }
                fields.append("draft_misconception")
        if e.draft is not MISSING:
            if e.draft is None:
                option.draft_misconception_code = ""
                option.draft_misconception = None
            else:
                option.draft_misconception_code = ""
                option.draft_misconception = {
                    "kind": "new",
                    "is_new": True,
                    "name": e.draft["name"],
                    "belief": e.draft["description"],
                    "how_produced": "",
                    "proposed_by": "console",
                    "proposed_by_user": getattr(user, "id", None),
                    "proposed_at": now.isoformat(),
                    "trace_id": None,
                    "status": DRAFT_PENDING,
                }
            fields += ["draft_misconception_code", "draft_misconception"]
        if fields:
            option.save(update_fields=sorted(set(fields)))

    # Who changed what, never the content itself.
    logger.info(
        "question %s content edited by user %s (%s; options %s)",
        question.id, getattr(user, "id", None), ", ".join(changed) or "no text fields",
        ", ".join(e.label for e in edit.options) or "none",
    )
    return question
