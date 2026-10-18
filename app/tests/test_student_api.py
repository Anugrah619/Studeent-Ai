"""The student app's API (`/api/my/…`) and the walls around it.

What this file is NOT testing is tenant isolation: `test_rls.py` proves one
institute cannot read another's rows. These tests are about the failure RLS
cannot see — two students in the *same* institute, who satisfy every tenant
check on both sides of the fence. Row-level security is happy to show Aarav
Bhavna's record, because they share an institute; only an explicit rule about
who may use the console routes stops it. (OWASP API1:2023, broken
object-level authorization.)

Every test builds its world from `world` below: Aarav and Bhavna, one batch,
one institute, two logins, and *different data*. Two students with identical
data would let a scoping bug pass, so everything they own is deliberately
distinguishable — Aarav lost marks in Chemistry, Bhavna did not.
"""

from __future__ import annotations

import datetime as dt
from types import SimpleNamespace

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.api.serializers import NOT_YOUR_CHAPTER
from apps.derived.models import StudentState, TopicState
from apps.events.models import ConfidenceRating, StudyLog
from apps.syllabus.models import Topic
from apps.syllabus.services import chapters_for_student
from tests import factories as f

TODAY = timezone.localdate()


pytestmark = pytest.mark.usefixtures("fast_password_hasher")


def login(user) -> APIClient:
    client = APIClient()
    client.force_login(user)
    return client


@pytest.fixture
def world(cohort):
    thermo = cohort.chapter("Thermodynamics")        # Chemistry
    kinematics = cohort.chapter("Kinematics")        # Physics
    aarav = f.make_student(cohort, "Aarav Mehta")
    bhavna = f.make_student(cohort, "Bhavna Rao")

    mock1 = f.make_paper(cohort, "Mock 1", dt.date(2026, 8, 1))
    mock2 = f.make_paper(cohort, "Mock 2", dt.date(2026, 9, 1))

    # Chemistry on Mock 1: Aarav 2 right, 4 wrong = 2*4 - 4*1 = 4 marks.
    # Bhavna 6 right = 24. Mock 2 was sat by Bhavna alone.
    f.record(aarav, thermo, "wwwwcc", paper=mock1)
    f.record(bhavna, thermo, "cccccc", paper=mock1)
    f.record(bhavna, kinematics, "cccc", paper=mock2)

    for student, mastery in ((aarav, 0.33), (bhavna, 1.0)):
        TopicState.objects.create(
            institute=cohort.institute, student=student, topic=thermo,
            mastery=mastery, attempts_n=6, correct_n=round(mastery * 6),
        )
        StudentState.objects.create(
            institute=cohort.institute, student=student,
            risk_score=0.9 if student is aarav else 0.1, load_index=1.2,
            balance_index=0.4, consistency=0.7, revision_debt=2,
            mock_avg=88.0, mock_trend=-12.0, syllabus_pct=61.0,
        )

    question = f.ask(mock1, thermo, "Q1", correct="A")
    a_flag = f.FlagFactory(student=aarav, institute=cohort.institute)

    mentor_user = f.make_mentor_user(cohort, "mentor-w")
    return SimpleNamespace(
        cohort=cohort, thermo=thermo, kinematics=kinematics,
        aarav=aarav, bhavna=bhavna, mock1=mock1, mock2=mock2,
        question=question, flag=a_flag,
        a=login(f.make_student_user(aarav, "aarav")),
        b=login(f.make_student_user(bhavna, "bhavna")),
        mentor=login(mentor_user),
    )


def ids(response) -> list[int]:
    assert response.status_code == 200, response.content
    return [row["id"] for row in response.json()["results"]]


# ------------------------------------------------------------------ the wall

#: Every console route a student could previously call. `{other}` is the
#: classmate being snooped on. The student's own id would pass the tenant
#: check too, which is the point: nothing here is about the tenant.
CONSOLE_GETS = [
    "/api/students/",
    "/api/students/{other}/",
    "/api/students/{other}/attempts/",
    "/api/students/{other}/topic-states/",
    "/api/students/{other}/mock-scores/",
    "/api/students/{other}/subject-breakdown/",
    "/api/students/{other}/marks-lost/?paper={paper}",
    "/api/students/{other}/diagnosis/",
    "/api/students/{other}/plan/",
    "/api/flags/",
    "/api/flags/{flag}/",
    "/api/batches/",
    "/api/mentors/",
    "/api/papers/",
    "/api/dashboard/summary/",
    "/api/questions/{question}/",
]

CONSOLE_POSTS = [
    "/api/flags/{flag}/intervene/",
    "/api/flags/{flag}/resolve/",
    "/api/students/{other}/diagnosis/verdict/",
]


def console_path(template: str, w) -> str:
    return template.format(
        other=w.bhavna.id, paper=w.mock1.id, flag=w.flag.id, question=w.question.id
    )


