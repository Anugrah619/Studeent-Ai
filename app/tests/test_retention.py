"""The forgetting model: `TopicState.retention`, and `?forgetting=true`.

    retention = exp(-t / S),  S = 10 × 2.5^cycles × (0.5 + mastery)

The formula is a pure function (`features.forecast_retention`), pinned here
point by point so that changing a constant is a decision a test makes you
state. Then: that recompute fills it deterministically from `as_of` (inside
the rebuild-equivalence guarantee), and that both topic-states routes filter
on it the same way.
"""

from __future__ import annotations

import datetime as dt
import math

import pytest
from rest_framework.test import APIClient

from apps.api import serializers as ser
from apps.api.views import FORGETTING_BELOW
from apps.derived.models import TopicState
from apps.derived.services import features, planner
from apps.derived.services.features import forecast_retention, retention_stability
from tests import factories as f
from tests.factories import AS_OF

pytestmark = pytest.mark.usefixtures("fast_password_hasher")


def ago(days: float) -> dt.datetime:
    return AS_OF - dt.timedelta(days=days)


def r(days_since: float | None, *, cycles=0, mastery=None, revised=None):
    return forecast_retention(
        AS_OF,
        last_seen=None if days_since is None else ago(days_since),
        last_revised=revised,
        cycles_done=cycles,
        mastery=mastery,
    )


# ------------------------------------------------------------- the formula


def test_just_seen_is_full_recall():
    assert r(0) == 1.0


def test_after_one_stability_recall_is_one_over_e():
    """S is 10 days for a chapter seen once at neutral mastery."""
    assert r(10) == pytest.approx(math.exp(-1), abs=1e-4)


def test_a_chapter_met_once_crosses_even_odds_in_about_a_week():
    """10·ln 2 ≈ 6.93 days: the R2 interval. Pins the base constant."""
    assert r(6) > 0.5 > r(7)


@pytest.mark.parametrize("cycles, stability", [(0, 10.0), (1, 25.0), (2, 62.5), (3, 156.25)])
def test_each_completed_cycle_makes_it_fade_two_and_a_half_times_slower(cycles, stability):
    assert retention_stability(cycles, None) == pytest.approx(stability)
    assert r(stability, cycles=cycles) == pytest.approx(math.exp(-1), abs=1e-4)


def test_cycles_beyond_three_add_nothing():
    assert retention_stability(7, None) == retention_stability(3, None)


@pytest.mark.parametrize("mastery, stability", [(0.0, 5.0), (0.5, 10.0), (1.0, 15.0), (None, 10.0)])
def test_mastery_scales_stability_and_unmeasured_counts_as_neutral(mastery, stability):
    """Null mastery is "not enough attempts to say" — it must not read as weak."""
    assert retention_stability(0, mastery) == pytest.approx(stability)


def test_better_understood_chapters_are_forgotten_more_slowly():
    assert r(5, mastery=0.2) < r(5, mastery=None) < r(5, mastery=0.9)


def test_time_is_counted_from_the_later_of_last_seen_and_last_revised():
    assert r(30, revised=ago(2)) == r(2)
    assert r(2, revised=ago(30)) == r(2)
    assert forecast_retention(AS_OF, last_seen=None, last_revised=ago(2),
                              cycles_done=1, mastery=None) == r(2, cycles=1)


def test_never_seen_is_null_not_zero():
    assert r(None) is None


def test_an_anchor_after_as_of_counts_as_now_not_as_negative_age():
    assert r(-5) == 1.0


@pytest.mark.parametrize("days_since", [0, 0.5, 3, 30, 365, 5000])
def test_always_a_probability(days_since):
    value = r(days_since, mastery=0.0)
    assert 0.0 <= value <= 1.0


def test_the_constants_are_the_documented_ones():
    assert (features.RETENTION_BASE_DAYS, features.RETENTION_CYCLE_GROWTH,
            features.RETENTION_MAX_CYCLES) == (10.0, 2.5, 3)


def test_the_published_help_text_states_the_real_model():
    """The contract describes the formula; if a constant moves, so must this."""
    text = ser.TopicStateSerializer().fields["retention"].help_text
    assert "exp(-t / S)" in text
    assert f"{features.RETENTION_BASE_DAYS:g} × {features.RETENTION_CYCLE_GROWTH:g}^" in text
    assert f"most {features.RETENTION_MAX_CYCLES}" in text
    assert "Null when the chapter was never seen" in text


# -------------------------------------------------------- in the feature store


def test_recompute_fills_retention_from_as_of(cohort):
    s = f.make_student(cohort)
    f.record(s, cohort.chapter("Kinematics"), "ccwc", ts=ago(10))
    features.recompute_topic_state(cohort.institute.id, as_of=AS_OF)
    state = TopicState.objects.get(student=s)
    # mastery 0.75 -> S = 10 × 1.25 = 12.5
    assert state.retention == pytest.approx(math.exp(-10 / 12.5), abs=1e-4)


