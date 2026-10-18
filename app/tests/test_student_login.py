"""Student sign-in: roll number + a password the institute provides, and a
forced change on the first sign-in.

The properties worth proving, in the order a student meets them:

1. Staff can issue a login, and the credentials come back exactly once.
2. The student signs in with their **roll number**.
3. Until they choose their own password the server refuses everything else —
   the rule lives on the server, so a script cannot skip the change-password
   screen the way it can skip a client-side check.
4. The change is validated, keeps the session alive, and retires the
   temporary password.
5. The guessable parts are throttled, and the throttle cannot be dodged by
   writing your own `X-Forwarded-For` header.
"""

from __future__ import annotations

import re

import pytest
from django.contrib.auth.hashers import make_password
from rest_framework.test import APIClient

from apps.tenancy.models import User
from apps.tenancy.services import accounts
from tests import factories as f

pytestmark = pytest.mark.usefixtures("fast_password_hasher")

STRONG = "mT7#pQ2z-lamp"
ANOTHER = "vB9!kR4x-torch"
TEMP_SHAPE = re.compile(r"^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$")


def post(client, url, body=None):
    return client.post(url, body or {}, format="json")


def sign_in(username, password, **extra):
    client = APIClient()
    response = post(client, "/api/auth/login/", {"username": username, "password": password, **extra})
    return client, response


@pytest.fixture
def school(cohort):
    """One institute: two mentors, a student under each, and a director.

    Aarav (roll A-1041) is Mentor One's; Bhavna (B-2002) is Mentor Two's, so
    "may this mentor manage that student" has both answers.
    """
    one = f.make_mentor_user(cohort, "mentor-one")
    two_mentor = f.MentorFactory(institute=cohort.institute, name="Mentor Two")
    two_mentor.user = f.UserFactory(username="mentor-two", password=make_password(STRONG))
    two_mentor.save(update_fields=["user"])

    aarav = f.make_student(cohort, "Aarav Mehta", roll_no="A-1041")
    bhavna = f.StudentFactory(
        institute=cohort.institute, batch=cohort.batch, mentor=two_mentor,
        name="Bhavna Rao", roll_no="B-2002",
    )
    director = f.UserFactory(username="director", password=make_password(STRONG),
                             is_staff=True, is_superuser=True)

    def as_user(user):
        client = APIClient()
        client.force_login(user)
        return client

    return type("School", (), dict(
        cohort=cohort, aarav=aarav, bhavna=bhavna,
        mentor_one=as_user(one), mentor_two=as_user(two_mentor.user),
        director=as_user(director),
    ))


def issue(school, client, student, **body):
    suffix = f"?institute={school.cohort.institute.id}" if client is school.director else ""
    return post(client, f"/api/students/{student.id}/account/{suffix}", body)


def issued(school, student=None, who="mentor_one"):
    """Issue a login through the API and return (roll_no, temporary_password)."""
    student = student or school.aarav
    response = issue(school, getattr(school, who), student)
    assert response.status_code == 201, response.content
    return response.json()["roll_no"], response.json()["temporary_password"]


# ----------------------------------------------------------- issuing a login


def test_a_mentor_issues_a_login_and_the_password_comes_back_once(school):
    response = issue(school, school.mentor_one, school.aarav)
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["roll_no"] == "A-1041" and body["name"] == "Aarav Mehta"
    assert body["must_change_password"] is True
    assert TEMP_SHAPE.match(body["temporary_password"])
    # The secret must never be cached by a browser or a proxy.
    assert response["Cache-Control"] == "no-store"

    school.aarav.refresh_from_db()
    user = school.aarav.user
    assert user.must_change_password is True
    assert user.first_name == "Aarav Mehta"
    assert user.password != body["temporary_password"], "stored in plain text"
    assert body["temporary_password"] not in user.password


def test_temporary_passwords_are_not_reused(school):
    first = issued(school, school.aarav)[1]
    second = issued(school, school.bhavna, who="mentor_two")[1]
    assert first != second


def test_issuing_twice_is_refused_and_does_not_overwrite(school):
    """The reason issue and reset are two verbs: a repeat must not be able to
    lock out a student who has already settled in."""
    roll, temp = issued(school)
    again = issue(school, school.mentor_one, school.aarav)
    assert again.status_code == 409 and "reset" in again.json()["detail"].lower()
    assert sign_in(roll, temp)[1].status_code == 200, "the original password was overwritten"


def test_a_mentor_cannot_issue_a_login_for_a_colleagues_student(school):
    response = issue(school, school.mentor_one, school.bhavna)
    assert response.status_code == 403
    school.bhavna.refresh_from_db()
    assert school.bhavna.user_id is None


