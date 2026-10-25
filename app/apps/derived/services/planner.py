"""The day plan: what to study today, and why — rules, not a model.

THIS IS NOT `plan_week`
    TASKS.md Phase 4 lists `plan_week` as a Gemini reasoning task. This is the
    deterministic version underneath it: explicit rules over state the system
    already holds, each block carrying the rule that put it there. It exists
    because a plan a student cannot interrogate is a plan they stop following
    (`PlanBlock`'s own docstring), and a rule can be interrogated in a way a
    model's output cannot. When `plan_week` arrives it can reorder and word
    these; it should not need to rediscover them.

THE RULES, IN PRIORITY ORDER
    1. **Revise — due.** A revision cycle that is due or overdue. Retention
       decays with time, so these go first. Most overdue first.
    2. **Revise — fading.** A chapter whose forecast `retention` is below
       0.5 and that has no revision due: the forgetting model's half of the
       schedule (`revisions.py` deliberately gives old chapters no R1, and
       leaves them to this rule). Lowest retention first. Rules 1 and 2
       share one cap: **at most two revise blocks a day**, in total.
    3. **Practice** — the weakest *taught* chapter(s): measured mastery below
       0.5 (the same line `?weak=true` draws), lowest first, heavier-weighted
       chapters winning ties. At most two. "Taught" means what the `weak_topic`
       detector means by it — `ChapterStatus.taught_at` is set — because a
       plan that tells a student to drill a chapter their class has not
       reached is the same error the detector refuses to make. **When a
       subject is being neglected** (an open `subject_imbalance` flag), that
       subject's weak chapters take the practice slots first, and the block
       says why in plain words.
    4. **Learn** — a taught chapter the student has never attempted. At most
       one: new material is the first thing to give way to a short day.

    A chapter appears at most once a day, and the plan never exceeds the
    day's budget. A block that does not fit is dropped, not shrunk — a
    45-minute practice block squeezed to 20 stops being the thing it said it
    was.

THE BUDGET
    The student's own `daily_minutes` (what they said at onboarding), else
    the median of what they actually log on the days they log anything,
    else a default — the first of those that exists. A stated figure is
    honoured from 45 minutes up (onboarding's own minimum); a logged median
    is floored at 90, because a median of 20 means "not logging", not "has
    20 minutes". Both are capped at 360. Then the burnout guard below may
    lower it.

THE BURNOUT GUARD
    Two of the detectors' findings change the *shape* of a day, not just
    its content, because the right advice for them is "do less":

    * an open `overload` flag (hours rising, accuracy falling) cuts the
      budget to 60% and drops the "learn" block — no new material on a day
      that is meant to be lighter;
    * an open `disengagement` flag (practice stopped) caps the day at 90
      minutes — a short, finishable plan is how a student comes back, and a
      three-hour one is how they stay away.

    The plan then carries a `note` saying, gently, that today is lighter.
    It **never names the flag, the detector or a risk band**: the student is
    a minor, and "you are showing an overload signature" with no mentor in
    the room is not feedback, it is a label (see `my_views` for the rule).

WHAT IT DOES NOT DO
    No start times. Nothing the system knows says when this student studies,
    and a plan that puts everyone at 17:00 is wrong in a way that looks
    precise. Blocks come back untimed (the console shows "—") until a student
    can say when they study. `target_rank` is recorded at onboarding but is
    not used here: nothing yet links a rank to a day's work honestly.

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

from apps.derived.models import Flag, PlanBlock, TopicState
from apps.events.models import ChapterStatus, RevisionEvent, StudyLog
from apps.syllabus.services import chapters_for_student
from apps.tenancy.models import Student

LEARN, PRACTICE, REVISE = "learn", "practice", "revise"

MINUTES = {REVISE: 30, PRACTICE: 45, LEARN: 60}
CAPS = {REVISE: 2, PRACTICE: 2, LEARN: 1}

#: Same line as `?weak=true` on the topic-states routes.
WEAK_BELOW = 0.5

#: Same line as `?forgetting=true` on the topic-states routes: below even
#: odds of recall, a chapter is worth a revise block.
FADING_BELOW = 0.5

DEFAULT_BUDGET = 180
MIN_BUDGET, MAX_BUDGET = 90, 360

#: The floor for a budget the student *stated*. The same as onboarding's
#: minimum (`engine_serializers.MIN_DAILY_MINUTES`): the shortest day whose
#: smallest revise and practice blocks both fit, so a short stated day is a
#: short plan, never an empty one and never longer than they said.
STATED_MIN_BUDGET = 45

#: How many days of logging the budget is read from, and how many of those
#: days must actually have a log before it is trusted over the default. One
#: logged day is an anecdote, not a habit.
BUDGET_WINDOW_DAYS = 14
BUDGET_MIN_DAYS = 3

#: The burnout guard. See the module docstring.
OVERLOAD, DISENGAGEMENT, SUBJECT_IMBALANCE = "overload", "disengagement", "subject_imbalance"
#: The flag types the planner reads. Anything else a detector raises is the
#: mentor's to act on, not the plan's.
PLAN_FLAGS = (OVERLOAD, DISENGAGEMENT, SUBJECT_IMBALANCE)
OVERLOAD_FACTOR = 0.6
SHORT_DAY_MINUTES = 90

#: A plan is for today or the coming week; further out, the state it is built
#: from will have moved on.
MAX_DAYS_AHEAD = 7

#: The plan-level notes. Written for a seventeen-year-old reading them alone:
#: they say what is different about today and that it is fine, and never why
#: the system thinks so. No flag, detector, risk or "burnout" vocabulary —
#: `tests/test_planner.py` checks every one of them for those words.
NOTE_LIGHTER = (
    "We've kept today a little lighter than usual, with nothing new to start "
    "— steady days add up to more than long ones."
)
NOTE_SHORT = (
    "A short plan for today, to help you get back into a rhythm. Even one "
    "block done is a good day."
)
NOTE_SHORT_AND_LIGHT = (
    "A short, light plan for today, with nothing new to start — just enough "
    "to get back into a rhythm. Even one block done is a good day."
)


# ------------------------------------------------------------- pure rules


@dataclass(frozen=True)
class ChapterFact:
    topic_id: int
    name: str
    weight: float
    mastery: float | None            # None below the evidence floor
    attempts: int
    taught_at: dt.date | None
    subject: str = ""
    retention: float | None = None   # None when never seen
    #: The later of last attempt and last completed revision, as a local date.
    last_touched: dt.date | None = None


@dataclass(frozen=True)
class RevisionFact:
    topic_id: int
    name: str
    cycle: int
    scheduled_for: dt.date


@dataclass(frozen=True)
class PlanInputs:
    day: dt.date
    #: The budget before the burnout guard — see `choose_budget`.
    budget: int
    chapters: list[ChapterFact]
    #: Due or overdue revisions only (scheduled on or before `day`, not done).
    revisions: list[RevisionFact]
    #: Chapters already on today's plan as completed blocks, kept through a
    #: regeneration and so not to be planned a second time.
    already_planned: set[int] = field(default_factory=set)
    #: Types of the student's open flags, restricted to `PLAN_FLAGS`.
    open_flags: frozenset[str] = frozenset()
    #: The subject an open `subject_imbalance` flag says is being neglected.
    neglected_subject: str | None = None


@dataclass(frozen=True)
class BlockSpec:
    topic_id: int
    minutes: int
    mode: str
    reason_code: str
    reason_text: str


@dataclass(frozen=True)
class PlanResult:
    """What `plan_for_student` returns: the day's blocks and how to read them."""

    blocks: list[PlanBlock]
    #: True if this call made blocks; False if the plan existed or nothing fits.
    generated: bool
    #: A gentle sentence when the day is deliberately lighter, else None.
    note: str | None


