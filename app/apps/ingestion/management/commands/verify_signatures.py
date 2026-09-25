"""Prove, from the database, that each hero's signature is not luck.

    python manage.py verify_signatures --institute aarambh

Seeding data that *contains* a pattern and seeding data that *shows* one
are different things. If a signature is only as concentrated as chance
would make it, the reasoning layer has nothing to find, the model will
either say "no clear pattern" (honest, and a flat demo) or invent one
(dishonest, and a worse demo). Either way the pitch falls over.

So this command does not trust the generator. It reads the answers back
out of Postgres with SQL, and for every hero asks one question:

    On the questions that offered the bait for this student's signature
    misconception, how often did *they* take it, and how often did
    everyone else take it?

The gap between those two numbers, with an exact binomial p-value against
the cohort rate, is the claim the demo rests on. A control student — the
non-hero whose errors happen to clump the most — is measured the same way
and is expected to show nothing.

Exit status is 1 if any hero fails, so this can sit in CI next to the
tests rather than being something a human remembers to eyeball.
"""

from __future__ import annotations

import math
from collections import defaultdict

from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from apps.events.models import Attempt
from apps.ingestion.demo_questions import QUESTIONS
from apps.ingestion.models import TestPaper
from apps.tenancy.models import Institute, Student

#: A hero's signature has to clear both of these to count as demonstrated.
MAX_P_VALUE = 0.01      # exact binomial, one-sided, against the cohort rate
MIN_LIFT = 2.5          # hero's bait rate / cohort's bait rate

# --------------------------------------------------------------------- SQL
#
# Deliberately raw. The point of this command is to check the data as it
# actually sits on disk, so going through the ORM's own object graph —
# which is what wrote the rows — would be marking its own homework.

SQL_OFFERED = """
SELECT m.code, COUNT(DISTINCT q.id) AS offered
FROM   ingestion_questionoption   o
JOIN   ingestion_questiontopicmap q ON q.id = o.question_id
JOIN   ingestion_misconception    m ON m.id = o.misconception_id
WHERE  q.test_paper_id = %s
GROUP  BY m.code
"""

SQL_TAKEN = """
SELECT a.student_id, m.code, COUNT(*) AS taken
FROM   events_attempt a
JOIN   ingestion_questiontopicmap q
       ON q.test_paper_id = a.test_paper_id
      AND q.question_id   = a.question_id
JOIN   ingestion_questionoption o
       ON o.question_id = q.id
      AND o.label       = a.chosen_option
JOIN   ingestion_misconception m ON m.id = o.misconception_id
WHERE  a.test_paper_id = %s
  AND  a.institute_id  = %s
GROUP  BY a.student_id, m.code
"""

SQL_TOTALS = """
SELECT a.student_id,
       COUNT(*)                                        AS answered,
       COUNT(*) FILTER (WHERE a.status = %s)           AS wrong
FROM   events_attempt a
WHERE  a.test_paper_id = %s
  AND  a.institute_id  = %s
GROUP  BY a.student_id
"""

SQL_ON_QUESTIONS = """
SELECT a.student_id, a.question_id, a.status
FROM   events_attempt a
WHERE  a.test_paper_id = %s
  AND  a.institute_id  = %s
  AND  a.question_id   = ANY(%s)
"""


def _rows(sql, params):
    with connection.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


# --------------------------------------------------------------- statistics

def binomial_tail(k: int, n: int, p: float) -> float:
    """P(X >= k) for X ~ Binomial(n, p). Exact, no scipy."""
    if k <= 0:
        return 1.0
    if k > n:
        return 0.0
    p = min(max(p, 1e-9), 1 - 1e-9)
    return sum(
        math.comb(n, i) * p ** i * (1 - p) ** (n - i)
        for i in range(k, n + 1)
    )


# ------------------------------------------------------------------ gather

def counter_evidence_questions(paper) -> dict[str, list[str]]:
    """code -> question ids deliberately built so that belief cannot fire.

    The `counter_to` marking lives in demo_questions.py; the question ids
    live in the database. Matching on stem text is the join between them.
    """
    by_stem = dict(
        paper.question_map.values_list("question_text", "question_id")
    )
    out: dict[str, list[str]] = defaultdict(list)
    for spec in QUESTIONS:
        for code in spec.get("counter_to", ()):
            qid = by_stem.get(spec["stem"])
            if qid:
                out[code].append(qid)
    return {code: sorted(ids) for code, ids in out.items()}