@pytest.mark.parametrize("template", CONSOLE_GETS)
def test_a_student_cannot_read_the_console(world, template):
    """The bug this file exists for: a student reading a classmate.

    Before `IsConsoleUser`, every row of this table answered 200.
    """
    response = world.a.get(console_path(template, world))
    assert response.status_code == 403, f"{template} -> {response.status_code}"


@pytest.mark.parametrize("template", CONSOLE_POSTS)
def test_a_student_cannot_write_through_the_console(world, template):
    response = world.a.post(console_path(template, world), {"verdict": "agree",
                            "outcome": "recovered", "action": "x"}, format="json")
    assert response.status_code == 403, f"{template} -> {response.status_code}"


def test_the_refusal_says_where_to_go(world):
    body = world.a.get("/api/students/").json()
    assert "/api/my/" in body["detail"]


@pytest.mark.parametrize("template", [t for t in CONSOLE_GETS if "diagnosis" not in t])
def test_the_wall_does_not_catch_mentors(world, template):
    """The other half of the guard: a fence that also locks out the people
    it was built for is not a fence, it is an outage. (Diagnosis is left out
    only because a mentor's call reaches the reasoning service.)"""
    response = world.mentor.get(console_path(template, world))
    assert response.status_code == 200, f"{template} -> {response.status_code}"


def test_a_student_still_has_an_identity_route(world):
    me = world.a.get("/api/me/").json()
    assert me["role"] == "student" and me["student_id"] == world.aarav.id


# --------------------------------------------------------- reading my own data


def test_my_mock_scores_are_mine_not_bhavnas(world):
    mine = world.a.get("/api/my/mock-scores/").json()["results"]
    theirs = world.b.get("/api/my/mock-scores/").json()["results"]
    assert [(r["paper_name"], r["chemistry"]) for r in mine] == [("Mock 1", 4.0)]
    assert [(r["paper_name"], r["chemistry"]) for r in theirs] == [
        ("Mock 1", 24.0), ("Mock 2", 0.0),
    ]


def test_my_topic_states_are_mine(world):
    mine = world.a.get("/api/my/topic-states/").json()["results"]
    assert [round(r["mastery"], 2) for r in mine] == [0.33]


def test_weak_filter_applies_to_my_topic_states(world):
    assert len(world.a.get("/api/my/topic-states/?weak=true").json()["results"]) == 1
    assert world.b.get("/api/my/topic-states/?weak=true").json()["results"] == []


def test_my_subject_breakdown_is_three_fixed_rows(world):
    rows = world.a.get("/api/my/subject-breakdown/").json()["results"]
    assert [r["subject"] for r in rows] == ["Physics", "Chemistry", "Maths"]
    assert rows[1]["marks_lost_share_pct"] == 100.0       # all of Aarav's loss is Chemistry


def test_my_marks_lost_is_my_sitting_of_the_paper(world):
    mine = world.a.get(f"/api/my/marks-lost/?paper={world.mock1.id}").json()
    theirs = world.b.get(f"/api/my/marks-lost/?paper={world.mock1.id}").json()
    assert mine["score"] == 4.0 and theirs["score"] == 24.0


def test_a_paper_only_others_sat_looks_exactly_like_no_such_paper(world):
    """No oracle. If a paper sat by Bhavna alone answered differently from a
    paper that does not exist, Aarav could enumerate what his classmates sat."""
    not_mine = world.a.get(f"/api/my/marks-lost/?paper={world.mock2.id}")
    not_real = world.a.get("/api/my/marks-lost/?paper=999999")
    assert not_mine.status_code == not_real.status_code == 404
    assert not_mine.json() == not_real.json()


def test_marks_lost_demands_a_paper(world):
    assert world.a.get("/api/my/marks-lost/").status_code == 400
    assert world.a.get("/api/my/marks-lost/?paper=abc").status_code == 400


@pytest.mark.parametrize("mine, console", [
    ("/api/my/mock-scores/", "/api/students/{id}/mock-scores/"),
    ("/api/my/topic-states/", "/api/students/{id}/topic-states/"),
    ("/api/my/topic-states/?weak=true", "/api/students/{id}/topic-states/?weak=true"),
    ("/api/my/subject-breakdown/", "/api/students/{id}/subject-breakdown/"),
    ("/api/my/marks-lost/?paper={paper}&detail=true",
     "/api/students/{id}/marks-lost/?paper={paper}&detail=true"),
])
def test_my_screen_and_my_mentors_screen_show_the_same_numbers(world, mine, console):
    """A student comparing their app with what their mentor says should never
    find a difference. Both routes call `rollups`, so this holds by
    construction — the test is what keeps it holding if someone forks one."""
    ctx = {"id": world.aarav.id, "paper": world.mock1.id}
    assert world.a.get(mine.format(**ctx)).json() == world.mentor.get(console.format(**ctx)).json()