def _days(n: int) -> str:
    return f"{n} day" if n == 1 else f"{n} days"


def _revision_reason(r: RevisionFact, day: dt.date) -> str:
    late = (day - r.scheduled_for).days
    return (
        f"Revision {r.cycle} is due today"
        if late <= 0 else f"Revision {r.cycle} was due {_days(late)} ago"
    )


def _fading_reason(c: ChapterFact, day: dt.date) -> str:
    if c.last_touched is None:                                     # pragma: no cover
        return "A short revision now keeps this chapter fresh"
    ago = (day - c.last_touched).days
    when = "today" if ago <= 0 else "yesterday" if ago == 1 else f"{ago} days ago"
    return f"You last worked on this {when} — a short revision now keeps it fresh"


def _learn_reason(c: ChapterFact, day: dt.date) -> str:
    ago = (day - c.taught_at).days
    when = "today" if ago <= 0 else "yesterday" if ago == 1 else f"{ago} days ago"
    return f"Taught in class {when}, and you have not attempted it yet"


def _practice_reason(c: ChapterFact, neglected: str | None) -> tuple[str, str]:
    evidence = f"{round(c.mastery * 100)}% over {c.attempts} questions"
    if neglected and c.subject == neglected:
        return "subject_balance", (
            f"{c.subject} is costing you more marks than the time it gets, "
            f"so it comes first: {evidence}"
        )
    return "weak_topic", f"One of your weakest chapters: {evidence}"


