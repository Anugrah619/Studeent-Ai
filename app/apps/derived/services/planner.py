"""The day plan: what to study today, and why — rules, not a model.

THIS IS NOT `plan_week`
    TASKS.md Phase 4 lists `plan_week` as a Gemini reasoning task. This is the
    deterministic version underneath it: three explicit rules over state the
    system already holds, each block carrying the rule that put it there. It
    exists because a plan a student cannot interrogate is a plan they stop
    following (`PlanBlock`'s own docstring), and a rule can be interrogated in
    a way a model's output cannot. When `plan_week` arrives it can reorder and
    word these; it should not need to rediscover them.

THE THREE RULES, IN PRIORITY ORDER
    1. **Revise** — a revision cycle that is due or overdue. Retention decays
       with time, so these go first. At most two a day, most overdue first.
    2. **Practice** — the weakest *taught* chapter(s): measured mastery below
       0.5 (the same line `?weak=true` draws), lowest first, heavier-weighted
       chapters winning ties. At most two. "Taught" means what the `weak_topic`
       detector means by it — `ChapterStatus.taught_at` is set — because a
       plan that tells a student to drill a chapter their class has not
       reached is the same error the detector refuses to make.
    3. **Learn** — a taught chapter the student has never attempted. At most
       one: new material is the first thing to give way to a short day.

    A chapter appears at most once a day, and the plan never exceeds the
    student's own budget: the median of what they actually log on the days
    they log anything (clamped), or a default when there is not yet enough to
    go on. A block that does not fit is dropped, not shrunk — a 45-minute
    practice block squeezed to 20 stops being the thing it said it was.

WHAT IT DOES NOT DO
    No start times. Nothing the system knows says when this student studies,
    and a plan that puts everyone at 17:00 is wrong in a way that looks
    precise. Blocks come back untimed (the console shows "—") until a student
    can say when they study.

REGENERATING NEVER ERASES A TICK
    `replace=True` deletes only blocks the student has not completed.
    `PlanBlock` lives in the derived app, which is "disposable", but a tick is
    a fact the student told us; a regeneration that threw it away would make
    "I finished this" something the system forgets overnight.
"""

from __future__ import annotations

import datetime as dt
import statistics
from collections import defaultdict
from dataclasses import dataclass, field

from django.db import transaction
from django.utils import timezone

from apps.derived.models import PlanBlock, TopicState
from apps.events.models import ChapterStatus, RevisionEvent, StudyLog
from apps.syllabus.services import chapters_for_student
from apps.tenancy.models import Student

LEARN, PRACTICE, REVISE = "learn", "practice", "revise"

MINUTES = {REVISE: 30, PRACTICE: 45, LEARN: 60}
CAPS = {REVISE: 2, PRACTICE: 2, LEARN: 1}

#: Same line as `?weak=true` on the topic-states routes.
WEAK_BELOW = 0.5

DEFAULT_BUDGET = 180
MIN_BUDGET, MAX_BUDGET = 90, 360

#: How many days of logging the budget is read from, and how many of those
#: days must actually have a log before it is trusted over the default. One
#: logged day is an anecdote, not a habit.
BUDGET_WINDOW_DAYS = 14
BUDGET_MIN_DAYS = 3

#: A plan is for today or the coming week; further out, the state it is built
#: from will have moved on.
MAX_DAYS_AHEAD = 7


# ------------------------------------------------------------- pure rules


@dataclass(frozen=True)
class ChapterFact:
    topic_id: int
    name: str
    weight: float
    mastery: float | None            # None below the evidence floor
    attempts: int
    taught_at: dt.date | None


@dataclass(frozen=True)
class RevisionFact:
    topic_id: int
    name: str
    cycle: int
    scheduled_for: dt.date


@dataclass(frozen=True)
class PlanInputs:
    day: dt.date
    budget: int
    chapters: list[ChapterFact]
    revisions: list[RevisionFact]
    #: Chapters already on today's plan as completed blocks, kept through a
    #: regeneration and so not to be planned a second time.
    already_planned: set[int] = field(default_factory=set)


@dataclass(frozen=True)
class BlockSpec:
    topic_id: int
    minutes: int
    mode: str
    reason_code: str
    reason_text: str


def _days(n: int) -> str:
    return f"{n} day" if n == 1 else f"{n} days"


def _revision_reason(r: RevisionFact, day: dt.date) -> str:
    late = (day - r.scheduled_for).days
    return (
        f"Revision {r.cycle} is due today"
        if late <= 0 else f"Revision {r.cycle} was due {_days(late)} ago"
    )


def _learn_reason(c: ChapterFact, day: dt.date) -> str:
    ago = (day - c.taught_at).days
    when = "today" if ago <= 0 else "yesterday" if ago == 1 else f"{ago} days ago"
    return f"Taught in class {when}, and you have not attempted it yet"


