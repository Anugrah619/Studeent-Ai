"""The risk loop has to close.

These cover the critical defect found by the prepare-agents survey: nothing
in the product could resolve a flag, so

* detectors went permanently mute — a suppression that waits for the open
  flag to close waits forever, and
* `flags_resolved` / `recovery_rate_pct` on the director's KPI strip were
  structurally frozen at their seeded values.

Each test below fails if either half of the fix is reverted.
"""

from __future__ import annotations

import datetime as dt

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.derived.models import Flag, Intervention
from apps.derived.services.detectors import _flag_history
from tests import factories as f

pytestmark = pytest.mark.django_db


@pytest.fixture
def student(cohort):
    return f.make_student(cohort, "Aarav Mehta")


@pytest.fixture
def two_chapters(cohort):
    chapters = list(cohort.chapters.values())
    return chapters[0], chapters[1]


@pytest.fixture
def open_flag(cohort, student, two_chapters):
    topic, _ = two_chapters
    return Flag.objects.create(
        institute=cohort.institute, student=student, topic=topic,
        type="weak_topic", severity=Flag.HIGH,
        headline="Organic Chemistry: 31% over 16 attempts.",
        evidence={"mastery_pct": 31, "attempts": 16},
        raised_at=timezone.now() - dt.timedelta(days=3),
    )


# --------------------------------------------------------------------- unit


def test_one_weak_chapter_does_not_silence_the_next(cohort, student, two_chapters, open_flag):
    """The bug in one line.

    Keyed on (student, type) alone, an open `weak_topic` on chapter A
    suppressed `weak_topic` on every other chapter for that student,
    permanently. The key must include the topic.
    """
    topic_a, topic_b = two_chapters

    history = _flag_history(cohort.institute.id, [student.id])

    assert (student.id, "weak_topic", topic_a.id) in history, (
        "the open flag on chapter A should be found"
    )
    assert (student.id, "weak_topic", topic_b.id) not in history, (
        "chapter B must NOT inherit chapter A's suppression — this is the "
        "regression that made seven of eight detectors go mute"
    )


def test_whole_student_detectors_still_collapse_to_one(cohort, student):
    """Topic-less detectors keep the old behaviour, and should.

    `overload` and `disengagement` describe the student, not a chapter, so
    a second open one says nothing new. They carry topic_id=None, which
    keys them together exactly as before.
    """
    now = timezone.now()
    for i in range(2):
        Flag.objects.create(
            institute=cohort.institute, student=student, topic=None,
            type="overload", severity=Flag.HIGH, headline=f"overload {i}",
            evidence={}, raised_at=now - dt.timedelta(days=i),
        )

    history = _flag_history(cohort.institute.id, [student.id])
    keys = [k for k in history if k[1] == "overload"]

    assert keys == [(student.id, "overload", None)], (
        "both topic-less flags must collapse to a single key"
    )
    assert history[keys[0]][1] is True, "still open"


# ---------------------------------------------------------------------- API


def test_resolving_a_flag_closes_it_and_records_the_outcome(mentor_client, open_flag):
    response = mentor_client.post(
        reverse("flag-resolve", args=[open_flag.id]),
        {"outcome": Flag.RECOVERED, "note": "Moved to morning Maths batch."},
        format="json",
    )

    assert response.status_code == 200, response.content
    open_flag.refresh_from_db()
    assert open_flag.resolved_at is not None
    assert open_flag.outcome == Flag.RECOVERED
    assert Intervention.objects.filter(flag=open_flag).count() == 1, (
        "a note supplied at resolution should also be logged as an intervention"
    )


def test_outcome_is_required(mentor_client, open_flag):
    """A closed flag with no outcome is a lost training label."""
    response = mentor_client.post(
        reverse("flag-resolve", args=[open_flag.id]),
        {"note": "spoke to him"}, format="json",
    )

    assert response.status_code == 400
    open_flag.refresh_from_db()
    assert open_flag.resolved_at is None, "must not close without an outcome"


def test_declined_is_acceptable(mentor_client, open_flag):
    """An honest 'declined' is worth more to the model than a polite blank."""
    response = mentor_client.post(
        reverse("flag-resolve", args=[open_flag.id]),
        {"outcome": Flag.DECLINED}, format="json",
    )

    assert response.status_code == 200
    open_flag.refresh_from_db()
    assert open_flag.outcome == Flag.DECLINED


def test_resolving_twice_is_refused(mentor_client, open_flag):
    url = reverse("flag-resolve", args=[open_flag.id])
    payload = {"outcome": Flag.RECOVERED}

    assert mentor_client.post(url, payload, format="json").status_code == 200
    second = mentor_client.post(url, payload, format="json")

    assert second.status_code == 409, "a second resolve must not silently overwrite the first"


def test_intervening_does_not_resolve(mentor_client, open_flag):
    """Contacting a student is not the same event as the student recovering.

    If `intervene` auto-resolved, every outcome label would say 'recovered'
    at the moment of the phone call, and the risk model would train on the
    mentor's optimism rather than on what happened.
    """
    response = mentor_client.post(
        reverse("flag-intervene", args=[open_flag.id]),
        {"action": "Called the parent."}, format="json",
    )

    assert response.status_code == 201, response.content
    open_flag.refresh_from_db()
    assert open_flag.resolved_at is None
    assert open_flag.outcome == ""


def test_resolution_moves_the_director_kpi(mentor_client, open_flag):
    """The number that renews a contract has to be able to move.

    `recovery_rate_pct` was frozen because nothing could resolve a flag.
    """
    summary = reverse("dashboard-summary")

    before = mentor_client.get(summary).json()["flags_resolved"]
    mentor_client.post(
        reverse("flag-resolve", args=[open_flag.id]),
        {"outcome": Flag.RECOVERED}, format="json",
    )
    after = mentor_client.get(summary).json()["flags_resolved"]

    assert after == before + 1, "resolving a flag must show up on the KPI strip"