def effective_budget(budget: int, open_flags: frozenset[str] | set[str]) -> int:
    """The day's budget after the burnout guard. Pure."""
    if OVERLOAD in open_flags:
        budget = int(budget * OVERLOAD_FACTOR)
    if DISENGAGEMENT in open_flags:
        budget = min(budget, SHORT_DAY_MINUTES)
    return budget


def plan_note(open_flags: frozenset[str] | set[str]) -> str | None:
    """The plan-level note for a deliberately lighter day, or None. Pure."""
    overload, disengaged = OVERLOAD in open_flags, DISENGAGEMENT in open_flags
    if overload and disengaged:
        return NOTE_SHORT_AND_LIGHT
    if disengaged:
        return NOTE_SHORT
    if overload:
        return NOTE_LIGHTER
    return None


def note_for_existing(
    open_flags: frozenset[str] | set[str], *, budget: int, minutes: int, has_learn: bool
) -> str | None:
    """The note for a plan that was already made — only the parts true of it. Pure.

    Blocks are stored and a note is not, so a plan made *before* a flag
    opened has the ordinary shape. Telling its reader "we've kept today
    lighter" would be false, so each half of the guard is claimed only if
    the stored blocks already satisfy it.
    """
    honest: set[str] = set()
    if (
        OVERLOAD in open_flags and not has_learn
        and minutes <= effective_budget(budget, {OVERLOAD})
    ):
        honest.add(OVERLOAD)
    if DISENGAGEMENT in open_flags and minutes <= SHORT_DAY_MINUTES:
        honest.add(DISENGAGEMENT)
    return plan_note(honest)