def build_plan(inputs: PlanInputs) -> list[BlockSpec]:
    """Today's blocks, in the order to do them. Pure: no database, no clock."""
    day = inputs.day
    taken = set(inputs.already_planned)
    chosen: list[BlockSpec] = []
    used = 0

    def add(spec: BlockSpec) -> bool:
        nonlocal used
        if spec.topic_id in taken or used + spec.minutes > inputs.budget:
            return False
        taken.add(spec.topic_id)
        chosen.append(spec)
        used += spec.minutes
        return True

    # 1 · revise — due or overdue, most overdue first.
    due = sorted(
        (r for r in inputs.revisions if r.scheduled_for <= day),
        key=lambda r: (r.scheduled_for, r.cycle, r.topic_id),
    )
    count = 0
    for r in due:
        if count >= CAPS[REVISE]:
            break
        if add(BlockSpec(r.topic_id, MINUTES[REVISE], REVISE,
                         f"revision_r{r.cycle}", _revision_reason(r, day))):
            count += 1

    taught = [c for c in inputs.chapters if c.taught_at is not None and c.taught_at <= day]

    # 2 · practice — weakest taught chapters with a *measured* mastery.
    weak = sorted(
        (c for c in taught if c.mastery is not None and c.mastery < WEAK_BELOW),
        key=lambda c: (c.mastery, -c.weight, c.name),
    )
    count = 0
    for c in weak:
        if count >= CAPS[PRACTICE]:
            break
        if add(BlockSpec(
            c.topic_id, MINUTES[PRACTICE], PRACTICE, "weak_topic",
            f"One of your weakest chapters: {round(c.mastery * 100)}% over "
            f"{c.attempts} questions",
        )):
            count += 1

    # 3 · learn — taught, never attempted. Earliest taught first.
    fresh = sorted(
        (c for c in taught if c.attempts == 0),
        key=lambda c: (c.taught_at, -c.weight, c.name),
    )
    count = 0
    for c in fresh:
        if count >= CAPS[LEARN]:
            break
        if add(BlockSpec(c.topic_id, MINUTES[LEARN], LEARN, "syllabus", _learn_reason(c, day))):
            count += 1

    return chosen


def budget_from_logs(daily_minutes: list[int]) -> int:
    """The student's own typical day, from the days they logged anything.

    The median, not the mean: one 10-hour Sunday should not turn every
    weekday plan into a marathon. Clamped, because a median of 20 minutes is
    a sign they are not logging, not a prescription to study for 20.
    """
    if len(daily_minutes) < BUDGET_MIN_DAYS:
        return DEFAULT_BUDGET
    return int(min(MAX_BUDGET, max(MIN_BUDGET, statistics.median(daily_minutes))))


# ----------------------------------------------------- reading the database


def _daily_log_minutes(student: Student, day: dt.date) -> list[int]:
    since = timezone.make_aware(
        dt.datetime.combine(day - dt.timedelta(days=BUDGET_WINDOW_DAYS), dt.time.min)
    )
    totals: dict[dt.date, int] = defaultdict(int)
    for ts, minutes in StudyLog.objects.filter(
        student=student, institute_id=student.institute_id, ts__gte=since
    ).values_list("ts", "minutes"):
        totals[timezone.localtime(ts).date()] += minutes
    return [m for d, m in totals.items() if d < day]


def gather_inputs(student: Student, day: dt.date, *, already_planned=frozenset()) -> PlanInputs:
    states = {
        s.topic_id: s
        for s in TopicState.objects.filter(student=student, institute_id=student.institute_id)
    }
    taught = dict(
        ChapterStatus.objects.filter(
            batch_id=student.batch_id, institute_id=student.institute_id, taught_at__isnull=False,
        ).values_list("topic_id", "taught_at")
    )
    chapters = [
        ChapterFact(
            topic_id=t.id, name=t.name, weight=t.weight,
            mastery=getattr(states.get(t.id), "mastery", None),
            attempts=getattr(states.get(t.id), "attempts_n", 0),
            taught_at=taught.get(t.id),
        )
        for t in chapters_for_student(student)
    ]
    revisions = [
        RevisionFact(r.topic_id, r.topic.name, r.cycle, r.scheduled_for)
        for r in RevisionEvent.objects.filter(
            student=student, institute_id=student.institute_id,
            done_at__isnull=True, scheduled_for__lte=day,
        ).select_related("topic")
    ]
    return PlanInputs(
        day=day,
        budget=budget_from_logs(_daily_log_minutes(student, day)),
        chapters=chapters,
        revisions=revisions,
        already_planned=set(already_planned),
    )


@transaction.atomic
def generate_for_student(
    student: Student, day: dt.date, *, replace: bool = False
) -> tuple[list[PlanBlock], bool]:
    """Make this student's plan for `day`. Returns (blocks, whether any were made).

    Idempotent: with a plan already there and `replace` false, the existing
    plan comes back untouched — pressing the button twice is the same as once.
    With `replace`, only blocks not yet completed are rebuilt (see the module
    docstring).

    The student row is locked for the duration. Without it two simultaneous
    requests would both see an empty day and both write a plan, and the
    student would be handed every block twice.
    """
    Student.objects.select_for_update().filter(pk=student.pk).first()

    blocks = PlanBlock.objects.filter(student=student, institute_id=student.institute_id, date=day)
    if blocks.exists() and not replace:
        return list(_ordered(blocks)), False

    if replace:
        blocks.filter(completed=False).delete()
    kept = set(blocks.filter(completed=True).values_list("topic_id", flat=True))

    specs = build_plan(gather_inputs(student, day, already_planned=kept))
    PlanBlock.objects.bulk_create([
        PlanBlock(
            institute_id=student.institute_id, student=student, topic_id=s.topic_id,
            date=day, start_time=None, minutes=s.minutes, mode=s.mode,
            reason_code=s.reason_code, reason_text=s.reason_text,
        )
        for s in specs
    ])
    return list(_ordered(PlanBlock.objects.filter(
        student=student, institute_id=student.institute_id, date=day
    ))), bool(specs)


def _ordered(qs):
    """Untimed blocks keep the order the rules chose them in (insertion order)."""
    return qs.select_related("topic__parent__parent").order_by("start_time", "id")
