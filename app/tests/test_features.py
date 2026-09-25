"""The feature store: the evidence floor, decay, and rebuild equivalence.

REBUILD EQUIVALENCE IS THE POINT OF THE `derived/` APP
    Drop every `TopicState`, replay the event log, and get the same rows
    back. That is what makes it safe to change the mastery model in month
    six and replay the whole history through it -- and it is the only
    thing standing behind the claim that `derived/` is disposable.

    It is also a claim that quietly stops being true. Cache a value that
    no event can reproduce, or let one field read `timezone.now()`, and
    the rebuild starts disagreeing with the incremental path. Nothing
    else in the system would notice.

WHY EVERY TEST HERE PASSES `as_of`
    `recompute(..., as_of=)` fixes the clock. Without it the 30-day
    windows move between the two halves of an equivalence assertion and
    the test becomes an approximation.
"""

from __future__ import annotations

import datetime as dt

import pytest
from django.core.management import call_command

from apps.derived.models import StudentState, TopicState
from apps.derived.services import features

from tests import factories as f
from tests.factories import AS_OF

pytestmark = pytest.mark.django_db


TOPIC_FIELDS = [
    "student_id", "topic_id", "institute_id", "mastery", "retention",
    "attempts_n", "correct_n", "accuracy_30d", "exposure_min",
    "avg_time_spent", "self_rating", "last_seen", "last_revised",
]

STUDENT_FIELDS = [
    "student_id", "institute_id", "consistency", "load_index", "balance_index",
    "revision_debt", "risk_score", "mock_avg", "mock_trend", "syllabus_pct",
]


def topic_snapshot(institute_id: int) -> dict:
    """Every stored value except `id` and `computed_at`.

    Those two are excluded on purpose: a rebuild is *supposed* to produce
    new row ids and a later `computed_at`. Everything else is derived from
    events and must come back identical.
    """
    return {
        (r["student_id"], r["topic_id"]): r
        for r in TopicState.objects.filter(institute_id=institute_id).values(*TOPIC_FIELDS)
    }


def student_snapshot(institute_id: int) -> dict:
    return {
        r["student_id"]: r
        for r in StudentState.objects.filter(institute_id=institute_id).values(*STUDENT_FIELDS)
    }


# ------------------------------------------------------- the evidence floor


@pytest.mark.parametrize(
    "pattern,expected_mastery,expected_n",
    [
        ("c", None, 1),
        ("cw", None, 2),
        ("cwc", None, 3),
        ("cwcw", 0.5, 4),
        ("cwcwc", 0.6, 5),
    ],
)
def test_mastery_is_withheld_below_four_attempts(cohort, pattern, expected_mastery, expected_n):
    """Null rather than a confident-looking number from three data points.

    A mentor shown "33% mastery" acts on it, and acting on three questions
    is worse than acting on nothing. `attempts_n` is populated either way,
    so the UI can say "not enough data yet" instead of guessing.
    """
    student = f.make_student(cohort)
    f.record(student, cohort.chapter("Kinematics"), pattern)
    features.recompute_topic_state(cohort.institute.id, as_of=AS_OF)

    state = TopicState.objects.get(student=student)
    assert state.attempts_n == expected_n
    assert state.mastery == expected_mastery


def test_unattempted_questions_do_not_count_toward_the_floor(cohort):
    """A blank is not evidence of anything about the chapter.

    Three attempted plus two skipped is still three data points, and the
    floor has to agree or `mastery` starts appearing for students who have
    barely touched a chapter.
    """
    student = f.make_student(cohort)
    f.record(student, cohort.chapter("Kinematics"), "ccwbn")
    features.recompute_topic_state(cohort.institute.id, as_of=AS_OF)

    state = TopicState.objects.get(student=student)
    assert state.attempts_n == 3
    assert state.mastery is None


def test_mastery_is_reported_at_or_above_the_floor_and_is_a_real_number(cohort):
    student = f.make_student(cohort)
    f.record(student, cohort.chapter("Kinematics"), "ccwc")
    features.recompute_topic_state(cohort.institute.id, as_of=AS_OF)

    state = TopicState.objects.get(student=student)
    assert isinstance(state.mastery, float)
    assert 0.0 <= state.mastery <= 1.0
    assert state.mastery == pytest.approx(0.75)


def test_the_floor_is_the_documented_constant(cohort):
    """If someone moves EVIDENCE_FLOOR, this is where it surfaces."""
    assert features.EVIDENCE_FLOOR == 4


def test_accuracy_30d_has_its_own_lower_floor(cohort):
    """A descriptive percentage still shown to a human, so still floored."""
    student = f.make_student(cohort)
    f.record(student, cohort.chapter("Kinematics"), "cw", ts=AS_OF - dt.timedelta(days=2))
    features.recompute_topic_state(cohort.institute.id, as_of=AS_OF)
    assert TopicState.objects.get(student=student).accuracy_30d is None

    f.record(student, cohort.chapter("Kinematics"), "c", ts=AS_OF - dt.timedelta(days=1),
             question_prefix="X")
    features.recompute_topic_state(cohort.institute.id, as_of=AS_OF)
    # Stored rounded to 4 dp, like every other ratio in the feature store.
    assert TopicState.objects.get(student=student).accuracy_30d == pytest.approx(2 / 3, abs=1e-4)