def test_the_same_as_of_gives_the_same_number_and_a_later_one_a_lower_one(cohort):
    """A forecast may depend on the date asked about; mastery may not."""
    s = f.make_student(cohort)
    f.record(s, cohort.chapter("Kinematics"), "ccwc", ts=ago(3))
    inst = cohort.institute.id

    features.recompute_topic_state(inst, as_of=AS_OF)
    first = TopicState.objects.get(student=s)
    features.recompute_topic_state(inst, as_of=AS_OF)
    again = TopicState.objects.get(student=s)
    features.recompute_topic_state(inst, as_of=AS_OF + dt.timedelta(days=20))
    later = TopicState.objects.get(student=s)

    assert again.retention == first.retention
    assert later.retention < first.retention
    assert later.mastery == first.mastery


def test_only_completed_revisions_slow_forgetting(cohort):
    done, pending, none = (
        f.make_student(cohort, name, roll_no=name) for name in ("Done", "Pending", "None")
    )
    topic = cohort.chapter("Limits")
    for s in (done, pending, none):
        f.record(s, topic, "cwcw", ts=ago(20))
    f.revision(done, topic, 1, ago(19).date(), done_at=ago(19))
    f.revision(pending, topic, 1, ago(19).date())
    features.recompute_topic_state(cohort.institute.id, as_of=AS_OF)

    value = {s: TopicState.objects.get(student=s).retention for s in (done, pending, none)}
    assert value[pending] == value[none]
    # done: anchored a day later *and* 2.5× more stable.
    assert value[done] == pytest.approx(math.exp(-19 / 25), abs=1e-4)
    assert value[done] > value[none]


def test_rebuild_reproduces_retention_exactly(cohort):
    students = [f.make_student(cohort, f"S{i}", roll_no=f"S{i}") for i in range(3)]
    for i, s in enumerate(students):
        for j, chapter in enumerate(cohort.chapters.values()):
            f.record(s, chapter, "cwcc"[: 2 + (i + j) % 3], ts=ago(1 + i + 2 * j))
            if j % 3 == 0:
                f.revision(s, chapter, 1, ago(j).date(), done_at=ago(j))
    inst = cohort.institute.id

    features.recompute_topic_state(inst, as_of=AS_OF)
    snapshot = sorted(TopicState.objects.filter(institute_id=inst)
                      .values_list("student_id", "topic_id", "retention"))
    # Non-vacuous: every row carries a number, and they are not all alike.
    assert snapshot and all(v is not None for _, _, v in snapshot)
    assert len({v for _, _, v in snapshot}) > 3

    TopicState.objects.filter(institute_id=inst).delete()
    features.recompute_topic_state(inst, as_of=AS_OF)
    assert sorted(TopicState.objects.filter(institute_id=inst)
                  .values_list("student_id", "topic_id", "retention")) == snapshot


# ------------------------------------------------------- ?forgetting=true


@pytest.fixture
def chart(cohort):
    """Aarav's chapters at known retentions, plus a classmate's to keep out."""
    aarav = f.make_student(cohort, "Aarav Mehta", roll_no="A-1")
    bhavna = f.make_student(cohort, "Bhavna Rao", roll_no="B-1")

    def state(student, chapter, retention, mastery):
        return TopicState.objects.create(
            institute=cohort.institute, student=student, topic=cohort.chapter(chapter),
            retention=retention, mastery=mastery, attempts_n=8,
        )

    # Mastery order deliberately disagrees with retention order, so a filter
    # that forgot to re-sort (the base queryset sorts by mastery) shows up.
    rows = {
        "fading": state(aarav, "Kinematics", 0.31, 0.2),
        "fastest": state(aarav, "Limits", 0.12, 0.95),
        "edge": state(aarav, "Matrices", FORGETTING_BELOW, 0.3),     # not below: excluded
        "fresh": state(aarav, "Magnetism", 0.88, 0.1),
        "unseen": state(aarav, "Hydrocarbons", None, None),
    }
    state(bhavna, "Kinematics", 0.05, 0.1)
    client = APIClient()
    client.force_login(f.make_student_user(aarav, "aarav"))
    mentor = APIClient()
    mentor.force_login(f.make_mentor_user(cohort, "mentor-r"))
    return aarav, rows, client, mentor


def ids(response):
    assert response.status_code == 200, response.content
    return [row["id"] for row in response.json()["results"]]


def test_my_forgetting_list_is_below_half_fastest_first(chart):
    _, rows, client, _ = chart
    assert ids(client.get("/api/my/topic-states/?forgetting=true")) == [
        rows["fastest"].id, rows["fading"].id,
    ]


def test_the_console_route_filters_the_same_way(chart):
    aarav, rows, _, mentor = chart
    assert ids(mentor.get(f"/api/students/{aarav.id}/topic-states/?forgetting=true")) == [
        rows["fastest"].id, rows["fading"].id,
    ]


def test_forgetting_combines_with_weak(chart):
    _, rows, client, _ = chart
    assert ids(client.get("/api/my/topic-states/?forgetting=true&weak=true")) == [rows["fading"].id]


@pytest.mark.parametrize("value", ["false", "1", "yes", ""])
def test_any_other_value_is_ignored(chart, value):
    _, rows, client, _ = chart
    assert len(ids(client.get(f"/api/my/topic-states/?forgetting={value}"))) == len(rows)


def test_a_non_student_gets_an_empty_forgetting_page(chart):
    *_, mentor = chart
    assert ids(mentor.get("/api/my/topic-states/?forgetting=true")) == []


def test_the_line_is_the_planners_line():
    assert FORGETTING_BELOW == planner.FADING_BELOW == 0.5