# ------------------------------------------------------------------- profile


def test_profile_is_mine_and_withholds_the_mentors_numbers(world):
    body = world.a.get("/api/my/profile/").json()
    assert body["name"] == "Aarav Mehta" and body["batch"]["name"] == "Alpha"
    assert body["progress"]["consistency"] == 0.7

    # Pinned on purpose. Whether a student sees a risk band is a product
    # decision; this test makes changing it a deliberate act, not drift.
    for withheld in ("risk_score", "load_index", "balance_index"):
        assert withheld not in body["progress"]


def test_profile_is_for_students_only(world):
    assert world.mentor.get("/api/my/profile/").status_code == 403
    assert APIClient().get("/api/my/profile/").status_code in (401, 403)


def test_profile_without_derived_state_is_null_not_a_crash(cohort):
    fresh = f.make_student(cohort, "New Joiner")
    client = login(f.make_student_user(fresh, "newbie"))
    body = client.get("/api/my/profile/").json()
    assert body["name"] == "New Joiner" and body["progress"] is None


# -------------------------------------------------------------------- topics


def test_topics_lists_my_syllabus_chapters_in_teaching_order(world):
    rows = world.a.get("/api/my/topics/").json()["results"]
    assert len(rows) == 12                                   # 3 subjects x 2 units x 2 chapters
    assert {r["kind"] for r in rows} == {"chapter"}
    assert [r["subject"] for r in rows][:4] == ["Physics"] * 4
    assert rows[0]["name"] == "Kinematics" and rows[0]["unit"] == "Mechanics"


def test_topics_never_includes_another_syllabus(world, other_cohort):
    """Another institute's tree, and a second exam's tree *inside* this
    institute — the case row-level security cannot separate, because both
    belong to the tenant."""
    neet = f.SyllabusVersionFactory(
        institute=world.cohort.institute, exam=f.ExamFactory(code="NEET", name="NEET"),
        version=1, is_active=True,
    )
    biology = f.TopicFactory(syllabus=neet, name="Cell Biology", kind=Topic.CHAPTER)

    # By id, not name: the other institute's tree reuses our chapter names.
    listed = set(ids(world.a.get("/api/my/topics/")))
    assert world.thermo.id in listed
    assert biology.id not in listed
    assert not listed & {chapter.id for chapter in other_cohort.chapters.values()}


def test_a_batch_with_no_pinned_syllabus_falls_back_to_the_active_one(world):
    world.cohort.batch.syllabus = None
    world.cohort.batch.save(update_fields=["syllabus"])
    assert chapters_for_student(world.aarav).count() == 12


def test_topics_carries_the_ncert_links(world):
    ref = [{"class": 11, "subject": "Chemistry", "chapter": 5,
            "pdf": "https://ncert.nic.in/textbook/pdf/kech105.pdf"}]
    Topic.objects.filter(pk=world.thermo.pk).update(ncert_ref=ref)
    row = next(r for r in world.a.get("/api/my/topics/").json()["results"]
               if r["name"] == "Thermodynamics")
    assert row["ncert_ref"] == ref


def test_a_mentor_asking_for_my_lists_gets_an_empty_page(world):
    for route in ("topics", "topic-states", "mock-scores", "subject-breakdown"):
        body = world.mentor.get(f"/api/my/{route}/").json()
        assert body["count"] == 0 and body["results"] == [], route


# ---------------------------------------------------------------- study logs


def study_body(w, **over):
    body = {"topic": w.thermo.id, "minutes": 45, "mode": "learn",
            "ts": timezone.now().isoformat()}
    body.update(over)
    return body


def test_a_student_can_log_study_time(world):
    response = world.a.post("/api/my/study-logs/", study_body(world), format="json")
    assert response.status_code == 201, response.content
    assert response.json()["topic_name"] == "Thermodynamics"

    log = StudyLog.objects.get()
    assert log.student_id == world.aarav.id and log.institute_id == world.cohort.institute.id
    assert ids(world.a.get("/api/my/study-logs/")) == [log.id]
    assert ids(world.b.get("/api/my/study-logs/")) == []


def test_the_body_cannot_name_another_student(world):
    """`student` is not a field, so a client that sends one is ignored — the
    log lands on the account that sent it."""
    body = study_body(world, student=world.bhavna.id, institute=999)
    assert world.a.post("/api/my/study-logs/", body, format="json").status_code == 201
    log = StudyLog.objects.get()
    assert log.student_id == world.aarav.id
    assert log.institute_id == world.cohort.institute.id


@pytest.mark.parametrize("minutes", [0, -5, 721, 10_000_000])
def test_study_minutes_must_be_a_sane_amount(world, minutes):
    response = world.a.post("/api/my/study-logs/", study_body(world, minutes=minutes), format="json")
    assert response.status_code == 400 and "minutes" in response.json()
    assert StudyLog.objects.count() == 0