def build_plan(inputs: PlanInputs) -> list[BlockSpec]:
    """Today's blocks, in the order to do them. Pure: no database, no clock."""
    day = inputs.day
    budget = effective_budget(inputs.budget, inputs.open_flags)
    taken = set(inputs.already_planned)
    chosen: list[BlockSpec] = []
    used = 0

    def add(spec: BlockSpec) -> bool:
        nonlocal used
        if spec.topic_id in taken or used + spec.minutes > budget:
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
    revised = 0
    for r in due:
        if revised >= CAPS[REVISE]:
            break
        if add(BlockSpec(r.topic_id, MINUTES[REVISE], REVISE,
                         f"revision_r{r.cycle}", _revision_reason(r, day))):
            revised += 1

    # 2 · revise — fading: low forecast retention, no revision due. Shares
    #     the revise cap with rule 1. "No revision due" needs no filter of its
    #     own: a chapter whose due revision rule 1 planned is already taken,
    #     and one rule 1 could not plan was stopped by the cap, the budget or
    #     an earlier block — each of which stops a fading block for it too.
    fading = sorted(
        (c for c in inputs.chapters if c.retention is not None and c.retention < FADING_BELOW),
        key=lambda c: (c.retention, -c.weight, c.name),
    )
    for c in fading:
        if revised >= CAPS[REVISE]:
            break
        if add(BlockSpec(c.topic_id, MINUTES[REVISE], REVISE, "low_retention",
                         _fading_reason(c, day))):
            revised += 1

    taught = [c for c in inputs.chapters if c.taught_at is not None and c.taught_at <= day]

    # 3 · practice — weakest taught chapters with a *measured* mastery; a
    #     neglected subject's chapters first.
    neglected = inputs.neglected_subject
    weak = sorted(
        (c for c in taught if c.mastery is not None and c.mastery < WEAK_BELOW),
        key=lambda c: (
            0 if neglected and c.subject == neglected else 1,
            c.mastery, -c.weight, c.name,
        ),
    )
    count = 0
    for c in weak:
        if count >= CAPS[PRACTICE]:
            break
        code, text = _practice_reason(c, neglected)
        if add(BlockSpec(c.topic_id, MINUTES[PRACTICE], PRACTICE, code, text)):
            count += 1

    # 4 · learn — taught, never attempted. Earliest taught first. Not on a
    #     day the burnout guard has made lighter.
    if OVERLOAD in inputs.open_flags:
        return chosen
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


def _clamp_budget(minutes: float) -> int:
    return int(min(MAX_BUDGET, max(MIN_BUDGET, minutes)))


def budget_from_logs(daily_minutes: list[int]) -> int:
    """The student's own typical day, from the days they logged anything.

    The median, not the mean: one 10-hour Sunday should not turn every
    weekday plan into a marathon. Clamped, because a median of 20 minutes is
    a sign they are not logging, not a prescription to study for 20.
    """
    if len(daily_minutes) < BUDGET_MIN_DAYS:
        return DEFAULT_BUDGET
    return _clamp_budget(statistics.median(daily_minutes))


def choose_budget(stated_minutes: int | None, logged_daily_minutes: list[int]) -> int:
    """Budget precedence: what the student said, then what they log, then the default.

    The stated figure wins because it is the only one a new student has, and
    because a student who says "two hours" and logs four is telling us the
    plan they want. It is honoured down to `STATED_MIN_BUDGET`, not the
    90-minute floor the logged median gets: a plan three times longer than
    the student said they have is a plan they abandon. Pure.
    """
    if stated_minutes:
        return int(min(MAX_BUDGET, max(STATED_MIN_BUDGET, stated_minutes)))
    return budget_from_logs(logged_daily_minutes)


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


def _subject_of(topic) -> str:
    node = topic
    while node.parent_id is not None:
        node = node.parent
    return node.name


def _open_plan_flags(student: Student) -> tuple[frozenset[str], str | None]:
    """The open flags the planner acts on, and the neglected subject if any.

    `subject_imbalance` evidence carries the subject whose share of lost
    marks most exceeds its share of study time under `"subject"` (see
    `SubjectImbalanceDetector.evaluate`). The newest open flag wins.
    """
    types: set[str] = set()
    neglected = None
    for ftype, evidence in (
        Flag.objects.filter(
            student=student, institute_id=student.institute_id,
            resolved_at__isnull=True, type__in=PLAN_FLAGS,
        )
        .order_by("-raised_at", "-id")
        .values_list("type", "evidence")
    ):
        types.add(ftype)
        if ftype == SUBJECT_IMBALANCE and neglected is None and isinstance(evidence, dict):
            subject = evidence.get("subject")
            neglected = subject if isinstance(subject, str) and subject else None
    return frozenset(types), neglected