def test_a_director_can_issue_for_any_student_in_the_institute(school):
    assert issue(school, school.director, school.bhavna).status_code == 201


def test_a_students_own_account_cannot_issue_logins(school):
    roll, temp = issued(school)
    client, _ = sign_in(roll, temp)
    post(client, "/api/auth/password/", {"current_password": temp, "new_password": STRONG})
    assert issue(school, client, school.bhavna).status_code == 403


def test_another_institutes_student_is_not_found(school, other_cohort):
    stranger = f.make_student(other_cohort, "Stranger")
    assert issue(school, school.mentor_one, stranger).status_code == 404


def test_staff_may_choose_the_initial_password(school):
    response = issue(school, school.mentor_one, school.aarav, password="Slip-0042")
    assert response.status_code == 201
    assert response.json()["temporary_password"] == "Slip-0042"
    assert sign_in("A-1041", "Slip-0042")[1].status_code == 200


def test_a_too_short_initial_password_is_refused_and_nothing_is_created(school):
    response = issue(school, school.mentor_one, school.aarav, password="abc")
    assert response.status_code == 400
    school.aarav.refresh_from_db()
    assert school.aarav.user_id is None


def test_a_student_who_has_left_is_not_issued_a_login(school):
    school.aarav.exited_at = school.aarav.joined_at
    school.aarav.save(update_fields=["exited_at"])
    assert issue(school, school.mentor_one, school.aarav).status_code == 409


# ------------------------------------------------------- signing in by roll no


def test_a_student_signs_in_with_their_roll_number(school):
    roll, temp = issued(school)
    client, response = sign_in(roll, temp)
    assert response.status_code == 200, response.content
    me = response.json()
    assert me["role"] == "student" and me["student_id"] == school.aarav.id
    assert me["must_change_password"] is True
    assert client.get("/api/me/").status_code == 200


@pytest.mark.parametrize("typed", ["a-1041", "A-1041", "  A-1041  ", "a-1041 "])
def test_the_roll_number_is_forgiving_about_case_and_spaces(school, typed):
    _, temp = issued(school)
    assert sign_in(typed, temp)[1].status_code == 200


def test_wrong_password_and_unknown_roll_number_are_indistinguishable(school):
    """One message for both, or the form tells a stranger which roll numbers
    belong to real students."""
    roll, temp = issued(school)
    wrong_password = sign_in(roll, "not-the-password")[1]
    no_such_student = sign_in("Z-9999", temp)[1]
    assert wrong_password.status_code == no_such_student.status_code == 400
    assert wrong_password.json() == no_such_student.json()


def test_a_roll_number_with_no_login_cannot_sign_in(school):
    assert school.bhavna.user_id is None
    assert sign_in("B-2002", "anything-at-all")[1].status_code == 400


def test_a_disabled_login_cannot_sign_in(school):
    roll, temp = issued(school)
    User.objects.filter(student=school.aarav).update(is_active=False)
    assert sign_in(roll, temp)[1].status_code == 400


def test_staff_still_sign_in_with_their_username(school):
    client, response = sign_in("mentor-two", STRONG)
    assert response.status_code == 200
    assert response.json()["role"] == "mentor"
    assert response.json()["must_change_password"] is False


def test_the_same_roll_number_in_two_institutes_is_settled_by_the_password(school, other_cohort):
    """Roll numbers are unique per batch, not globally. Each student gets in
    with their own password and never into the other's account."""
    twin = f.make_student(other_cohort, "Twin Student", roll_no="A-1041")
    _, twin_password = accounts.issue_account(twin)
    _, mine = issued(school)

    _, mine_response = sign_in("A-1041", mine)
    _, twin_response = sign_in("A-1041", twin_password)
    assert mine_response.json()["student_id"] == school.aarav.id
    assert twin_response.json()["student_id"] == twin.id


def test_an_institute_code_narrows_the_search(school, other_cohort):
    twin = f.make_student(other_cohort, "Twin Student", roll_no="A-1041")
    accounts.issue_account(twin, password="Shared-pass-1")
    accounts.issue_account(school.aarav, password="Shared-pass-1")      # the very same password

    # Both accounts accept it, so without a code nobody can be told apart…
    assert sign_in("A-1041", "Shared-pass-1")[1].status_code == 400
    # …and with the institute's code it is unambiguous.
    mine = sign_in("A-1041", "Shared-pass-1", institute=school.cohort.institute.slug)[1]
    assert mine.status_code == 200 and mine.json()["student_id"] == school.aarav.id
    assert sign_in("A-1041", "Shared-pass-1", institute="no-such-place")[1].status_code == 400