def test_the_longest_allowed_session_is_accepted(world):
    assert world.a.post("/api/my/study-logs/", study_body(world, minutes=720),
                        format="json").status_code == 201


def test_study_time_cannot_be_logged_in_the_future(world):
    later = (timezone.now() + dt.timedelta(days=1)).isoformat()
    response = world.a.post("/api/my/study-logs/", study_body(world, ts=later), format="json")
    assert response.status_code == 400 and "ts" in response.json()
    assert StudyLog.objects.count() == 0


def test_a_slightly_fast_phone_clock_is_tolerated(world):
    soon = (timezone.now() + dt.timedelta(minutes=1)).isoformat()
    assert world.a.post("/api/my/study-logs/", study_body(world, ts=soon),
                        format="json").status_code == 201


def test_backdating_is_allowed(world):
    """People log in the evening for the afternoon. The model keeps
    `logged_at` so the lag is visible; refusing it would lose real data."""
    earlier = (timezone.now() - dt.timedelta(days=3)).isoformat()
    assert world.a.post("/api/my/study-logs/", study_body(world, ts=earlier),
                        format="json").status_code == 201


def test_only_chapters_of_my_own_syllabus_can_be_logged(world, other_cohort):
    neet = f.SyllabusVersionFactory(
        institute=world.cohort.institute, exam=f.ExamFactory(code="NEET", name="NEET"),
        version=1, is_active=True,
    )
    biology = f.TopicFactory(syllabus=neet, name="Cell Biology", kind=Topic.CHAPTER)
    foreign = other_cohort.chapter("Kinematics")
    a_subject = world.cohort.subjects["Physics"]                 # kind=subject, not a chapter

    for topic_id in (biology.id, foreign.id, a_subject.id, 999_999):
        response = world.a.post("/api/my/study-logs/", study_body(world, topic=topic_id),
                                format="json")
        assert response.status_code == 400, topic_id
        # One message for "not yours", "not a chapter" and "does not exist":
        # distinguishing them would confirm which ids exist elsewhere.
        assert response.json()["topic"] == [NOT_YOUR_CHAPTER], topic_id
    assert StudyLog.objects.count() == 0


def test_a_mentor_posting_a_study_log_is_refused_not_crashed(world):
    """This was a 500: `request.user.student` raised on an account with no
    student, and nothing caught it."""
    response = world.mentor.post("/api/my/study-logs/", study_body(world), format="json")
    assert response.status_code == 403
    assert StudyLog.objects.count() == 0


def test_a_mentor_reading_my_study_logs_gets_an_empty_page(world):
    assert world.mentor.get("/api/my/study-logs/").json()["results"] == []


# ---------------------------------------------------------------- confidence


def test_a_student_can_rate_their_confidence(world):
    response = world.a.post("/api/my/confidence/",
                            {"topic": world.thermo.id, "self_rating": 4}, format="json")
    assert response.status_code == 201, response.content
    rating = ConfidenceRating.objects.get()
    assert (rating.student_id, rating.self_rating) == (world.aarav.id, 4)
    assert ids(world.a.get("/api/my/confidence/")) == [rating.id]
    assert ids(world.b.get("/api/my/confidence/")) == []


def test_the_server_stamps_the_rating_not_the_client(world):
    """The feature store takes the *latest* rating by `ts`. A client that
    could set `ts` could pin a rating for ever by dating it next year."""
    next_year = (timezone.now() + dt.timedelta(days=365)).isoformat()
    world.a.post("/api/my/confidence/",
                 {"topic": world.thermo.id, "self_rating": 5, "ts": next_year}, format="json")
    stamped = ConfidenceRating.objects.get().ts
    assert abs((timezone.now() - stamped).total_seconds()) < 60


def test_rating_again_adds_a_row_and_the_latest_leads(world):
    for value in (2, 5):
        world.a.post("/api/my/confidence/",
                     {"topic": world.thermo.id, "self_rating": value}, format="json")
    ratings = [r["self_rating"] for r in world.a.get("/api/my/confidence/").json()["results"]]
    assert ratings == [5, 2]                                     # history kept, newest first


@pytest.mark.parametrize("value", [0, 6, -1])
def test_a_rating_is_one_to_five(world, value):
    response = world.a.post("/api/my/confidence/",
                            {"topic": world.thermo.id, "self_rating": value}, format="json")
    assert response.status_code == 400 and ConfidenceRating.objects.count() == 0


def test_confidence_is_only_for_my_own_chapters(world, other_cohort):
    response = world.a.post(
        "/api/my/confidence/",
        {"topic": other_cohort.chapter("Kinematics").id, "self_rating": 3}, format="json",
    )
    assert response.status_code == 400 and response.json()["topic"] == [NOT_YOUR_CHAPTER]


