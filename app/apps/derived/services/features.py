"""The feature store — rung-0 mastery and the per-student rollup.

    recompute_topic_state(institute_id, student_ids=None, as_of=None)
    recompute_student_state(institute_id, student_ids=None, as_of=None)
    recompute(institute_id, ...)            # both, in the right order

WHAT RUNG 0 IS
    Time-decayed rolling accuracy over the last `MASTERY_WINDOW` *attempted*
    questions per (student, topic). No ML library, no training. Rungs 1-3
    (BKT -> IRT -> DKT) come later and only when a held-out AUC comparison
    shows this one failing — see TECHNICAL_DOC.md §6.1.

    The shape is the window function from SYSTEM_DESIGN.md §4 with decay
    weighting on top:

        mastery = Σ(wᵢ · correctᵢ) / Σ(wᵢ)
        wᵢ      = 0.5 ** (age_daysᵢ / MASTERY_HALF_LIFE_DAYS)

TWO DECISIONS WORTH THE PARAGRAPHS THEY COST

1.  **`mastery` is null below the evidence floor.** Four attempted
    questions is the minimum. Below it we store None rather than a
    confident-looking 0.33 from three data points — a mentor shown "33%
    mastery" will act on it, and acting on three questions is worse than
    acting on nothing. `attempts_n` is always populated, so the UI can say
    "not enough data yet" instead of guessing.

2.  **Decay is anchored to the pair's own newest attempt, not to the wall
    clock.** This is the non-obvious one. Anchoring decay to `now()` would
    make a student's mastery erode while they sleep, which sounds
    reasonable until you notice it breaks the invariant the whole
    `derived/` app exists to protect: replaying the event log must
    reproduce the same numbers. With a wall-clock anchor, a rebuild run on
    Tuesday disagrees with the same rebuild run on Wednesday from
    identical events, and the rebuild-equivalence test (TECHNICAL_DOC.md
    §14) can only be written as an approximation.

    Forgetting over calendar time is a real effect — it belongs in
    `retention`, which is explicitly a forecast and explicitly allowed to
    depend on today's date. `mastery` answers "how well did they perform,
    weighted toward their more recent performance"; `retention` answers
    "what would they recall today". Two questions, two fields.

IDEMPOTENCE
    Every function here is an upsert plus a scoped delete of rows whose
    source events no longer exist. Running twice changes nothing but
    `computed_at`. Running after deleting all of `derived/` reproduces it.

    Anything that genuinely depends on the current date takes it from the
    `as_of` argument, which defaults to `timezone.now()`. Pass a fixed
    `as_of` and the output is byte-identical across runs — that is the hook
    the rebuild-equivalence test needs.

RLS
    These functions do not manage the tenant scope themselves; the caller
    decides. `recompute_features` wraps each institute in `tenant_scope()`
    so a bug cannot cross a tenant boundary. Every query here also filters
    `institute_id` explicitly, for the same reason `TenantScopedMixin`
    exists: the intent should be visible where developers read.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import logging
from collections import defaultdict

from django.db import connection, transaction
from django.db.models import Count, Max, Q, Sum
from django.utils import timezone

from apps.derived.models import StudentState, TopicState
from apps.events.models import (
    Attempt,
    ChapterStatus,
    ConfidenceRating,
    RevisionEvent,
    StudyLog,
)
from apps.ingestion.models import TestPaper
from apps.syllabus.models import Topic
from apps.tenancy.models import Student

logger = logging.getLogger(__name__)

# ------------------------------------------------------------------ tuning
#
# Every constant here is a product decision, so each one is named and
# commented rather than inlined. Changing one changes what mentors see, and
# `FEATURE_VERSION` is how we tell which rules produced a stored row.

FEATURE_VERSION = "rung0-v1"

#: Attempts considered for mastery, newest first. Matches the
#: `ROWS BETWEEN 19 PRECEDING AND CURRENT ROW` in SYSTEM_DESIGN.md §4.
MASTERY_WINDOW = 20

#: An attempt this many days older than the newest one in the window counts
#: half as much. Mocks in this product run a fortnight apart, so 30 days
#: means the last two mocks carry most of the weight while the term still
#: contributes.
MASTERY_HALF_LIFE_DAYS = 30.0

#: Below this many *attempted* questions, `mastery` is None. See the module
#: docstring — this is the single most important number in the file.
EVIDENCE_FLOOR = 4

#: `accuracy_30d` is an **internal diagnostic only** as of v0.3 — still
#: computed, still stored, still on the admin, and no longer in the
#: published API contract (see `api.serializers.TopicStateSerializer`).
#:
#: The floor stays at 3 rather than being raised to `EVIDENCE_FLOOR`
#: precisely because it is no longer shown to a mentor. Raising it would
#: have halved an internal signal (490 -> 253 populated pairs on the
#: seeded data) while still leaving 45% of the survivors at exactly 0 or
#: exactly 1, since four questions can only produce {0, ¼, ½, ¾, 1}. The
#: defect was never the constant; it was publishing a wall-clock-anchored
#: raw percentage next to `mastery`, which answers the same question with
#: a window, a decay and a defensible floor.
RECENT_WINDOW_DAYS = 30
RECENT_FLOOR = 3

#: Windows for the per-student rollup.
CONSISTENCY_WINDOW_DAYS = 60
LOAD_WINDOW_DAYS = 28

#: Students processed per pass. Bounds memory on the one query that is
#: O(attempts) rather than O(pairs); at 20M attempts the unchunked form
#: would be a bad afternoon.
STUDENT_CHUNK = 250

SUBJECT_ORDER = ["Physics", "Chemistry", "Maths"]


@dataclasses.dataclass
class RecomputeStats:
    """What a recompute did. Printed by the command, asserted by tests."""

    institute_id: int
    students: int = 0
    rows_written: int = 0
    rows_deleted: int = 0
    mastery_reported: int = 0
    mastery_withheld: int = 0

    def merge(self, other: "RecomputeStats") -> "RecomputeStats":
        return RecomputeStats(
            institute_id=self.institute_id,
            students=max(self.students, other.students),
            rows_written=self.rows_written + other.rows_written,
            rows_deleted=self.rows_deleted + other.rows_deleted,
            mastery_reported=self.mastery_reported + other.mastery_reported,
            mastery_withheld=self.mastery_withheld + other.mastery_withheld,
        )


# --------------------------------------------------------------- helpers


def _chunks(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _student_ids(institute_id: int, student_ids=None) -> list[int]:
    qs = Student.objects.filter(institute_id=institute_id)
    if student_ids is not None:
        qs = qs.filter(id__in=list(student_ids))
    return list(qs.order_by("id").values_list("id", flat=True))


def _resolve_as_of(as_of) -> dt.datetime:
    return as_of or timezone.now()


def subject_map(institute_id: int) -> dict[int, str]:
    """topic_id -> subject name, for every topic in this institute's trees.

    Two LEFT JOINs rather than a recursive CTE: the tree is exactly three
    levels deep and enforced so by `Topic.KIND`, which is the finding that
    closed SYSTEM_DESIGN.md §8 Q1. One query, cached by the caller.
    """
    out: dict[int, str] = {}
    rows = Topic.objects.filter(syllabus__institute_id=institute_id).values_list(
        "id", "kind", "name", "parent__name", "parent__parent__name"
    )
    for tid, kind, name, parent, grandparent in rows:
        if kind == Topic.SUBJECT:
            out[tid] = name
        elif kind == Topic.UNIT:
            out[tid] = parent or name
        else:
            out[tid] = grandparent or parent or name
    return out


def marking_scheme(institute_id: int) -> tuple[float, float]:
    """(marks for a correct answer, marks for a wrong one) — the latter negative.

    Read off the institute's most recent paper rather than hardcoded at 4
    and -1. JEE Main is +4/-1, NEET is +4/-1, but institute mocks are not
    always either, and a marks-lost figure computed on the wrong scheme is
    wrong in a way nobody notices because it still looks like marks.
    """
    row = (
        TestPaper.objects.filter(institute_id=institute_id)
        .order_by("-held_on")
        .values("marks_correct", "marks_wrong")
        .first()
    )
    if not row:
        return 4.0, -1.0
    return float(row["marks_correct"]), float(row["marks_wrong"])


def marks_lost_by_topic(
    institute_id: int,
    student_ids: list[int],
    scheme: tuple[float, float] | None = None,
) -> dict[int, dict[int, float]]:
    """student_id -> {topic_id: marks lost}. The single definition of "lost".

    A wrong answer costs the mark you did not get **plus** the negative
    marking penalty; a blank or an unreached question costs only the
    former. Counting lost *questions* instead — which is what the original
    `subject_breakdown` endpoint did while calling the result
    `marks_lost_share_pct` — prices a wrong answer and a skip identically,
    and so understates exactly the subject a student is guessing their way
    through.

    `weak_topic`, `subject_imbalance` and the student-detail chart all read
    this, because a flag that disagrees with the chart it points at is
    worse than no flag at all.

    THE HORIZON, WHICH CALLERS MUST PUBLISH
        This is **cumulative over every paper the student has sat** — not
        a window — and that is deliberate. A cost is a total: a chapter
        that cost 40 marks across three mocks and has been avoided since
        is still 40 marks gone, and a windowed version would price it at
        zero exactly when a mentor most needs to see it. `mastery`
        answers "do they know it now", which is a level and is rightly
        recency-weighted; this answers "what has it cost", which is a
        sum. Two questions, two horizons, both correct.

        What is *not* correct is printing the two side by side without
        saying so, which is what `weak_topic`'s headline used to do:
        "32% over 11 attempts, costing 42 marks" reads as one period and
        is two. So every caller that shows this number to a human must
        also show the span it covers — `weak_topic` carries
        `papers_covered` / `first_paper` / `last_paper` in its evidence
        and says "across N mocks" in the headline for exactly that
        reason.

        There is no `since=` argument here on purpose. Matching
        `mastery`'s horizon is not possible: mastery's window is the last
        20 *attempted* questions **per (student, topic) pair**, decayed
        against that pair's own newest attempt rather than the wall clock
        (see decision 2 in the module docstring). Different chapters for
        the same student therefore span different date ranges, and no
        single cutoff date reproduces it. A `since` defaulted to some
        stand-in month would be an approximation presented as the
        matching quantity — the same class of mistake as the one being
        fixed, dressed as its solution.

    OPEN QUESTION, DELIBERATELY NOT DECIDED HERE
        This counts **every** attempt, including `source='practice'` rows
        that belong to no `TestPaper`. Whether a practice question can
        cost "marks" at all is a real product question — it has no
        marking scheme of its own, and pricing it at the mock's +4/-1 is
        an assumption — but today every recorded attempt is mock-sourced,
        so the question is not yet forced, and answering it by quietly
        changing this filter would move `balance_index`, `risk_score`,
        two detectors and the neglect chart at once. It belongs in its
        own change, with its own before/after.

        Until then, callers should read `papers_covered` as the *period*
        the figure spans, not as an assertion that every mark in it came
        off a mock paper.
    """
    correct_marks, wrong_marks = scheme or marking_scheme(institute_id)
    wrong_cost = correct_marks + abs(wrong_marks)
    skip_cost = correct_marks

    out: dict[int, dict[int, float]] = defaultdict(dict)
    for r in (
        Attempt.objects.filter(institute_id=institute_id, student_id__in=student_ids)
        .exclude(status=Attempt.CORRECT)
        .values("student_id", "topic_id")
        .annotate(
            wrong=Count("id", filter=Q(status=Attempt.WRONG)),
            unattempted=Count(
                "id", filter=Q(status__in=[Attempt.BLANK, Attempt.NOT_REACHED])
            ),
        )
    ):
        out[r["student_id"]][r["topic_id"]] = (
            r["wrong"] * wrong_cost + r["unattempted"] * skip_cost
        )
    return dict(out)


def marks_lost_by_subject(
    by_topic: dict[int, dict[int, float]], subjects: dict[int, str]
) -> dict[int, dict[str, float]]:
    """Fold `marks_lost_by_topic` up to subject level."""
    out: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for sid, topics in by_topic.items():
        for topic_id, marks in topics.items():
            subject = subjects.get(topic_id)
            if subject:
                out[sid][subject] += marks
    return {sid: dict(v) for sid, v in out.items()}


def study_minutes_by_subject(
    institute_id: int, student_ids: list[int], subjects: dict[int, str]
) -> dict[int, dict[str, int]]:
    """student_id -> {subject: minutes logged}."""
    out: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for r in (
        StudyLog.objects.filter(institute_id=institute_id, student_id__in=student_ids)
        .values("student_id", "topic_id")
        .annotate(m=Sum("minutes"))
    ):
        subject = subjects.get(r["topic_id"])
        if subject:
            out[r["student_id"]][subject] += r["m"] or 0
    return {sid: dict(v) for sid, v in out.items()}


def unit_map(institute_id: int) -> dict[int, str]:
    """topic_id -> the unit it sits under (chapters), or its own name."""
    out: dict[int, str] = {}
    for tid, kind, name, parent in Topic.objects.filter(
        syllabus__institute_id=institute_id
    ).values_list("id", "kind", "name", "parent__name"):
        out[tid] = parent if kind == Topic.CHAPTER and parent else name
    return out


# ------------------------------------------------------- rung-0 mastery


def _mastery_window_rows(institute_id: int, student_ids: list[int]):
    """The newest `MASTERY_WINDOW` attempted rows per (student, topic).

    Raw SQL on purpose. The cap has to be applied server-side or this
    becomes "fetch every attempt the institute ever recorded and throw
    most of them away" — exactly the shape the DB agent measured as the
    dashboard's problem. `ROW_NUMBER()` caps the transfer at
    pairs x 20 rows no matter how long the history gets.

    Ordering is `ts DESC, id DESC`: the seed writes a whole paper at one
    timestamp, so `ts` alone leaves ties, and ties make the window
    non-deterministic — which would quietly break idempotence.
    """
    sql = """
        SELECT student_id, topic_id, ts, status
        FROM (
            SELECT a.student_id, a.topic_id, a.ts, a.status,
                   ROW_NUMBER() OVER (
                       PARTITION BY a.student_id, a.topic_id
                       ORDER BY a.ts DESC, a.id DESC
                   ) AS rn
            FROM events_attempt a
            WHERE a.institute_id = %s
              AND a.student_id = ANY(%s)
              AND a.status IN ('correct', 'wrong')
        ) w
        WHERE rn <= %s
        ORDER BY student_id, topic_id, ts DESC
    """
    with connection.cursor() as cur:
        cur.execute(sql, [institute_id, list(student_ids), MASTERY_WINDOW])
        return cur.fetchall()


def _decayed_accuracy(rows: list[tuple[dt.datetime, str]]) -> float | None:
    """Time-decayed accuracy over one pair's window. `rows` is newest-first.

    Returns None below the evidence floor. Note the floor is counted on the
    window, not on lifetime attempts — a student with 40 attempts still has
    at most `MASTERY_WINDOW` of them informing this number, and we would
    rather the floor describe the evidence actually used.
    """
    if len(rows) < EVIDENCE_FLOOR:
        return None
    anchor = rows[0][0]
    num = den = 0.0
    for ts, status in rows:
        age_days = (anchor - ts).total_seconds() / 86400.0
        w = 0.5 ** (age_days / MASTERY_HALF_LIFE_DAYS)
        den += w
        if status == Attempt.CORRECT:
            num += w
    if den == 0:
        return None
    return round(num / den, 4)


def recompute_topic_state(
    institute_id: int, student_ids=None, as_of=None
) -> RecomputeStats:
    """Rebuild `TopicState` for an institute (or a subset of its students).

    Idempotent: upserts on (student, topic) and deletes rows in scope that
    no longer have a source event. Safe to run on every ingest and again
    nightly.
    """
    as_of = _resolve_as_of(as_of)
    ids = _student_ids(institute_id, student_ids)
    stats = RecomputeStats(institute_id=institute_id, students=len(ids))
    if not ids:
        return stats

    for chunk in _chunks(ids, STUDENT_CHUNK):
        stats = stats.merge(_topic_state_chunk(institute_id, chunk, as_of))
    return stats


def _topic_state_chunk(
    institute_id: int, ids: list[int], as_of: dt.datetime
) -> RecomputeStats:
    stats = RecomputeStats(institute_id=institute_id, students=len(ids))
    recent_cutoff = as_of - dt.timedelta(days=RECENT_WINDOW_DAYS)

    # 1. The mastery window, capped server-side.
    windows: dict[tuple[int, int], list[tuple[dt.datetime, str]]] = defaultdict(list)
    for student_id, topic_id, ts, status in _mastery_window_rows(institute_id, ids):
        windows[(student_id, topic_id)].append((ts, status))

    # 2. Lifetime counters and the recent slice, one aggregate each.
    lifetime: dict[tuple[int, int], dict] = {}
    for r in (
        Attempt.objects.filter(institute_id=institute_id, student_id__in=ids)
        .values("student_id", "topic_id")
        .annotate(
            n=Count("id", filter=Q(status__in=[Attempt.CORRECT, Attempt.WRONG])),
            correct=Count("id", filter=Q(status=Attempt.CORRECT)),
            last=Max("ts"),
            time_sum=Sum("time_spent"),
            time_n=Count("time_spent"),
            recent_n=Count(
                "id",
                filter=Q(
                    status__in=[Attempt.CORRECT, Attempt.WRONG], ts__gte=recent_cutoff
                ),
            ),
            recent_correct=Count(
                "id", filter=Q(status=Attempt.CORRECT, ts__gte=recent_cutoff)
            ),
        )
    ):
        lifetime[(r["student_id"], r["topic_id"])] = r

    # 3. Side channels. Each is a pair -> scalar dict; all are optional, and
    #    a pair can exist because of any one of them. A student who logs
    #    forty minutes on a chapter and never practises it is a real and
    #    interesting state, so the union is the right key set, not attempts.
    exposure = {
        (r["student_id"], r["topic_id"]): r["mins"] or 0
        for r in StudyLog.objects.filter(institute_id=institute_id, student_id__in=ids)
        .values("student_id", "topic_id")
        .annotate(mins=Sum("minutes"))
    }
    revised = {
        (r["student_id"], r["topic_id"]): r["last"]
        for r in RevisionEvent.objects.filter(
            institute_id=institute_id, student_id__in=ids, done_at__isnull=False
        )
        .values("student_id", "topic_id")
        .annotate(last=Max("done_at"))
    }
    # Latest rating by timestamp, not the highest one. `Max("self_rating")`
    # would report a student's most optimistic historical answer, which is
    # precisely backwards for a detector looking for overconfidence.
    ratings: dict[tuple[int, int], int] = {}
    for student_id, topic_id, rating in (
        ConfidenceRating.objects.filter(institute_id=institute_id, student_id__in=ids)
        .order_by("student_id", "topic_id", "ts", "id")
        .values_list("student_id", "topic_id", "self_rating")
    ):
        ratings[(student_id, topic_id)] = rating  # ascending ts, last wins

    keys = set(lifetime) | set(exposure) | set(revised) | set(ratings)

    rows: list[TopicState] = []
    for key in sorted(keys):
        student_id, topic_id = key
        agg = lifetime.get(key) or {}
        window = windows.get(key, [])
        mastery = _decayed_accuracy(window)

        recent_n = agg.get("recent_n") or 0
        recent_correct = agg.get("recent_correct") or 0
        accuracy_30d = (
            round(recent_correct / recent_n, 4) if recent_n >= RECENT_FLOOR else None
        )
        time_n = agg.get("time_n") or 0
        avg_time = round((agg.get("time_sum") or 0) / time_n, 1) if time_n else None

        if mastery is None:
            stats.mastery_withheld += 1
        else:
            stats.mastery_reported += 1

        rows.append(
            TopicState(
                institute_id=institute_id,
                student_id=student_id,
                topic_id=topic_id,
                mastery=mastery,
                # Rung 0 has no retention model. TECHNICAL_DOC.md §6.2 is
                # explicit that exam-deadline FSRS is research, not an
                # install, so this stays null rather than becoming a
                # decorative number nobody can defend.
                retention=None,
                attempts_n=agg.get("n") or 0,
                correct_n=agg.get("correct") or 0,
                accuracy_30d=accuracy_30d,
                exposure_min=exposure.get(key, 0),
                avg_time_spent=avg_time,
                self_rating=ratings.get(key),
                last_seen=agg.get("last"),
                last_revised=revised.get(key),
            )
        )

    with transaction.atomic():
        TopicState.objects.bulk_create(
            rows,
            batch_size=2000,
            update_conflicts=True,
            unique_fields=["student", "topic"],
            update_fields=[
                "institute",
                "mastery",
                "retention",
                "attempts_n",
                "correct_n",
                "accuracy_30d",
                "exposure_min",
                "avg_time_spent",
                "self_rating",
                "last_seen",
                "last_revised",
                "computed_at",
            ],
        )
        # Anything still standing in scope has no source event left. In an
        # append-only world that is only reachable via a syllabus edit or a
        # rolled-back ingest, but "derived state is disposable" has to mean
        # disposable in both directions or a rebuild is not a rebuild.
        #
        # Compared by key, not by a `computed_at` timestamp heuristic: two
        # recomputes inside the same clock tick would make a timestamp
        # filter delete rows it had just written.
        doomed = [
            row_id
            for row_id, s_id, t_id in TopicState.objects.filter(
                institute_id=institute_id, student_id__in=ids
            ).values_list("id", "student_id", "topic_id")
            if (s_id, t_id) not in keys
        ]
        if doomed:
            stats.rows_deleted += TopicState.objects.filter(id__in=doomed).delete()[0]

    stats.rows_written += len(rows)
    return stats


# ------------------------------------------------------ per-student state


def _linear_slope(ys: list[float]) -> float:
    """OLS slope of `ys` against 0..n-1. Used for trends over mock papers."""
    n = len(ys)
    if n < 2:
        return 0.0
    mean_x = (n - 1) / 2
    mean_y = sum(ys) / n
    sxy = sum((i - mean_x) * (y - mean_y) for i, y in enumerate(ys))
    sxx = sum((i - mean_x) ** 2 for i in range(n))
    return sxy / sxx if sxx else 0.0


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def paper_totals(institute_id: int, student_ids: list[int]) -> dict[int, list[tuple]]:
    """student_id -> [(held_on, paper_id, marks, attempted, correct), ...] oldest first."""
    out: dict[int, list[tuple]] = defaultdict(list)
    rows = (
        Attempt.objects.filter(
            institute_id=institute_id,
            student_id__in=student_ids,
            test_paper__isnull=False,
        )
        .values("student_id", "test_paper_id", "test_paper__held_on")
        .annotate(
            marks=Sum("marks"),
            attempted=Count("id", filter=Q(status__in=[Attempt.CORRECT, Attempt.WRONG])),
            correct=Count("id", filter=Q(status=Attempt.CORRECT)),
            total_q=Count("id"),
        )
        .order_by("student_id", "test_paper__held_on")
    )
    for r in rows:
        out[r["student_id"]].append(
            (
                r["test_paper__held_on"],
                r["test_paper_id"],
                float(r["marks"] or 0),
                r["attempted"],
                r["correct"],
                r["total_q"],
            )
        )
    return out


def study_minutes_by_day(
    institute_id: int, student_ids: list[int], since: dt.datetime
) -> dict[int, dict[dt.date, int]]:
    out: dict[int, dict[dt.date, int]] = defaultdict(dict)
    for r in (
        StudyLog.objects.filter(
            institute_id=institute_id, student_id__in=student_ids, ts__gte=since
        )
        .values("student_id", "ts__date")
        .annotate(m=Sum("minutes"))
    ):
        out[r["student_id"]][r["ts__date"]] = r["m"] or 0
    return out


def study_intensity(
    day_map: dict[dt.date, int], today: dt.date, window: int = LOAD_WINDOW_DAYS
) -> tuple[float, float]:
    """Mean minutes per *logged* day, this window and the one before it.

    Per logged day, not per calendar day, and the distinction matters. A
    calendar-day denominator conflates two different things — working
    longer and working more often — and then reports the sum as one
    number. It also reads a truncated window as a slowdown: the seeded
    cohort's logs stop a day or three before `as_of`, and those empty days
    were enough to turn a student whose sessions grew from 308 to 429
    minutes into a `load_index` of 0.95.

    Intensity belongs here because `load_index` feeds `overload`, which is
    specifically "working harder while scoring worse". Frequency is
    `consistency`, and its collapse is `disengagement`. Three signals,
    three fields, no averaging them together.
    """
    cut_recent = today - dt.timedelta(days=window)
    cut_prior = today - dt.timedelta(days=2 * window)
    recent = [m for d, m in day_map.items() if d > cut_recent]
    prior = [m for d, m in day_map.items() if cut_prior < d <= cut_recent]
    mean = lambda xs: sum(xs) / len(xs) if xs else 0.0  # noqa: E731
    return mean(recent), mean(prior)


def recompute_student_state(
    institute_id: int, student_ids=None, as_of=None
) -> RecomputeStats:
    """Rebuild `StudentState` — the per-student rollup the console sorts on.

    Every field here is arithmetic over events. The previous values came
    from the seeder, and one of them (`load_index`) was literally
    `rng.uniform(0.4, 1.0)`; this replaces the lot.
    """
    as_of = _resolve_as_of(as_of)
    ids = _student_ids(institute_id, student_ids)
    stats = RecomputeStats(institute_id=institute_id, students=len(ids))
    if not ids:
        return stats

    for chunk in _chunks(ids, STUDENT_CHUNK):
        stats = stats.merge(_student_state_chunk(institute_id, chunk, as_of))
    return stats


def _student_state_chunk(
    institute_id: int, ids: list[int], as_of: dt.datetime
) -> RecomputeStats:
    stats = RecomputeStats(institute_id=institute_id, students=len(ids))
    today = timezone.localtime(as_of).date()
    subjects = subject_map(institute_id)

    papers = paper_totals(institute_id, ids)
    days = study_minutes_by_day(
        institute_id, ids, as_of - dt.timedelta(days=CONSISTENCY_WINDOW_DAYS)
    )

    debt = {
        r["student_id"]: r["n"]
        for r in RevisionEvent.objects.filter(
            institute_id=institute_id,
            student_id__in=ids,
            done_at__isnull=True,
            scheduled_for__lt=today,
        )
        .values("student_id")
        .annotate(n=Count("id"))
    }

    # Time share vs marks-lost share, by subject — the imbalance signal,
    # and the number on Aarav Mehta's flag. Shared with the detector and
    # the student-detail chart so all three agree.
    time_by = study_minutes_by_subject(institute_id, ids, subjects)
    lost_by = marks_lost_by_subject(marks_lost_by_topic(institute_id, ids), subjects)

    syllabus_pct = _syllabus_progress(institute_id, ids)

    rows: list[StudentState] = []
    for sid in ids:
        seq = papers.get(sid, [])
        marks = [p[2] for p in seq]
        mock_avg = round(sum(marks) / len(marks), 1) if marks else None
        # Last minus first, deliberately, not the OLS slope: it is the
        # number a mentor can check by looking at two score sheets, and it
        # is the "-37 marks over 7 mocks" in the demo narrative.
        mock_trend = round(marks[-1] - marks[0], 1) if len(marks) >= 2 else None

        day_map = days.get(sid, {})
        window_days = CONSISTENCY_WINDOW_DAYS
        consistency = round(_clamp(len(day_map) / window_days), 3) if day_map else None

        recent, prior = study_intensity(day_map, today)
        # A ratio, so 1.0 reads as "steady" and 1.3 as "a third more work
        # than last month". Null when there is no prior month to compare
        # against, which is the honest answer for a new student.
        load_index = round(_clamp(recent / prior, 0.0, 3.0), 3) if prior else None

        t_by, l_by = time_by.get(sid, {}), lost_by.get(sid, {})
        t_tot, l_tot = sum(t_by.values()), sum(l_by.values())
        if t_tot and l_tot:
            balance_index = round(
                max(
                    abs(l_by.get(s, 0) / l_tot - t_by.get(s, 0) / t_tot)
                    for s in SUBJECT_ORDER
                ),
                3,
            )
        else:
            balance_index = None

        revision_debt = debt.get(sid, 0)
        risk = _risk_score(
            mock_trend=mock_trend,
            balance_index=balance_index,
            revision_debt=revision_debt,
            consistency=consistency,
        )

        rows.append(
            StudentState(
                institute_id=institute_id,
                student_id=sid,
                consistency=consistency,
                load_index=load_index,
                balance_index=balance_index,
                revision_debt=revision_debt,
                risk_score=risk,
                mock_avg=mock_avg,
                mock_trend=mock_trend,
                syllabus_pct=syllabus_pct.get(sid),
            )
        )

    with transaction.atomic():
        StudentState.objects.bulk_create(
            rows,
            batch_size=1000,
            update_conflicts=True,
            unique_fields=["student"],
            update_fields=[
                "institute",
                "consistency",
                "load_index",
                "balance_index",
                "revision_debt",
                "risk_score",
                "mock_avg",
                "mock_trend",
                "syllabus_pct",
                "computed_at",
            ],
        )
        keep = set(ids)
        doomed = [
            row_id
            for row_id, sid in StudentState.objects.filter(
                institute_id=institute_id, student_id__in=ids
            ).values_list("id", "student_id")
            if sid not in keep
        ]
        if doomed:
            stats.rows_deleted += StudentState.objects.filter(id__in=doomed).delete()[0]

    stats.rows_written += len(rows)
    return stats


#: Risk weights. Deliberately four terms with round numbers: a director
#: asking "why is this student at 0.71?" gets four addends, not a gradient.
#: These are a prior, not a trained model — the trained version arrives when
#: `Flag.outcome` + `Intervention` have accumulated enough labels
#: (TECHNICAL_DOC.md §7.6), and this is what it will be measured against.
#:
#: `decline` carries half the weight on purpose. It is the only *outcome*
#: in the list — marks actually falling — and the other three are leading
#: indicators that explain it. Weighted evenly, a student in freefall whose
#: effort happens to be well balanced could not reach the console's at-risk
#: threshold no matter how far they fell, which is the wrong failure.
RISK_WEIGHTS = {
    "decline": 0.50,  # score falling across mocks
    "imbalance": 0.20,  # effort pointed at the wrong subject
    "debt": 0.10,  # revision backlog
    "inconsistency": 0.20,  # not showing up
}

#: Scales at which each component saturates. 40 marks of 300 is a serious
#: slide over one term, not a bad morning.
RISK_FULL_DECLINE_MARKS = 40.0
RISK_IMBALANCE_FLOOR = 0.10  # a 10-point gap is normal, not a signal
RISK_IMBALANCE_FULL = 0.40
RISK_FULL_DEBT = 25
RISK_HEALTHY_CONSISTENCY = 0.80


def _risk_score(
    *, mock_trend, balance_index, revision_debt, consistency
) -> float | None:
    """Weighted sum of four normalised components, each explainable alone.

    Returns None when there is nothing to go on at all — an empty risk
    score sorts a new student out of the triage table rather than parking
    them at a confident 0.0.
    """
    parts, weight_seen = 0.0, 0.0

    def add(name: str, value: float | None):
        nonlocal parts, weight_seen
        if value is None:
            return
        w = RISK_WEIGHTS[name]
        parts += w * _clamp(value)
        weight_seen += w

    add("decline", None if mock_trend is None else -mock_trend / RISK_FULL_DECLINE_MARKS)
    add(
        "imbalance",
        None
        if balance_index is None
        else (balance_index - RISK_IMBALANCE_FLOOR)
        / (RISK_IMBALANCE_FULL - RISK_IMBALANCE_FLOOR),
    )
    add("debt", revision_debt / RISK_FULL_DEBT)
    add(
        "inconsistency",
        None if consistency is None else 1 - consistency / RISK_HEALTHY_CONSISTENCY,
    )

    if weight_seen == 0:
        return None
    # Renormalise so a student missing a component is not penalised for the
    # absence of data about them.
    return round(_clamp(parts / weight_seen), 3)


def _syllabus_progress(institute_id: int, ids: list[int]) -> dict[int, float | None]:
    """Share of the batch's chapters marked taught. Batch-level, not student.

    `ChapterStatus` records what faculty covered, which is the only honest
    denominator: a student cannot be behind on a chapter nobody has taught
    yet, and this is also what gates `weak_topic` from firing unfairly.
    """
    batch_of = dict(
        Student.objects.filter(institute_id=institute_id, id__in=ids).values_list(
            "id", "batch_id"
        )
    )
    chapters_per_syllabus = {
        r["syllabus_id"]: r["n"]
        for r in Topic.objects.filter(
            syllabus__institute_id=institute_id, kind=Topic.CHAPTER
        )
        .values("syllabus_id")
        .annotate(n=Count("id"))
    }
    from apps.tenancy.models import Batch

    syllabus_of = dict(
        Batch.objects.filter(institute_id=institute_id).values_list("id", "syllabus_id")
    )
    taught = {
        r["batch_id"]: r["n"]
        for r in ChapterStatus.objects.filter(
            institute_id=institute_id, taught_at__isnull=False
        )
        .values("batch_id")
        .annotate(n=Count("id"))
    }
    out: dict[int, float | None] = {}
    for sid in ids:
        batch_id = batch_of.get(sid)
        total = chapters_per_syllabus.get(syllabus_of.get(batch_id))
        out[sid] = (
            round(taught.get(batch_id, 0) / total * 100, 1) if batch_id and total else None
        )
    return out


# ------------------------------------------------------------------ entry


def recompute(institute_id: int, student_ids=None, as_of=None) -> RecomputeStats:
    """Both passes, in order. `StudentState` reads nothing `TopicState`
    writes today, but the ordering is the contract for when it does."""
    as_of = _resolve_as_of(as_of)
    a = recompute_topic_state(institute_id, student_ids, as_of)
    b = recompute_student_state(institute_id, student_ids, as_of)
    return RecomputeStats(
        institute_id=institute_id,
        students=max(a.students, b.students),
        rows_written=a.rows_written + b.rows_written,
        rows_deleted=a.rows_deleted + b.rows_deleted,
        mastery_reported=a.mastery_reported,
        mastery_withheld=a.mastery_withheld,
    )