def test_a_staff_username_that_looks_like_a_roll_number_does_not_shadow_the_student(school):
    """Both are candidates and the password picks one. A student is never let
    in with the staff member's password, nor the reverse."""
    f.UserFactory(username="A-1041", password=make_password(ANOTHER))
    _, temp = issued(school)
    staff = sign_in("A-1041", ANOTHER)[1]
    student = sign_in("A-1041", temp)[1]
    assert staff.status_code == student.status_code == 200
    assert staff.json()["student_id"] is None
    assert student.json()["student_id"] == school.aarav.id


# ----------------------------------------------- the forced first password change

BLOCKED = [
    ("get", "/api/my/profile/"),
    ("get", "/api/my/plan/"),
    ("get", "/api/my/topics/"),
    ("get", "/api/students/"),
    ("get", "/api/flags/"),
    ("post", "/api/my/study-logs/"),
]


@pytest.fixture
def fresh_student(school):
    roll, temp = issued(school)
    client, response = sign_in(roll, temp)
    assert response.json()["must_change_password"] is True
    return type("Fresh", (), dict(client=client, roll=roll, temp=temp))


@pytest.mark.parametrize("method, path", BLOCKED)
def test_nothing_works_until_the_password_is_changed(fresh_student, method, path):
    response = getattr(fresh_student.client, method)(path)
    assert response.status_code == 403
    assert response.json()["code"] == "password_change_required"


def test_a_pending_account_can_still_say_who_it_is_and_sign_out(fresh_student):
    me = fresh_student.client.get("/api/me/")
    assert me.status_code == 200 and me.json()["must_change_password"] is True
    assert fresh_student.client.post("/api/auth/logout/").status_code == 204


def test_the_rule_binds_staff_accounts_too(school):
    """A director who resets a mentor's password gets the same guarantee."""
    User.objects.filter(username="mentor-two").update(must_change_password=True)
    client, _ = sign_in("mentor-two", STRONG)
    blocked = client.get("/api/students/")
    assert blocked.status_code == 403 and blocked.json()["code"] == "password_change_required"


def test_changing_the_password_opens_everything_and_keeps_the_session(fresh_student):
    response = post(fresh_student.client, "/api/auth/password/",
                    {"current_password": fresh_student.temp, "new_password": STRONG})
    assert response.status_code == 200, response.content
    assert response.json()["must_change_password"] is False

    # Same client, no second sign-in: the session survived its own request.
    assert fresh_student.client.get("/api/my/profile/").status_code == 200
    assert fresh_student.client.get("/api/me/").json()["must_change_password"] is False


def test_the_temporary_password_stops_working_once_replaced(fresh_student):
    post(fresh_student.client, "/api/auth/password/",
         {"current_password": fresh_student.temp, "new_password": STRONG})
    assert sign_in(fresh_student.roll, fresh_student.temp)[1].status_code == 400
    assert sign_in(fresh_student.roll, STRONG)[1].status_code == 200
    # …and signing in with the chosen one is a normal session now.
    client, response = sign_in(fresh_student.roll, STRONG)
    assert response.json()["must_change_password"] is False
    assert client.get("/api/my/profile/").status_code == 200


def change(fresh, new, current=None):
    return post(fresh.client, "/api/auth/password/",
                {"current_password": current or fresh.temp, "new_password": new})


def test_the_current_password_must_be_right(fresh_student):
    response = change(fresh_student, STRONG, current="not-my-password")
    assert response.status_code == 400 and "current_password" in response.json()
    assert fresh_student.client.get("/api/my/profile/").status_code == 403, "flag cleared anyway"


@pytest.mark.parametrize("bad, why", [
    ("short1!", "too short"),
    ("password123", "a common password"),
    ("1234567890", "all digits"),
    ("AaravMehta", "too like the student's name"),
    ("xxA-1041xx-secret", "contains the roll number"),
])
def test_weak_new_passwords_are_refused(fresh_student, bad, why):
    response = change(fresh_student, bad)
    assert response.status_code == 400, why
    assert "new_password" in response.json(), why
    assert fresh_student.client.get("/api/my/profile/").status_code == 403, \
        f"{why}: the flag was cleared by a refused change"


def test_the_new_password_must_differ_from_the_old(fresh_student):
    post(fresh_student.client, "/api/auth/password/",
         {"current_password": fresh_student.temp, "new_password": STRONG})
    response = post(fresh_student.client, "/api/auth/password/",
                    {"current_password": STRONG, "new_password": STRONG})
    assert response.status_code == 400 and "new_password" in response.json()