def analyse(institute, paper, signatures: dict[str, str]) -> dict:
    """Everything the report needs, read back out of the database."""
    students = {
        s.id: s for s in Student.objects.filter(institute=institute)
    }
    by_name = {s.name: s for s in students.values()}

    offered = dict(_rows(SQL_OFFERED, [paper.id]))

    taken: dict[int, dict[str, int]] = defaultdict(dict)
    for student_id, code, n in _rows(SQL_TAKEN, [paper.id, institute.id]):
        taken[student_id][code] = n

    totals = {
        sid: {"answered": answered, "wrong": wrong}
        for sid, answered, wrong in _rows(
            SQL_TOTALS, [Attempt.WRONG, paper.id, institute.id]
        )
    }

    # Who is a hero, by student id.
    hero_ids = {
        by_name[name].id: code
        for name, code in signatures.items()
        if name in by_name
    }

    # Cohort rate for a code = how often students who do NOT carry that
    # signature chose an option tagged with it, per opportunity. This is the
    # null hypothesis: "a distractor that plausible gets picked this often".
    cohort: dict[str, tuple[int, int]] = {}
    for code, n_offered in offered.items():
        picks = trials = 0
        for sid in totals:
            if hero_ids.get(sid) == code:
                continue
            picks += taken.get(sid, {}).get(code, 0)
            trials += n_offered
        cohort[code] = (picks, trials)

    counters = counter_evidence_questions(paper)
    counter_results: dict[str, dict[int, list[tuple[str, str]]]] = {}
    for code, qids in counters.items():
        rows = _rows(SQL_ON_QUESTIONS, [paper.id, institute.id, qids])
        per_student: dict[int, list[tuple[str, str]]] = defaultdict(list)
        for sid, qid, status in rows:
            per_student[sid].append((qid, status))
        counter_results[code] = per_student

    return {
        "students": students,
        "by_name": by_name,
        "offered": offered,
        "taken": taken,
        "totals": totals,
        "hero_ids": hero_ids,
        "cohort": cohort,
        "counters": counters,
        "counter_results": counter_results,
    }


def signature_strength(data: dict, student, code: str) -> dict:
    """The one row the whole demo rests on, for one student and one code."""
    n = data["offered"].get(code, 0)
    k = data["taken"].get(student.id, {}).get(code, 0)

    picks, trials = data["cohort"].get(code, (0, 0))
    # Do not let an all-zero cohort produce a p-value of exactly zero: floor
    # the null rate at one pick in the trials we actually observed.
    base = picks / trials if trials else 0.0
    base_floor = max(base, 1 / trials) if trials else 0.05

    wrong = data["totals"].get(student.id, {}).get("wrong", 0)
    return {
        "code": code,
        "offered": n,
        "taken": k,
        "rate": k / n if n else 0.0,
        "cohort_rate": base,
        "lift": (k / n) / base_floor if n else 0.0,
        "p_value": binomial_tail(k, n, base_floor),
        "wrong_total": wrong,
        "share_of_wrong": k / wrong if wrong else 0.0,
    }


def worst_control(data: dict, exclude_ids: set[int]):
    """The non-hero whose errors clump hardest — the toughest control.

    Picking a random control proves little; picking the single student the
    data is most likely to produce a false positive on is the honest test.
    Returns (student, row, cells_searched) so the p-value can be read with
    the multiple-comparison context it needs: the maximum of several hundred
    student x misconception cells is *supposed* to look unusual.
    """
    best = None
    cells = 0
    for sid, student in data["students"].items():
        if sid in exclude_ids or sid not in data["totals"]:
            continue
        for code in data["offered"]:
            row = signature_strength(data, student, code)
            if row["offered"] < 3:
                continue
            cells += 1
            if best is None or row["rate"] > best[1]["rate"]:
                best = (student, row)
    if best is None:
        return None
    return best[0], best[1], cells


def code_spread(data: dict, student, top: int = 4) -> str:
    """How that student's tagged wrong answers split across beliefs."""
    takes = data["taken"].get(student.id, {})
    rows = sorted(takes.items(), key=lambda kv: -kv[1])[:top]
    return ", ".join(
        f"{code} {n}/{data['offered'].get(code, 0)}" for code, n in rows
    ) or "no tagged wrong answers"


# -------------------------------------------------------------------- report