# ------------------------------------------------------------------ decay


def test_mastery_weights_recent_attempts_more_heavily(cohort):
    """Same raw accuracy, different order, different mastery.

    Four right then four wrong must not read the same as four wrong then
    four right. If it does, the decay term has been dropped and mastery is
    a lifetime average wearing a half-life's name.
    """
    improving = f.make_student(cohort, "Improving", roll_no="IMP")
    declining = f.make_student(cohort, "Declining", roll_no="DEC")
    topic = cohort.chapter("Kinematics")

    f.record_spaced(improving, topic, "wwwwcccc", newest_ts=AS_OF, step_days=30)
    f.record_spaced(declining, topic, "ccccwwww", newest_ts=AS_OF, step_days=30)
    features.recompute_topic_state(cohort.institute.id, as_of=AS_OF)

    up = TopicState.objects.get(student=improving).mastery
    down = TopicState.objects.get(student=declining).mastery
    assert up > 0.5 > down
    assert up + down == pytest.approx(1.0), "the weighting should be symmetric"


def test_decay_is_anchored_to_the_pair_and_not_to_the_wall_clock(cohort):
    """Mastery must not erode while the student sleeps.

    Anchoring decay to `now()` would make a rebuild run on Tuesday
    disagree with the same rebuild on Wednesday from identical events --
    which breaks the invariant the whole `derived/` app exists to protect.
    Calendar-time forgetting belongs in `retention`, which is a forecast.
    """
    student = f.make_student(cohort)
    f.record_spaced(student, cohort.chapter("Kinematics"), "wwcc",
                    newest_ts=AS_OF - dt.timedelta(days=200), step_days=15)

    features.recompute_topic_state(cohort.institute.id, as_of=AS_OF)
    early = TopicState.objects.get(student=student).mastery
    features.recompute_topic_state(
        cohort.institute.id, as_of=AS_OF + dt.timedelta(days=365)
    )
    late = TopicState.objects.get(student=student).mastery

    assert early == late


def test_retention_is_null_at_rung_zero(cohort):
    """There is no retention model yet, so the field stays honest."""
    student = f.make_student(cohort)
    f.record(student, cohort.chapter("Kinematics"), "ccwc")
    features.recompute_topic_state(cohort.institute.id, as_of=AS_OF)
    assert TopicState.objects.get(student=student).retention is None


# ----------------------------------------------------------- the key set


def test_a_pair_exists_when_the_student_only_studied_it(cohort):
    """Forty minutes logged and never practised is a real, interesting state.

    The key set is the *union* of attempts, study logs, ratings and
    revisions -- not attempts alone -- or the neglect chart loses exactly
    the chapters it is supposed to show.
    """
    student = f.make_student(cohort)
    topic = cohort.chapter("Magnetism")
    f.study(student, topic, 40, AS_OF - dt.timedelta(days=3))
    features.recompute_topic_state(cohort.institute.id, as_of=AS_OF)

    state = TopicState.objects.get(student=student, topic=topic)
    assert state.attempts_n == 0
    assert state.mastery is None
    assert state.exposure_min == 40


def test_self_rating_is_the_latest_not_the_highest(cohort):
    """`Max(self_rating)` would report a student's most optimistic answer
    ever, which is precisely backwards for an overconfidence detector."""
    student = f.make_student(cohort)
    topic = cohort.chapter("Hydrocarbons")
    f.rate(student, topic, 5, ts=AS_OF - dt.timedelta(days=30))
    f.rate(student, topic, 2, ts=AS_OF - dt.timedelta(days=1))
    features.recompute_topic_state(cohort.institute.id, as_of=AS_OF)

    assert TopicState.objects.get(student=student, topic=topic).self_rating == 2


# --------------------------------------------------- rebuild equivalence


@pytest.fixture
def rich_cohort(cohort):
    """Four students with enough history to make an equality assertion mean
    something: mocks, practice, study logs, ratings and revisions."""
    papers = [
        f.make_paper(cohort, f"Mock {i + 1}", dt.date(2026, 7, 1) + dt.timedelta(days=21 * i))
        for i in range(3)
    ]
    f.teach_everything(cohort)

    patterns = ["ccwcwc", "cwwwcw", "ccccwc", "wwbncw"]
    students = []
    for i in range(4):
        student = f.make_student(cohort, f"Student {i}", roll_no=f"R{i}")
        students.append(student)
        for j, chapter in enumerate(cohort.chapters.values()):
            pattern = patterns[(i + j) % len(patterns)]
            for k, paper in enumerate(papers):
                f.record(
                    student, chapter, pattern[: 3 + k], paper=paper,
                    ts=f.timezone.make_aware(
                        dt.datetime.combine(paper.held_on, dt.time(9, 0))
                    ),
                    question_prefix=f"P{k}C{j}Q",
                    time_spent=60 + 5 * ((i + j) % 7),
                )
            if j % 3 == 0:
                f.study(student, chapter, 25 + 5 * i, AS_OF - dt.timedelta(days=j + 1))
            if j % 4 == 0:
                f.rate(student, chapter, 1 + (i + j) % 5, AS_OF - dt.timedelta(days=j + 2))
            if j % 5 == 0:
                f.revision(
                    student, chapter, 1,
                    scheduled_for=(AS_OF - dt.timedelta(days=10 + j)).date(),
                    done_at=AS_OF - dt.timedelta(days=9 + j) if i % 2 else None,
                )
    return cohort, students, papers


