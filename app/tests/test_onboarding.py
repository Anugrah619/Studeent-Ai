"""Student onboarding: `/api/my/onboarding/`, and where its answers show up.

The student owns two answers — minutes a day, and a target rank. The exam,
its date and the batch are the institute's and are shown read-only. The
first save stamps `onboarded_at` once; `needs_onboarding` on the profile is
how the app knows to show it.
"""

from __future__ import annotations

import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.tenancy.models import Student
from tests import factories as f

pytestmark = pytest.mark.usefixtures("fast_password_hasher")

URL = "/api/my/onboarding/"

SHAPE = {
    "exam_code", "exam_name", "exam_date", "batch_name", "target", "target_rank",
    "daily_minutes", "onboarded_at", "needs_onboarding",
}


def login(user) -> APIClient:
    client = APIClient()
    client.force_login(user)
    return client


@pytest.fixture
def kid(cohort):
    cohort.batch.exam_date = dt.date(2027, 4, 4)
    cohort.batch.save(update_fields=["exam_date"])
    s = f.make_student(cohort, "Aarav Mehta", roll_no="A-1", target="AIR < 5000")
    return s, login(f.make_student_user(s, "aarav"))


def put(client, **body):
    return client.put(URL, body, format="json")


def test_before_onboarding_i_see_what_the_institute_set_and_that_i_need_to(kid, cohort):
    _, client = kid
    response = client.get(URL)
    assert response.status_code == 200
    body = response.json()
    assert set(body) == SHAPE
    assert body == {
        "exam_code": "JEE_MAIN", "exam_name": "JEE Main", "exam_date": "2027-04-04",
        "batch_name": cohort.batch.name, "target": "AIR < 5000",
        "target_rank": None, "daily_minutes": None, "onboarded_at": None,
        "needs_onboarding": True,
    }


def test_saving_onboarding_stores_my_answers_and_stamps_it_once(kid):
    student, client = kid
    response = put(client, daily_minutes=150, target_rank=4200)
    assert response.status_code == 200, response.content
    body = response.json()
    assert (body["daily_minutes"], body["target_rank"], body["needs_onboarding"]) == (150, 4200, False)
    assert body["onboarded_at"] is not None

    student.refresh_from_db()
    first = student.onboarded_at
    assert (student.daily_minutes, student.target_rank) == (150, 4200)

    again = put(client, daily_minutes=200, target_rank=3000).json()
    student.refresh_from_db()
    assert (student.daily_minutes, student.target_rank) == (200, 3000)
    assert student.onboarded_at == first, "a later save moved onboarded_at"
    assert again["onboarded_at"] == body["onboarded_at"]


def test_a_put_replaces_the_whole_answer_so_leaving_out_the_rank_clears_it(kid):
    student, client = kid
    put(client, daily_minutes=150, target_rank=4200)
    assert put(client, daily_minutes=150).json()["target_rank"] is None
    put(client, daily_minutes=150, target_rank=99)
    assert put(client, daily_minutes=150, target_rank=None).json()["target_rank"] is None


@pytest.mark.parametrize("body, field", [
    ({}, "daily_minutes"),
    ({"daily_minutes": 44}, "daily_minutes"),
    ({"daily_minutes": 721}, "daily_minutes"),
    ({"daily_minutes": "lots"}, "daily_minutes"),
    ({"daily_minutes": None}, "daily_minutes"),
    ({"daily_minutes": 60, "target_rank": 0}, "target_rank"),
    ({"daily_minutes": 60, "target_rank": -5}, "target_rank"),
])
def test_out_of_range_answers_are_refused_and_nothing_is_saved(kid, body, field):
    student, client = kid
    response = client.put(URL, body, format="json")
    assert response.status_code == 400 and field in response.json()
    student.refresh_from_db()
    assert student.daily_minutes is None and student.onboarded_at is None


@pytest.mark.parametrize("minutes", [45, 720])
def test_the_bounds_themselves_are_allowed(kid, minutes):
    assert put(kid[1], daily_minutes=minutes).status_code == 200