def test_a_mentor_cannot_rate_on_behalf_of_nobody(world):
    response = world.mentor.post("/api/my/confidence/",
                                 {"topic": world.thermo.id, "self_rating": 3}, format="json")
    assert response.status_code == 403


# ---------------------------------------------------------------------- plan


def test_garbage_dates_are_a_400_not_a_500(world):
    for path in ("/api/my/plan/", "/api/students/{id}/plan/"):
        url = path.format(id=world.aarav.id)
        client = world.a if "/my/" in path else world.mentor
        for bad in ("garbage", "2026-13-45", "01/02/2026"):
            response = client.get(f"{url}?date={bad}")
            assert response.status_code == 400, (url, bad, response.status_code)
            assert "date" in response.json()


def test_plan_lists_only_my_blocks_for_the_day(world):
    mine = f.PlanBlockFactory(student=world.aarav, topic=world.thermo)
    f.PlanBlockFactory(student=world.bhavna, topic=world.thermo)
    f.PlanBlockFactory(student=world.aarav, topic=world.thermo,
                       date=TODAY - dt.timedelta(days=1))
    assert ids(world.a.get("/api/my/plan/")) == [mine.id]


def test_a_student_can_tick_off_a_block_from_another_day(world):
    """`complete` used to share the day-scoped queryset, so ticking a block
    on yesterday's plan was a 404 for a block that was plainly theirs."""
    yesterday = f.PlanBlockFactory(student=world.aarav, topic=world.thermo,
                                   date=TODAY - dt.timedelta(days=1))
    response = world.a.post(f"/api/my/plan/{yesterday.id}/complete/")
    assert response.status_code == 200 and response.json()["completed"] is True
    yesterday.refresh_from_db()
    assert yesterday.completed


def test_completing_twice_changes_nothing(world):
    block = f.PlanBlockFactory(student=world.aarav, topic=world.thermo)
    for _ in range(2):
        assert world.a.post(f"/api/my/plan/{block.id}/complete/").status_code == 200
    block.refresh_from_db()
    assert block.completed


def test_i_cannot_complete_someone_elses_block(world):
    theirs = f.PlanBlockFactory(student=world.bhavna, topic=world.thermo)
    response = world.a.post(f"/api/my/plan/{theirs.id}/complete/")
    assert response.status_code == 404
    theirs.refresh_from_db()
    assert not theirs.completed


def test_a_malformed_block_id_does_not_route(world):
    assert world.a.post("/api/my/plan/abc/complete/").status_code == 404


def test_a_mentor_cannot_complete_a_block(world):
    block = f.PlanBlockFactory(student=world.aarav, topic=world.thermo)
    assert world.mentor.post(f"/api/my/plan/{block.id}/complete/").status_code == 403
    block.refresh_from_db()
    assert not block.completed


def test_a_mentor_still_gets_an_empty_page_from_the_student_plan(world):
    f.PlanBlockFactory(student=world.aarav, topic=world.thermo)
    assert world.mentor.get("/api/my/plan/").json()["results"] == []


# ---------------------------------------------- the mentor's view of the plan


def test_a_mentor_can_read_a_students_plan_in_start_order(world):
    late = f.PlanBlockFactory(student=world.aarav, topic=world.thermo, start_time=dt.time(18, 0))
    early = f.PlanBlockFactory(student=world.aarav, topic=world.thermo, start_time=dt.time(7, 0))
    f.PlanBlockFactory(student=world.bhavna, topic=world.thermo)
    assert ids(world.mentor.get(f"/api/students/{world.aarav.id}/plan/")) == [early.id, late.id]


def test_the_mentors_plan_and_the_students_plan_are_the_same_rows(world):
    f.PlanBlockFactory(student=world.aarav, topic=world.thermo, start_time=dt.time(9, 0))
    mine = world.a.get("/api/my/plan/").json()
    console = world.mentor.get(f"/api/students/{world.aarav.id}/plan/").json()
    assert mine == console


def test_a_mentor_cannot_read_another_institutes_plan(world, other_cohort):
    stranger = f.make_student(other_cohort, "Stranger")
    f.PlanBlockFactory(student=stranger, topic=other_cohort.chapter("Kinematics"))
    body = world.mentor.get(f"/api/students/{stranger.id}/plan/").json()
    assert body["count"] == 0


# ----------------------------------------------------------------- revisions