def test_rebuild_from_events_reproduces_topic_state_exactly(rich_cohort):
    """Drop everything derived, replay, assert identical. §14's headline test."""
    cohort, _, _ = rich_cohort
    inst = cohort.institute.id

    features.recompute(inst, as_of=AS_OF)
    before = topic_snapshot(inst)
    before_ids = set(TopicState.objects.filter(institute_id=inst).values_list("id", flat=True))
    assert before, "fixture produced no topic states -- the test would be vacuous"

    TopicState.objects.filter(institute_id=inst).delete()
    assert TopicState.objects.filter(institute_id=inst).count() == 0

    features.recompute_topic_state(inst, as_of=AS_OF)
    after = topic_snapshot(inst)
    after_ids = set(TopicState.objects.filter(institute_id=inst).values_list("id", flat=True))

    assert after == before
    assert not (after_ids & before_ids), (
        "the rows were not actually recreated, so this asserted nothing"
    )


def test_rebuild_from_events_reproduces_student_state_exactly(rich_cohort):
    cohort, _, _ = rich_cohort
    inst = cohort.institute.id

    features.recompute(inst, as_of=AS_OF)
    before = student_snapshot(inst)
    assert before

    StudentState.objects.filter(institute_id=inst).delete()
    features.recompute_student_state(inst, as_of=AS_OF)

    assert student_snapshot(inst) == before


def test_recompute_is_idempotent(rich_cohort):
    """Running twice changes nothing but `computed_at`.

    This is what makes the nightly job safe to re-run after a failure, and
    what makes "recompute after every ingest" cheap rather than dangerous.
    """
    cohort, _, _ = rich_cohort
    inst = cohort.institute.id

    features.recompute(inst, as_of=AS_OF)
    topics_once, students_once = topic_snapshot(inst), student_snapshot(inst)
    ids_once = set(TopicState.objects.filter(institute_id=inst).values_list("id", flat=True))

    stats = features.recompute(inst, as_of=AS_OF)

    assert topic_snapshot(inst) == topics_once
    assert student_snapshot(inst) == students_once
    assert set(TopicState.objects.filter(institute_id=inst).values_list("id", flat=True)) == ids_once, (
        "the second run replaced rows instead of upserting them"
    )
    assert stats.rows_deleted == 0


def test_the_nightly_command_rebuilds_under_rls(rich_cohort):
    """`recompute_features --rebuild` wraps each institute in `tenant_scope`.

    Worth its own test: the command runs with privileges *dropped*, so a
    missing GRANT or a policy that refuses the write shows up here and
    nowhere else. The in-process `features.recompute` tests above all run
    as the BYPASSRLS role and would not notice.
    """
    cohort, _, _ = rich_cohort
    inst = cohort.institute.id

    call_command("recompute_features", "--as-of", AS_OF.isoformat(), verbosity=0)
    before = topic_snapshot(inst)
    assert before

    call_command("recompute_features", "--rebuild", "--as-of", AS_OF.isoformat(), verbosity=0)
    assert topic_snapshot(inst) == before


def test_state_is_deleted_when_its_source_events_disappear(rich_cohort):
    """Disposable has to mean disposable in both directions.

    Only reachable through a syllabus edit or a rolled-back ingest, but if
    recompute only ever adds rows then a rebuild is not a rebuild.
    """
    cohort, _, _ = rich_cohort
    inst = cohort.institute.id
    features.recompute(inst, as_of=AS_OF)

    # A student with no events at all, so the pair below is unreachable
    # from the event log and must not survive a recompute.
    ghost = f.make_student(cohort, "Ghost", roll_no="GHOST")
    orphan = TopicState.objects.create(
        institute_id=inst, student=ghost,
        topic=cohort.chapter("Matrices"), attempts_n=0,
    )
    stats = features.recompute_topic_state(inst, as_of=AS_OF)

    assert stats.rows_deleted >= 1
    assert not TopicState.objects.filter(id=orphan.id).exists()


def test_recompute_reports_how_much_mastery_it_withheld(rich_cohort):
    """The withheld count is the honesty metric: 25% on the seeded data."""
    cohort, _, _ = rich_cohort
    stats = features.recompute_topic_state(cohort.institute.id, as_of=AS_OF)

    assert stats.mastery_reported + stats.mastery_withheld == stats.rows_written
    assert stats.rows_written == TopicState.objects.filter(
        institute_id=cohort.institute.id
    ).count()