def test_the_exam_and_batch_cannot_be_changed_from_here(kid, cohort):
    student, client = kid
    other_batch = f.BatchFactory(institute=cohort.institute, exam=cohort.exam, name="Dropper",
                                 syllabus=cohort.syllabus)
    body = put(client, daily_minutes=90, exam_code="NEET_UG", batch_name="Dropper",
               exam_date="2026-11-01", batch=other_batch.id, target="AIR 1").json()
    student.refresh_from_db()
    assert student.batch_id == cohort.batch.id and student.target == "AIR < 5000"
    assert (body["exam_code"], body["batch_name"], body["exam_date"]) == (
        "JEE_MAIN", cohort.batch.name, "2027-04-04",
    )


def test_a_batch_without_an_exam_date_says_so(kid, cohort):
    cohort.batch.exam_date = None
    cohort.batch.save(update_fields=["exam_date"])
    assert kid[1].get(URL).json()["exam_date"] is None


def test_onboarding_is_mine_alone(kid, cohort):
    student, client = kid
    other = f.make_student(cohort, "Bhavna Rao", roll_no="B-1")
    other_client = login(f.make_student_user(other, "bhavna"))
    put(other_client, daily_minutes=400, target_rank=1)
    assert client.get(URL).json()["daily_minutes"] is None
    student.refresh_from_db()
    assert student.daily_minutes is None


def test_staff_and_strangers_cannot_use_it(kid, cohort):
    mentor = login(f.make_mentor_user(cohort, "mentor-o"))
    assert mentor.get(URL).status_code == 403
    assert mentor.put(URL, {"daily_minutes": 60}, format="json").status_code == 403
    assert APIClient().get(URL).status_code in (401, 403)
    assert APIClient().put(URL, {"daily_minutes": 60}, format="json").status_code in (401, 403)


def test_saving_is_rate_limited_and_reading_is_not(kid, monkeypatch):
    from rest_framework.throttling import ScopedRateThrottle

    monkeypatch.setitem(ScopedRateThrottle.THROTTLE_RATES, "onboarding", "2/hour")
    _, client = kid
    codes = [put(client, daily_minutes=60).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    assert all(client.get(URL).status_code == 200 for _ in range(5))


def test_the_throttle_scope_is_configured():
    from django.conf import settings

    assert "onboarding" in settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]


# ------------------------------------------------- where the answers appear


def test_my_profile_says_whether_i_need_onboarding(kid):
    _, client = kid
    assert client.get("/api/my/profile/").json()["needs_onboarding"] is True
    put(client, daily_minutes=120)
    profile = client.get("/api/my/profile/").json()
    assert profile["needs_onboarding"] is False
    assert {"id", "name", "batch", "progress"} <= set(profile)         # nothing else moved


def test_the_console_student_detail_shows_the_answers(kid, mentor_client):
    student, client = kid
    detail = mentor_client.get(f"/api/students/{student.id}/").json()
    assert (detail["daily_minutes"], detail["target_rank"], detail["onboarded_at"]) == (None, None, None)

    put(client, daily_minutes=240, target_rank=700)
    detail = mentor_client.get(f"/api/students/{student.id}/").json()
    assert (detail["daily_minutes"], detail["target_rank"]) == (240, 700)
    assert detail["onboarded_at"] is not None
    assert "needs_onboarding" not in detail                 # a student-app concern


def test_onboarded_at_is_a_real_time_and_set_by_the_server(kid):
    student, client = kid
    before = timezone.now()
    put(client, daily_minutes=60, onboarded_at="2020-01-01T00:00:00Z")
    student.refresh_from_db()
    assert student.onboarded_at >= before


def test_the_model_fields_are_nullable_until_onboarding(cohort):
    s = f.make_student(cohort, "Fresh", roll_no="F-1")
    s = Student.objects.get(pk=s.pk)
    assert (s.daily_minutes, s.target_rank, s.onboarded_at) == (None, None, None)
