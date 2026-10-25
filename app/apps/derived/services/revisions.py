"""The revision scheduler — R1, R2, R3 for every chapter a student has met.

    from apps.derived.services.revisions import schedule_revisions
    schedule_revisions(institute_id)                         # nightly
    schedule_revisions(institute_id, [student.id], topic_ids=[topic.id])   # a hook

Until this existed, `RevisionEvent` rows came only from the seeder: the
concept note promised spaced revision and nothing scheduled any. This is
the engine. It writes rows and never touches one it did not just create.

THE RULES
    1. **First exposure** to a chapter is the earliest of three dates: the
       student's first `StudyLog` on it, their first `Attempt` on it, or the
       day their batch was taught it (`ChapterStatus.taught_at`). Only dates
       on or before `today` count — a chapter is not met in the future.
    2. **Cycle 1** is due the day after first exposure.
    3. **Cycle n+1** is scheduled only once cycle n is done, at the day it
       was done plus that cycle's interval. A revision nobody did is not
       followed by another one: the backlog is the signal (`revision_debt`,
       the `revision_overdue` detector), and stacking R2 on an undone R1
       would bury it.
    4. **Three cycles at most**: R1 +1 day, R2 +7 days, R3 +30 days.

    The intervals are a deliberate simplification of the SuperMemo SM-2 /
    FSRS lineage, where each successful review multiplies the gap before
    the next. Those schedulers fit the multiplier per item from graded
    recall; we have no graded recall yet (a revision is "done", not "done
    and remembered 4/5"), so the gaps are fixed constants that roughly
    follow the same geometric growth. They are named below so a fitted
    schedule can replace them without anyone hunting for magic numbers.

DEADLINE-AWARE, BECAUSE THE EXAM DOES NOT MOVE
    A revision is never scheduled after the batch's `exam_date`. If an
    interval would overshoot, the revision lands on the day before the exam
    instead — a thirty-day R3 for a chapter met three weeks out is better
    done late than never. Once the exam is today or past, nothing is
    scheduled at all. A batch with no `exam_date` has no deadline.

    Two refusals keep that honest: a revision is never put on or before the
    day its anchor happened (exposure, or the previous cycle being done) —
    revising a chapter the same day you met it is not spaced repetition —
    and when the day before the exam leaves no such room, the cycle is
    simply not scheduled.

TWO DECISIONS THE BRIEF DID NOT MAKE, MADE HERE
    **Nothing is scheduled into the past.** If the ideal date has already
    gone by — the scheduler is running for the first time, or a night was
    missed — the revision is due *today*. A row born overdue would add
    `revision_debt` for a revision the student was never told about; that
    debt is the scheduler's, not theirs.

    **A first exposure older than `FIRST_CYCLE_GRACE_DAYS` gets no R1.**
    Rule 1 counts the batch's `taught_at`, so on its first run over real
    data every chapter taught since the start of term is "first met" months
    ago. Scheduling all of those today would hand every student forty
    revisions due at once and a debt flag the next morning. An R1 is "look
    at it again tomorrow"; three weeks later it is not that any more. Older
    chapters are the forgetting model's job instead: `TopicState.retention`
    decays, and the planner turns low retention into a revise block.

APPEND-ONLY AND IDEMPOTENT
    A (student, chapter, cycle) is never written twice and an existing row
    is never modified — the `RevisionEvent` table is an event log, and the
    only change it permits is a student marking a revision done
    (`my_views.RevisionViewSet.complete`). Running this twice writes
    nothing the second time; for a given `today` and a given event log the
    output is fully determined.

    `RevisionEvent` has no unique constraint on (student, topic, cycle), so
    the guarantee is made here: the students in scope are locked
    (`SELECT … FOR UPDATE`, in id order) for the read-decide-write, so the
    nightly run and a student's own "done" hook cannot both decide to write
    the same next cycle.

RLS
    Like `features`, this does not manage the tenant scope; the caller does
    (`run_nightly` and the `schedule_revisions` command wrap each institute
    in `tenant_scope`, the request path is scoped by middleware). Every
    query also filters `institute_id` explicitly.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
from collections import defaultdict
from collections.abc import Iterable, Mapping

from django.db import transaction
from django.db.models import Min
from django.utils import timezone

from apps.events.models import Attempt, ChapterStatus, RevisionEvent, StudyLog
from apps.tenancy.models import Batch, Student

# ------------------------------------------------------------------ tuning

#: Days from the anchor (first exposure for R1, the previous cycle's done
#: day after that) to each cycle. See the module docstring for the lineage.
INTERVAL_DAYS: dict[int, int] = {1: 1, 2: 7, 3: 30}

#: The last cycle scheduled. After R3 a chapter is on its own.
MAX_CYCLES = 3

#: How old a first exposure may be and still earn an R1. A week: R1 is
#: "tomorrow", and a week late is the most a "tomorrow" can stretch to.
FIRST_CYCLE_GRACE_DAYS = 7

#: Students per pass; bounds the aggregate queries like `features` does.
STUDENT_CHUNK = 250

# Decision outcomes. Strings, so the counts dict is readable as JSON.
SCHEDULED = "scheduled"
CAPPED = "capped_at_exam"
PENDING = "pending"
COMPLETE = "complete"
STALE = "stale_exposure"
NO_EXPOSURE = "no_exposure"
NO_TIME = "no_time_before_exam"


# ------------------------------------------------------------- pure rules


@dataclasses.dataclass(frozen=True)
class ChapterHistory:
    """Everything the rules need about one (student, chapter)."""

    #: Local date of first exposure on or before `today`, or None.
    first_exposure: dt.date | None
    #: cycle -> local date it was done, or None while it is still pending.
    cycles: Mapping[int, dt.date | None] = dataclasses.field(default_factory=dict)


@dataclasses.dataclass(frozen=True)
class Decision:
    outcome: str
    cycle: int | None = None
    scheduled_for: dt.date | None = None

    @property
    def writes(self) -> bool:
        return self.outcome in (SCHEDULED, CAPPED)


def deadline_aware_date(
    ideal: dt.date, *, anchor: dt.date, today: dt.date, exam_date: dt.date | None
) -> tuple[dt.date | None, bool]:
    """When a revision ideally due on `ideal` should actually be scheduled.

    Returns `(date, capped)`, or `(None, False)` when no day qualifies.
    `capped` is True when the exam pulled the date earlier.
    """
    when = max(ideal, today)              # never into the past
    capped = False
    if exam_date is not None:
        last_day = exam_date - dt.timedelta(days=1)
        if when > last_day:
            when, capped = last_day, True
        if when < today:                  # the exam is today or over
            return None, False
    if when <= anchor:                    # no room left for a *spaced* revision
        return None, False
    return when, capped


def next_revision(
    history: ChapterHistory, *, today: dt.date, exam_date: dt.date | None
) -> Decision:
    """The one cycle (if any) to schedule next for this chapter. Pure."""
    if history.cycles:
        top = max(history.cycles)
        done_on = history.cycles[top]
        if done_on is None:
            return Decision(PENDING, top)
        if top >= MAX_CYCLES:
            return Decision(COMPLETE, top)
        cycle, anchor = top + 1, done_on
    else:
        if history.first_exposure is None:
            return Decision(NO_EXPOSURE)
        if (today - history.first_exposure).days > FIRST_CYCLE_GRACE_DAYS:
            return Decision(STALE, 1)
        cycle, anchor = 1, history.first_exposure

    ideal = anchor + dt.timedelta(days=INTERVAL_DAYS[cycle])
    when, capped = deadline_aware_date(ideal, anchor=anchor, today=today, exam_date=exam_date)
    if when is None:
        return Decision(NO_TIME, cycle)
    return Decision(CAPPED if capped else SCHEDULED, cycle, when)


# ----------------------------------------------------- reading the database


def _local_date(ts: dt.datetime) -> dt.date:
    return timezone.localtime(ts).date()


def _empty_counts() -> dict:
    return {
        "students": 0,
        "created": 0,
        "by_cycle": {str(c): 0 for c in range(1, MAX_CYCLES + 1)},
        CAPPED: 0,
        NO_TIME: 0,
        STALE: 0,
        PENDING: 0,
        COMPLETE: 0,
    }


def _chunks(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def schedule_revisions(
    institute_id: int,
    student_ids: Iterable[int] | None = None,
    today: dt.date | None = None,
    *,
    topic_ids: Iterable[int] | None = None,
) -> dict:
    """Write the next due revision cycle for every chapter that has earned one.

    `student_ids` narrows to some students (default: every active student
    of the institute — a student who has left is not scheduled). `topic_ids`
    narrows to some chapters, which is what the request hooks use so that
    logging one chapter schedules that chapter and nothing else. `today`
    defaults to the server's local date and is the only clock read.

    Returns counts (JSON-safe): `students` considered, `created` rows,
    `by_cycle`, and how many chapters were held back and why —
    `capped_at_exam` (written, but pulled to the day before the exam),
    `no_time_before_exam`, `stale_exposure`, `pending` (waiting on an undone
    cycle) and `complete` (R3 written already).
    """
    today = today or timezone.localdate()
    counts = _empty_counts()
    topics = list(topic_ids) if topic_ids is not None else None

    with transaction.atomic():
        students_qs = Student.objects.filter(institute_id=institute_id, exited_at__isnull=True)
        if student_ids is not None:
            students_qs = students_qs.filter(id__in=list(student_ids))
        # Locked for the read-decide-write: see "APPEND-ONLY AND IDEMPOTENT".
        students = list(
            students_qs.select_for_update().order_by("id").values_list("id", "batch_id")
        )
        counts["students"] = len(students)
        if not students:
            return counts

        exam_dates = dict(
            Batch.objects.filter(
                institute_id=institute_id, id__in={b for _, b in students}
            ).values_list("id", "exam_date")
        )
        rows: list[RevisionEvent] = []
        for chunk in _chunks(students, STUDENT_CHUNK):
            rows.extend(_chunk(institute_id, chunk, exam_dates, today, topics, counts))
        RevisionEvent.objects.bulk_create(rows, batch_size=2000)

    counts["created"] = len(rows)
    return counts


def _chunk(
    institute_id: int,
    students: list[tuple[int, int]],
    exam_dates: dict[int, dt.date | None],
    today: dt.date,
    topics: list[int] | None,
    counts: dict,
) -> list[RevisionEvent]:
    ids = [sid for sid, _ in students]
    batch_of = dict(students)

    def scoped(qs):
        qs = qs.filter(institute_id=institute_id)
        return qs.filter(topic_id__in=topics) if topics is not None else qs

    # 1. First exposure — earliest of the three sources, on or before today.
    exposure: dict[tuple[int, int], dt.date] = {}

    def offer(key: tuple[int, int], day: dt.date | None) -> None:
        if day is not None and day <= today and (key not in exposure or day < exposure[key]):
            exposure[key] = day

    for model in (StudyLog, Attempt):
        for r in (
            scoped(model.objects.filter(student_id__in=ids))
            .values("student_id", "topic_id")
            .annotate(first=Min("ts"))
        ):
            offer((r["student_id"], r["topic_id"]), _local_date(r["first"]))

    taught_by_batch: dict[int, list[tuple[int, dt.date]]] = defaultdict(list)
    for batch_id, topic_id, taught_at in scoped(
        ChapterStatus.objects.filter(batch_id__in=set(batch_of.values()), taught_at__isnull=False)
    ).values_list("batch_id", "topic_id", "taught_at"):
        taught_by_batch[batch_id].append((topic_id, taught_at))
    for sid in ids:
        for topic_id, taught_at in taught_by_batch.get(batch_of[sid], []):
            offer((sid, topic_id), taught_at)

    # 2. What is already scheduled. A cycle counts as done once any row of it
    #    is done (the seeder never duplicates a cycle; nothing else writes).
    cycles: dict[tuple[int, int], dict[int, dt.date | None]] = defaultdict(dict)
    for sid, topic_id, cycle, done_at in scoped(
        RevisionEvent.objects.filter(student_id__in=ids)
    ).values_list("student_id", "topic_id", "cycle", "done_at"):
        done_on = _local_date(done_at) if done_at is not None else None
        seen = cycles[(sid, topic_id)]
        if cycle not in seen or (done_on is not None and (seen[cycle] is None or done_on > seen[cycle])):
            seen[cycle] = done_on

    # 3. Decide, in a fixed order so the output is reproducible row for row.
    out: list[RevisionEvent] = []
    for key in sorted(set(exposure) | set(cycles)):
        sid, topic_id = key
        decision = next_revision(
            ChapterHistory(exposure.get(key), cycles.get(key, {})),
            today=today,
            exam_date=exam_dates.get(batch_of[sid]),
        )
        if decision.outcome in counts:
            counts[decision.outcome] += 1
        if not decision.writes:
            continue
        counts["by_cycle"][str(decision.cycle)] += 1
        out.append(
            RevisionEvent(
                institute_id=institute_id,
                student_id=sid,
                topic_id=topic_id,
                cycle=decision.cycle,
                scheduled_for=decision.scheduled_for,
            )
        )
    return out