def test_an_anonymous_caller_cannot_change_anything():
    assert post(APIClient(), "/api/auth/password/",
                {"current_password": "x", "new_password": STRONG}).status_code in (401, 403)


def test_a_mentor_can_change_their_own_password(school):
    client, _ = sign_in("mentor-two", STRONG)
    response = post(client, "/api/auth/password/",
                    {"current_password": STRONG, "new_password": ANOTHER})
    assert response.status_code == 200
    assert sign_in("mentor-two", ANOTHER)[1].status_code == 200


# --------------------------------------------------------------------- reset


def test_reset_gives_a_new_temporary_password_and_demands_a_change(school):
    roll, old_temp = issued(school)
    first_client, _ = sign_in(roll, old_temp)
    post(first_client, "/api/auth/password/",
         {"current_password": old_temp, "new_password": STRONG})
    assert first_client.get("/api/my/profile/").status_code == 200

    reset = post(school.mentor_one, f"/api/students/{school.aarav.id}/account/reset-password/")
    assert reset.status_code == 200 and reset["Cache-Control"] == "no-store"
    new_temp = reset.json()["temporary_password"]
    assert TEMP_SHAPE.match(new_temp) and new_temp != old_temp

    # The old password and the old session are both dead.
    assert sign_in(roll, STRONG)[1].status_code == 400
    assert first_client.get("/api/my/profile/").status_code in (401, 403)

    client, response = sign_in(roll, new_temp)
    assert response.status_code == 200 and response.json()["must_change_password"] is True
    assert client.get("/api/my/profile/").json()["code"] == "password_change_required"


def test_reset_without_a_login_is_refused(school):
    response = post(school.mentor_one, f"/api/students/{school.aarav.id}/account/reset-password/")
    assert response.status_code == 409


def test_reset_reactivates_a_disabled_login(school):
    roll, _ = issued(school)
    User.objects.filter(student=school.aarav).update(is_active=False)
    reset = post(school.mentor_one, f"/api/students/{school.aarav.id}/account/reset-password/")
    assert sign_in(roll, reset.json()["temporary_password"])[1].status_code == 200


def test_a_mentor_cannot_reset_a_colleagues_student(school):
    issued(school, school.bhavna, who="mentor_two")
    response = post(school.mentor_one, f"/api/students/{school.bhavna.id}/account/reset-password/")
    assert response.status_code == 403


# ------------------------------------------------ staff can see who has activated


def test_staff_can_see_who_has_signed_in_and_who_has_not(school):
    def status_of(student):
        rows = school.mentor_one.get("/api/students/").json()["results"]
        return next(r["login_status"] for r in rows if r["id"] == student.id)

    assert status_of(school.aarav) == "none"
    roll, temp = issued(school)
    assert status_of(school.aarav) == "awaiting_first_sign_in"

    client, _ = sign_in(roll, temp)
    post(client, "/api/auth/password/", {"current_password": temp, "new_password": STRONG})
    assert status_of(school.aarav) == "active"

    detail = school.mentor_one.get(f"/api/students/{school.aarav.id}/").json()
    assert detail["login_status"] == "active"


# ---------------------------------------------------------------- throttling


def test_sign_in_attempts_are_limited_per_client(school):
    codes = [sign_in("A-1041", f"guess-{i}")[1].status_code for i in range(12)]
    assert codes[:10] == [400] * 10
    assert codes[10:] == [429, 429]


def test_the_limit_cannot_be_dodged_by_forging_a_forwarded_for_header(school):
    """DRF believes `X-Forwarded-For` unless told how many proxies to trust.
    With zero trusted, every request is the socket's address."""
    client = APIClient()
    codes = [
        client.post("/api/auth/login/", {"username": "A-1041", "password": f"g{i}"},
                    format="json", HTTP_X_FORWARDED_FOR=f"203.0.113.{i}").status_code
        for i in range(12)
    ]
    assert 429 in codes, "rotating X-Forwarded-For defeated the throttle"


def test_a_successful_sign_in_is_not_free_of_the_limit(school):
    """Successes count too: a stolen-password stuffing run mixes both."""
    roll, temp = issued(school)
    codes = [sign_in(roll, temp)[1].status_code for _ in range(12)]
    assert 429 in codes


def test_password_change_attempts_are_limited_per_account(fresh_student):
    codes = [change(fresh_student, STRONG, current=f"wrong-{i}").status_code for i in range(7)]
    assert codes[:5] == [400] * 5
    assert 429 in codes[5:]