def _local_day(ts: dt.datetime | None) -> dt.date | None:
    return timezone.localtime(ts).date() if ts is not None else None


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

    def touched(state) -> dt.date | None:
        anchors = [d for d in (state.last_seen, state.last_revised) if d is not None]
        return _local_day(max(anchors)) if anchors else None

    chapters = []
    for t in chapters_for_student(student):
        state = states.get(t.id)
        chapters.append(ChapterFact(
            topic_id=t.id, name=t.name, weight=t.weight,
            mastery=getattr(state, "mastery", None),
            attempts=getattr(state, "attempts_n", 0),
            taught_at=taught.get(t.id),
            subject=_subject_of(t),
            retention=getattr(state, "retention", None),
            last_touched=touched(state) if state is not None else None,
        ))
    revisions = [
        RevisionFact(r.topic_id, r.topic.name, r.cycle, r.scheduled_for)
        for r in RevisionEvent.objects.filter(
            student=student, institute_id=student.institute_id,
            done_at__isnull=True, scheduled_for__lte=day,
        ).select_related("topic")
    ]
    open_flags, neglected = _open_plan_flags(student)
    return PlanInputs(
        day=day,
        budget=choose_budget(student.daily_minutes, _daily_log_minutes(student, day)),
        chapters=chapters,
        revisions=revisions,
        already_planned=set(already_planned),
        open_flags=open_flags,
        neglected_subject=neglected,
    )


@transaction.atomic
def plan_for_student(student: Student, day: dt.date, *, replace: bool = False) -> PlanResult:
    """Make this student's plan for `day`: blocks, whether any were made, and the note.

    Idempotent: with a plan already there and `replace` false, the existing
    plan comes back untouched — pressing the button twice is the same as once.
    With `replace`, only blocks not yet completed are rebuilt (see the module
    docstring).

    The `note` is computed, not stored. For a plan made on this call it
    follows from the inputs that shaped it; for one that already existed it
    is `note_for_existing` — claimed only where the stored blocks bear it
    out, so the note can never describe a day the plan is not.

    The student row is locked for the duration. Without it two simultaneous
    requests would both see an empty day and both write a plan, and the
    student would be handed every block twice.
    """
    Student.objects.select_for_update().filter(pk=student.pk).first()

    blocks = PlanBlock.objects.filter(student=student, institute_id=student.institute_id, date=day)
    if blocks.exists() and not replace:
        existing = list(_ordered(blocks))     # non-empty: `exists()` above
        open_flags, _ = _open_plan_flags(student)
        note = note_for_existing(
            open_flags,
            budget=choose_budget(student.daily_minutes, _daily_log_minutes(student, day)),
            minutes=sum(b.minutes for b in existing),
            has_learn=any(b.mode == LEARN for b in existing),
        ) if open_flags else None
        return PlanResult(existing, False, note)

    if replace:
        blocks.filter(completed=False).delete()
    kept = set(blocks.filter(completed=True).values_list("topic_id", flat=True))

    inputs = gather_inputs(student, day, already_planned=kept)
    specs = build_plan(inputs)
    PlanBlock.objects.bulk_create([
        PlanBlock(
            institute_id=student.institute_id, student=student, topic_id=s.topic_id,
            date=day, start_time=None, minutes=s.minutes, mode=s.mode,
            reason_code=s.reason_code, reason_text=s.reason_text,
        )
        for s in specs
    ])
    planned = list(_ordered(PlanBlock.objects.filter(
        student=student, institute_id=student.institute_id, date=day
    )))
    # No note on an empty day: "a short plan for today" over nothing at all
    # is a sentence about a plan that does not exist.
    return PlanResult(planned, bool(specs), plan_note(inputs.open_flags) if planned else None)


def generate_for_student(
    student: Student, day: dt.date, *, replace: bool = False
) -> tuple[list[PlanBlock], bool]:
    """`plan_for_student` without the note: `(blocks, whether any were made)`.

    Kept with its original signature for the callers that only want blocks —
    `generate_plans`, `run_nightly`, and anything else built on it.
    """
    result = plan_for_student(student, day, replace=replace)
    return result.blocks, result.generated


def _ordered(qs):
    """Untimed blocks keep the order the rules chose them in (insertion order)."""
    return qs.select_related("topic__parent__parent").order_by("start_time", "id")