def test_revisions_are_mine_overdue_first_and_filterable(world):
    overdue = f.revision(world.aarav, world.thermo, 1, TODAY - dt.timedelta(days=3))
    later = f.revision(world.aarav, world.kinematics, 1, TODAY + dt.timedelta(days=2))
    done = f.revision(world.aarav, world.thermo, 2, TODAY - dt.timedelta(days=9),
                      done_at=timezone.now() - dt.timedelta(days=9))
    f.revision(world.bhavna, world.thermo, 1, TODAY - dt.timedelta(days=1))

    assert ids(world.a.get("/api/my/revisions/")) == [done.id, overdue.id, later.id]
    assert ids(world.a.get("/api/my/revisions/?pending=true")) == [overdue.id, later.id]

    rows = {r["id"]: r for r in world.a.get("/api/my/revisions/").json()["results"]}
    assert rows[overdue.id]["is_overdue"] is True
    assert rows[later.id]["is_overdue"] is False
    assert rows[done.id]["is_overdue"] is False
    assert rows[overdue.id]["topic"]["subject"] == "Chemistry"


# ------------------------------------------------ marking a revision done


def test_a_student_can_mark_a_revision_done(world):
    revision = f.revision(world.aarav, world.thermo, 1, TODAY - dt.timedelta(days=2))
    response = world.a.post(f"/api/my/revisions/{revision.id}/complete/")
    assert response.status_code == 200, response.content
    assert response.json()["done_at"] is not None
    assert response.json()["is_overdue"] is False                # done is not overdue
    revision.refresh_from_db()
    assert revision.done_at is not None


def test_completing_twice_does_not_move_the_timestamp(world):
    """Write-once is the whole justification for letting an API touch an
    event-log row at all: null becomes a time, and then it never changes."""
    revision = f.revision(world.aarav, world.thermo, 1, TODAY - dt.timedelta(days=2))
    first = world.a.post(f"/api/my/revisions/{revision.id}/complete/").json()["done_at"]
    second = world.a.post(f"/api/my/revisions/{revision.id}/complete/").json()["done_at"]
    assert first == second


def test_the_first_completion_wins_when_one_is_already_recorded(world):
    original = timezone.now() - dt.timedelta(days=5)
    revision = f.revision(world.aarav, world.thermo, 1, TODAY - dt.timedelta(days=6),
                          done_at=original)
    world.a.post(f"/api/my/revisions/{revision.id}/complete/")
    revision.refresh_from_db()
    assert revision.done_at == original


def test_i_cannot_complete_someone_elses_revision(world):
    theirs = f.revision(world.bhavna, world.thermo, 1, TODAY - dt.timedelta(days=1))
    assert world.a.post(f"/api/my/revisions/{theirs.id}/complete/").status_code == 404
    theirs.refresh_from_db()
    assert theirs.done_at is None


def test_a_mentor_cannot_complete_a_revision(world):
    revision = f.revision(world.aarav, world.thermo, 1, TODAY - dt.timedelta(days=1))
    assert world.mentor.post(f"/api/my/revisions/{revision.id}/complete/").status_code == 403


def test_a_revision_has_no_other_way_to_change(world):
    """`complete` is the one permitted write. There is still no generic
    update or delete on the event log."""
    revision = f.revision(world.aarav, world.thermo, 1, TODAY - dt.timedelta(days=1))
    for method in (world.a.patch, world.a.put, world.a.delete):
        assert method(f"/api/my/revisions/{revision.id}/").status_code in (404, 405)
    revision.refresh_from_db()
    assert revision.done_at is None


def test_completing_a_revision_clears_it_from_my_revision_debt(world):
    from apps.derived.services import features

    revision = f.revision(world.aarav, world.thermo, 1, TODAY - dt.timedelta(days=3))
    features.recompute(world.cohort.institute.id, [world.aarav.id])
    assert StudentState.objects.get(student=world.aarav).revision_debt == 1

    assert world.a.post(f"/api/my/revisions/{revision.id}/complete/").status_code == 200
    assert StudentState.objects.get(student=world.aarav).revision_debt == 0


# ---------------------------------------------------------- undoing a tick


def test_a_tick_can_be_undone(world):
    block = f.PlanBlockFactory(student=world.aarav, topic=world.thermo, completed=True)
    response = world.a.post(f"/api/my/plan/{block.id}/uncomplete/")
    assert response.status_code == 200 and response.json()["completed"] is False
    block.refresh_from_db()
    assert not block.completed


def test_undoing_an_unticked_block_changes_nothing(world):
    block = f.PlanBlockFactory(student=world.aarav, topic=world.thermo)
    assert world.a.post(f"/api/my/plan/{block.id}/uncomplete/").status_code == 200
    block.refresh_from_db()
    assert not block.completed


def test_i_cannot_untick_someone_elses_block_and_a_mentor_cannot_at_all(world):
    theirs = f.PlanBlockFactory(student=world.bhavna, topic=world.thermo, completed=True)
    assert world.a.post(f"/api/my/plan/{theirs.id}/uncomplete/").status_code == 404
    assert world.mentor.post(f"/api/my/plan/{theirs.id}/uncomplete/").status_code == 403
    theirs.refresh_from_db()
    assert theirs.completed