def render(cmd, data: dict, signatures: dict[str, str], paper) -> bool:
    """Write the report to stdout. Returns True if every hero passed."""
    w = cmd.stdout.write
    ok = True

    n_students = len(data["totals"])
    answered = sum(t["answered"] for t in data["totals"].values())

    w("")
    w(cmd.style.MIGRATE_HEADING(
        f"{paper.name}  -  {paper.total_questions} questions  -  "
        f"{n_students} students  -  {answered} answers"
    ))
    w("")
    w("  Bait rate = share of the questions offering that misconception's")
    w("  distractor on which the student actually chose it. Cohort rate is")
    w("  the same figure for every student who does NOT hold that belief -")
    w("  the null hypothesis. p is an exact one-sided binomial tail.")
    w("")
    w(f"  {'student':<18}{'misconception':<19}{'bait':>7}  {'rate':>5}"
      f"  {'cohort':>6}  {'lift':>5}  {'p':>9}  {'of wrong':>9}")
    w("  " + "-" * 82)

    for name, code in signatures.items():
        student = data["by_name"].get(name)
        if student is None:
            w(f"  {name:<18}not enrolled - skipped")
            continue
        r = signature_strength(data, student, code)
        passed = r["p_value"] <= MAX_P_VALUE and r["lift"] >= MIN_LIFT
        ok = ok and passed
        line = (
            f"  {name:<18}{code:<19}"
            f"{r['taken']:>3}/{r['offered']:<3}  {r['rate']:>4.0%}"
            f"  {r['cohort_rate']:>5.0%}  {r['lift']:>4.1f}x"
            f"  {r['p_value']:>9.5f}"
            f"  {r['taken']}/{r['wrong_total']:<3} {r['share_of_wrong']:>3.0%}"
        )
        w(line if passed else cmd.style.ERROR(line + "   FAIL"))

    # ---- counter-evidence ------------------------------------------------
    w("")
    w("  COUNTER-EVIDENCE - same chapter, trigger absent, belief cannot fire.")
    w("  These are the questions that turn 'weak chapter' into 'specific")
    w("  trigger'. A hero is expected to get all of them right.")
    w("")
    for name, code in signatures.items():
        student = data["by_name"].get(name)
        if student is None:
            continue
        rows = data["counter_results"].get(code, {}).get(student.id, [])
        if not rows:
            w(cmd.style.ERROR(
                f"  {name:<18}{code:<19}no counter-evidence questions - FAIL"
            ))
            ok = False
            continue
        right = [q for q, s in rows if s == Attempt.CORRECT]
        detail = ", ".join(q for q, _ in sorted(rows))
        line = (f"  {name:<18}{code:<19}"
                f"{len(right)}/{len(rows)} correct   ({detail})")
        if len(right) == len(rows):
            w(line)
        else:
            w(cmd.style.ERROR(line + "   FAIL"))
            ok = False

    # ---- control ---------------------------------------------------------
    w("")
    w("  CONTROL - the non-hero whose wrong answers clump the hardest.")
    w("  If this student also looks diagnosable, the heroes prove nothing.")
    w("")
    control = worst_control(data, set(data["hero_ids"]))
    if control is None:
        w("  no control student available")
    else:
        student, r, cells = control
        clean = r["p_value"] > MAX_P_VALUE or r["lift"] < MIN_LIFT
        line = (
            f"  {student.name:<18}{r['code']:<19}"
            f"{r['taken']:>3}/{r['offered']:<3}  {r['rate']:>4.0%}"
            f"  {r['cohort_rate']:>5.0%}  {r['lift']:>4.1f}x"
            f"  {r['p_value']:>9.5f}"
            f"  {r['taken']}/{r['wrong_total']:<3} {r['share_of_wrong']:>3.0%}"
        )
        w(line if clean else cmd.style.ERROR(line + "   <- looks like a signature"))
        w(f"  {'':<18}strongest of {cells} student x misconception cells, so it "
          f"is the best that noise managed")
        w(f"  {'':<18}his errors spread: {code_spread(data, student)}")
        ok = ok and clean

    w("")
    if ok:
        w(cmd.style.SUCCESS(
            "  PASS - every hero's signature clears "
            f"p <= {MAX_P_VALUE} and {MIN_LIFT}x lift; the control does not."
        ))
    else:
        w(cmd.style.ERROR(
            "  FAIL - at least one signature is indistinguishable from chance. "
            "The reasoning layer has nothing to find here."
        ))
    w("")
    return ok


class Command(BaseCommand):
    help = "Check that each hero's misconception signature stands out from chance."

    def add_arguments(self, parser):
        parser.add_argument("--institute", default="aarambh")
        parser.add_argument("--paper", default=None,
                            help="Paper name; defaults to the diagnostic paper.")

    def handle(self, *args, **opts):
        # Imported here rather than at module scope: seed_questions imports
        # this module for its own report, and importing it back at the top
        # would be a cycle.
        from apps.ingestion.management.commands.seed_questions import (
            PAPER_NAME, SIGNATURES,
        )

        try:
            institute = Institute.objects.get(slug=opts["institute"])
        except Institute.DoesNotExist:
            raise CommandError(f"No institute '{opts['institute']}'.")

        name = opts["paper"] or PAPER_NAME
        paper = TestPaper.objects.filter(institute=institute, name=name).first()
        if paper is None:
            raise CommandError(
                f"'{name}' has not been seeded. Run "
                f"`manage.py seed_questions --institute {opts['institute']}` first."
            )

        data = analyse(institute, paper, SIGNATURES)
        if not render(self, data, SIGNATURES, paper):
            raise SystemExit(1)