# -------------------------------------------------------- what was done about a flag


def test_a_mentor_can_read_back_the_interventions_on_a_flag(world):
    from apps.derived.models import Intervention

    mentor = world.cohort.mentor
    first = Intervention.objects.create(flag=world.flag, mentor=mentor, action="Called parent",
                                        taken_at=timezone.now() - dt.timedelta(days=2))
    second = Intervention.objects.create(flag=world.flag, mentor=mentor, action="Extra doubt class",
                                         taken_at=timezone.now() - dt.timedelta(days=1))
    rows = world.mentor.get(f"/api/flags/{world.flag.id}/interventions/").json()["results"]
    assert [r["id"] for r in rows] == [second.id, first.id]          # newest first
    assert rows[0]["action"] == "Extra doubt class"
    assert rows[0]["mentor_name"] == mentor.name


def test_interventions_are_closed_to_students_and_to_other_institutes(world, other_cohort):
    assert world.a.get(f"/api/flags/{world.flag.id}/interventions/").status_code == 403
    stranger = f.make_student(other_cohort, "Stranger")
    foreign = f.FlagFactory(student=stranger, institute=other_cohort.institute)
    assert world.mentor.get(f"/api/flags/{foreign.id}/interventions/").status_code == 404


def test_the_flag_that_was_just_acted_on_shows_its_own_action(world):
    world.mentor.post(f"/api/flags/{world.flag.id}/intervene/",
                      {"action": "Moved to the evening batch"}, format="json")
    rows = world.mentor.get(f"/api/flags/{world.flag.id}/interventions/").json()["results"]
    assert [r["action"] for r in rows] == ["Moved to the evening batch"]


# ----------------------------------------------- a mentor reads a student's logs


def test_a_mentor_reads_a_students_study_log_and_nobody_elses(world):
    mine = f.study(world.aarav, world.thermo, 40, timezone.now() - dt.timedelta(hours=3))
    f.study(world.bhavna, world.thermo, 90, timezone.now())
    assert ids(world.mentor.get(f"/api/students/{world.aarav.id}/study-logs/")) == [mine.id]


def test_a_mentor_reads_confidence_history_newest_first(world):
    older = f.rate(world.aarav, world.thermo, 2, ts=timezone.now() - dt.timedelta(days=3))
    newer = f.rate(world.aarav, world.thermo, 5, ts=timezone.now() - dt.timedelta(days=1))
    f.rate(world.bhavna, world.thermo, 4)
    assert ids(world.mentor.get(f"/api/students/{world.aarav.id}/confidence/")) == [newer.id, older.id]


def test_a_mentor_reads_a_students_revisions(world):
    overdue = f.revision(world.aarav, world.thermo, 1, TODAY - dt.timedelta(days=4))
    done = f.revision(world.aarav, world.kinematics, 1, TODAY - dt.timedelta(days=9),
                      done_at=timezone.now() - dt.timedelta(days=8))
    path = f"/api/students/{world.aarav.id}/revisions/"
    assert ids(world.mentor.get(path)) == [done.id, overdue.id]
    assert ids(world.mentor.get(path + "?pending=true")) == [overdue.id]


@pytest.mark.parametrize("route", ["study-logs", "confidence", "revisions"])
def test_a_mentor_cannot_read_another_institutes_student_logs(world, other_cohort, route):
    stranger = f.make_student(other_cohort, "Stranger")
    f.study(stranger, other_cohort.chapter("Kinematics"), 30, timezone.now())
    f.rate(stranger, other_cohort.chapter("Kinematics"), 3)
    f.revision(stranger, other_cohort.chapter("Kinematics"), 1, TODAY)
    assert world.mentor.get(f"/api/students/{stranger.id}/{route}/").json()["count"] == 0


@pytest.mark.parametrize("route", ["study-logs", "confidence", "revisions"])
def test_these_mentor_routes_are_closed_to_students(world, route):
    assert world.a.get(f"/api/students/{world.bhavna.id}/{route}/").status_code == 403


# ---------------------------------------------------- reviewing my own mistakes


@pytest.fixture
def reviewed(world):
    """Aarav answered Q9 wrongly (chose B) on a paper with real content; the
    wrong option is tagged with a misconception. Bhavna alone sat Mock 2."""
    mis = f.misconception("MIS-TEST-ENTROPY", subject="Chemistry", name="Entropy always rises")
    q = f.ask(world.mock1, world.thermo, "Q9", "Which is spontaneous?", correct="A",
              baits={"B": mis}, solution="Compute delta G.")
    f.answer(world.aarav, q, "B")
    world.q9 = q
    world.mis = mis
    return world


def test_my_attempts_are_mine_and_carry_the_id_that_opens_the_question(reviewed):
    w = reviewed
    rows = w.a.get(f"/api/my/attempts/?paper={w.mock1.id}").json()["results"]
    q9 = next(r for r in rows if r["question_id"] == "Q9")
    assert q9["question_pk"] == w.q9.id and q9["chosen_option"] == "B"
    assert q9["status"] == "wrong" and q9["paper_name"] == "Mock 1"
    # Q1 has content too (the shared fixture made it); every other answer
    # on this paper is a bare score with no question behind it.
    by_label = {r["question_id"]: r["question_pk"] for r in rows}
    assert by_label["Q1"] == w.question.id
    assert all(pk is None for label, pk in by_label.items() if label not in ("Q1", "Q9"))
    # Bhavna's answers are not in his list, nor his in hers.
    assert {r["id"] for r in rows}.isdisjoint(
        {r["id"] for r in w.b.get("/api/my/attempts/").json()["results"]}
    )


def test_attempts_filter_by_outcome(reviewed):
    w = reviewed
    wrong = w.a.get("/api/my/attempts/?status=wrong").json()["results"]
    assert wrong and {r["status"] for r in wrong} == {"wrong"}


@pytest.mark.parametrize("query", ["paper=abc", "status=bogus"])
def test_attempt_filters_reject_nonsense(reviewed, query):
    assert reviewed.a.get(f"/api/my/attempts/?{query}").status_code == 400


def test_i_can_open_a_question_i_answered_and_see_the_key_and_the_working(reviewed):
    w = reviewed
    body = w.a.get(f"/api/my/questions/{w.q9.id}/").json()
    assert body["label"] == "Q9" and body["solution"] == "Compute delta G."
    assert body["chosen_label"] == "B" and body["status"] == "wrong"
    options = {o["label"]: o for o in body["options"]}
    assert options["A"]["is_correct"] is True and options["B"]["chosen"] is True
    assert options["A"]["chosen"] is False


def test_a_students_question_never_carries_the_misconception(reviewed):
    """Held back on purpose, and pinned: the mentor's view explains why a
    wrong option was tempting; the student's gets the answer, not the theory
    of their mind. Whether to change that is a product decision."""
    w = reviewed
    raw = w.a.get(f"/api/my/questions/{w.q9.id}/").content.decode()
    assert "misconception" not in raw and w.mis.name not in raw and w.mis.code not in raw
    # …while the mentor's view of the same question still has it.
    console = w.mentor.get(f"/api/questions/{w.q9.id}/?student={w.aarav.id}").json()
    assert next(o for o in console["options"] if o["label"] == "B")["misconception"]["code"] \
        == "MIS-TEST-ENTROPY"


def test_a_question_i_never_answered_is_a_404_identical_to_a_missing_one(reviewed):
    """Otherwise the route is a way to read the key and solution of a paper
    I have not sat yet, or to ask which papers the institute holds."""
    w = reviewed
    unanswered = f.ask(w.mock2, w.kinematics, "Q1", "Secret question", correct="C")
    f.answer(w.bhavna, unanswered, "C")                          # someone else sat it
    theirs = w.a.get(f"/api/my/questions/{unanswered.id}/")
    nowhere = w.a.get("/api/my/questions/999999/")
    assert theirs.status_code == nowhere.status_code == 404
    assert theirs.json() == nowhere.json()
    assert "Secret question" not in theirs.content.decode()


def test_another_institutes_question_is_a_404(reviewed, other_cohort):
    paper = f.make_paper(other_cohort, "Theirs", dt.date(2026, 8, 1))
    foreign = f.ask(paper, other_cohort.chapter("Kinematics"), "Q1", "Foreign stem")
    assert reviewed.a.get(f"/api/my/questions/{foreign.id}/").status_code == 404


def test_question_review_is_for_students_only(reviewed):
    assert reviewed.mentor.get(f"/api/my/questions/{reviewed.q9.id}/").status_code == 403


# ---------------------------------------------------------------- throttling


def test_a_students_writes_are_rate_limited_but_their_reads_are_not(world, monkeypatch):
    from rest_framework.throttling import ScopedRateThrottle

    monkeypatch.setitem(ScopedRateThrottle.THROTTLE_RATES, "student_write", "3/hour")
    codes = [world.a.post("/api/my/study-logs/", study_body(world), format="json").status_code
             for _ in range(5)]
    assert codes == [201, 201, 201, 429, 429]
    assert world.a.get("/api/my/study-logs/").status_code == 200       # reading is free
    # The two write routes share a budget; the limit is per student, not per route.
    assert world.a.post("/api/my/confidence/",
                        {"topic": world.thermo.id, "self_rating": 3}, format="json").status_code == 429
    # …and another student is unaffected.
    assert world.b.post("/api/my/study-logs/", study_body(world), format="json").status_code == 201
