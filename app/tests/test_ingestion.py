"""Getting an institute's own results in: paper → blueprint → results file.

The promises under test, in the order an upload meets them:

* A blueprint is all-or-nothing, and a key cannot change under recorded answers.
* A results file is read against it. An unmapped question stops the whole
  upload; a bad cell fails only that student — and *all* of that student.
* Sending the same thing twice, or an overlapping correction, never doubles an
  answer.
* The data that arrives is the data the rest of the system can use: marks per
  subject, marks-lost, derived state.
"""

from __future__ import annotations

import datetime as dt

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.derived.models import TopicState
from apps.events.models import Attempt
from apps.ingestion.models import ColumnMappingProfile, IngestBatch, QuestionTopicMap
from apps.ingestion.models import TestPaper as Paper
from apps.syllabus.models import Topic
from tests import factories as f

pytestmark = pytest.mark.usefixtures("fast_password_hasher")

BLUEPRINT = """question_id,chapter,correct_option,answer
Q1,Kinematics,B,
Q2,Kinematics,A,
Q3,Thermodynamics,D,
Q4,Limits,,7
"""

#: Aarav gets everything right (16). Bhavna: wrong, skipped, ran out of time,
#: wrong number (-2). Chirag: option written as "2" (= B, right), lower-case
#: "b" (wrong, key is A), blank, and a right number written "7.0" (7).
RESULTS = """Roll No,Name,Q1,Q2,Q3,Q4,Total
A-1,Aarav,B,A,D,7,16
A-2,Bhavna,C,-,NR,8,-2
A-3,Chirag,2,b,,7.0,7
"""


def upload(text, name="results.csv", encoding="utf-8"):
    return SimpleUploadedFile(name, text.encode(encoding), content_type="text/csv")


@pytest.fixture
def lab(cohort, mentor_client):
    students = {
        roll: f.make_student(cohort, name, roll_no=roll)
        for name, roll in [("Aarav", "A-1"), ("Bhavna", "A-2"), ("Chirag", "A-3")]
    }
    response = mentor_client.post(
        "/api/papers/", {"name": "Mock 15", "exam": "JEE_MAIN", "held_on": "2026-10-04"},
        format="json",
    )
    assert response.status_code == 201, response.content
    paper = Paper.objects.get(pk=response.json()["id"])
    return type("Lab", (), dict(cohort=cohort, client=mentor_client, paper=paper, students=students))


def post_blueprint(lab, text=BLUEPRINT, **extra):
    return lab.client.post(
        f"/api/papers/{lab.paper.id}/blueprint/", {"file": upload(text), **extra}, format="multipart"
    )


def post_results(lab, text=RESULTS, **extra):
    return lab.client.post(
        "/api/ingest/results/", {"file": upload(text), "paper": lab.paper.id, **extra},
        format="multipart",
    )


@pytest.fixture
def ready(lab):
    """A paper with its blueprint applied."""
    assert post_blueprint(lab).status_code == 200
    return lab


def attempts_of(lab, roll):
    return {a.question_id: a for a in Attempt.objects.filter(student=lab.students[roll],
                                                            test_paper=lab.paper)}


# -------------------------------------------------------------- the paper


def test_an_institute_creates_its_own_paper(lab):
    paper = lab.paper
    assert paper.source == "institute" and paper.institute_id == lab.cohort.institute.id
    # Marking defaults to the exam's scheme; the caller never had to say.
    assert (paper.marks_correct, paper.marks_wrong, paper.max_marks) == (4, -1, 300)
    listed = lab.client.get("/api/papers/").json()["results"]
    assert next(p for p in listed if p["id"] == paper.id)["source"] == "institute"


def test_a_paper_cannot_be_made_twice_on_the_same_day(lab):
    response = lab.client.post(
        "/api/papers/", {"name": "mock 15", "exam": "JEE_MAIN", "held_on": "2026-10-04"},
        format="json",
    )
    assert response.status_code == 400 and "name" in response.json()


@pytest.mark.parametrize("body", [
    {"name": "X", "exam": "NOPE", "held_on": "2026-10-04"},
    {"name": "X", "exam": "JEE_MAIN", "held_on": "not-a-date"},
    {"name": "X", "exam": "JEE_MAIN", "held_on": "2026-10-04", "marks_wrong": 1},
    {"name": "X", "exam": "JEE_MAIN", "held_on": "2026-10-04", "total_questions": 0},
])
def test_a_malformed_paper_is_refused(lab, body):
    assert lab.client.post("/api/papers/", body, format="json").status_code == 400


def test_a_student_cannot_create_papers(lab):
    client = APIClient()
    client.force_login(f.make_student_user(lab.students["A-1"], "aarav"))
    assert client.post("/api/papers/", {"name": "X", "exam": "JEE_MAIN", "held_on": "2026-10-05"},
                       format="json").status_code == 403


# -------------------------------------------------------------- blueprint


def test_a_blueprint_maps_every_question_to_a_chapter_and_a_key(lab):
    response = post_blueprint(lab)
    assert response.status_code == 200, response.content
    body = response.json()
    assert (body["created"], body["updated"], body["unchanged"]) == (4, 0, 0)
    assert body["questions_in_file"] == 4 and body["expected_questions"] == 75

    q1 = QuestionTopicMap.objects.get(test_paper=lab.paper, question_id="Q1")
    assert q1.topic.name == "Kinematics" and q1.source == "institute"
    assert q1.confirmed_at is not None and q1.confirmed_by is not None
    assert {o.label: o.is_correct for o in q1.options.all()} == {
        "A": False, "B": True, "C": False, "D": False}
    q4 = QuestionTopicMap.objects.get(test_paper=lab.paper, question_id="Q4")
    assert q4.answer_type == "numerical" and q4.numeric_answer == 7.0 and not q4.options.exists()


def test_uploading_the_same_blueprint_again_changes_nothing(ready):
    body = post_blueprint(ready).json()
    assert (body["created"], body["updated"], body["unchanged"]) == (0, 0, 4)
    assert QuestionTopicMap.objects.filter(test_paper=ready.paper).count() == 4


def test_a_dry_run_blueprint_writes_nothing(lab):
    response = post_blueprint(lab, dry_run="true")
    assert response.status_code == 200 and response.json()["created"] == 4
    assert not QuestionTopicMap.objects.filter(test_paper=lab.paper).exists()


def test_one_bad_row_writes_nothing_and_every_problem_is_listed(lab):
    text = BLUEPRINT + "Q5,No Such Chapter,A,\nQ1,Kinematics,A,\nQ6,Limits,Z,\nQ7,Limits,,abc\n"
    response = post_blueprint(lab, text)
    assert response.status_code == 422
    body = response.json()
    assert body["ok"] is False and body["errors_total"] == 4
    messages = " | ".join(e["message"] for e in body["errors"])
    assert "No Such Chapter" in messages and "appears twice" in messages
    assert "'Z' is not one of" in messages and "'abc' is not a number" in messages
    assert not QuestionTopicMap.objects.filter(test_paper=lab.paper).exists(), "partly applied"


def test_a_chapter_name_in_two_subjects_needs_a_subject(lab):
    physics_unit = lab.cohort.units["Mechanics"]
    f.TopicFactory(syllabus=lab.cohort.syllabus, parent=physics_unit, name="Thermodynamics",
                   kind=Topic.CHAPTER)
    text = "question_id,chapter,correct_option\nQ1,Thermodynamics,A\n"
    refused = post_blueprint(lab, text)
    assert refused.status_code == 422 and "more than one subject" in refused.json()["errors"][0]["message"]

    resolved = post_blueprint(lab, "question_id,chapter,subject,correct_option\nQ1,Thermodynamics,Physics,A\n")
    assert resolved.status_code == 200
    assert QuestionTopicMap.objects.get(test_paper=lab.paper, question_id="Q1").subject_name == "Physics"


def test_numeric_option_labels_are_read_as_letters(lab):
    post_blueprint(lab, "question_id,chapter,correct_option\nQ1,Kinematics,2\n")
    q = QuestionTopicMap.objects.get(test_paper=lab.paper, question_id="Q1")
    assert q.options.get(is_correct=True).label == "B"


def test_a_blueprint_with_missing_columns_says_which(lab):
    response = post_blueprint(lab, "question_id,chapter\nQ1,Kinematics\n")
    assert response.status_code == 422
    assert "no answer column" in response.json()["errors"][0]["message"]


def test_a_key_can_be_corrected_until_students_have_answered(ready):
    fixed = post_blueprint(ready, BLUEPRINT.replace("Q1,Kinematics,B", "Q1,Kinematics,C"))
    assert fixed.status_code == 200 and fixed.json()["updated"] == 1
    q1 = QuestionTopicMap.objects.get(test_paper=ready.paper, question_id="Q1")
    assert q1.options.get(is_correct=True).label == "C"
    assert q1.options.count() == 4, "options duplicated by the update"

    assert post_results(ready).status_code == 201
    refused = post_blueprint(ready, BLUEPRINT.replace("Q1,Kinematics,C", "Q1,Kinematics,D"))
    assert refused.status_code == 422
    assert "already have answers" in refused.json()["errors"][0]["message"]
    assert QuestionTopicMap.objects.get(test_paper=ready.paper, question_id="Q1") \
        .options.get(is_correct=True).label == "C"


def test_a_difficulty_label_may_change_under_recorded_answers(ready):
    post_results(ready)
    relabelled = post_blueprint(ready, "question_id,chapter,correct_option,answer,difficulty\n"
                                       "Q1,Kinematics,B,,hard\nQ2,Kinematics,A,,\nQ3,Thermodynamics,D,,\nQ4,Limits,,7,\n")
    assert relabelled.status_code == 200, relabelled.content
    assert QuestionTopicMap.objects.get(test_paper=ready.paper, question_id="Q1").difficulty == "hard"


@pytest.mark.parametrize("payload, why", [
    (b"", "empty"),
    (b"PK\x03\x04 pretend workbook", "an xlsx"),
    (b"\xd0\xcf\x11\xe0 pretend legacy workbook", "a legacy xls"),
    (b"a,b\n\x00,1\n", "binary"),
    (b"question_id,chapter,correct_option\n", "no data rows"),
])
def test_unreadable_files_get_a_sentence_not_a_traceback(lab, payload, why):
    response = lab.client.post(
        f"/api/papers/{lab.paper.id}/blueprint/",
        {"file": SimpleUploadedFile("b.csv", payload)}, format="multipart",
    )
    assert response.status_code == 400, why
    body = response.json()
    # DRF itself refuses a zero-byte upload, in terms of the field; every
    # other case reaches our reader, which answers in a `detail` sentence.
    assert body.get("detail") or body.get("file"), why


def test_the_workbook_message_says_what_to_do(lab):
    response = lab.client.post(f"/api/papers/{lab.paper.id}/blueprint/",
                               {"file": SimpleUploadedFile("b.xlsx", b"PK\x03\x04...")}, format="multipart")
    assert "Save As" in response.json()["detail"] and "CSV" in response.json()["detail"]


def test_blueprints_belong_to_the_callers_institute(lab, other_cohort):
    stranger = APIClient()
    stranger.force_login(f.make_mentor_user(other_cohort, "stranger-mentor"))
    response = stranger.post(f"/api/papers/{lab.paper.id}/blueprint/",
                             {"file": upload(BLUEPRINT)}, format="multipart")
    assert response.status_code == 404
    assert not QuestionTopicMap.objects.filter(test_paper=lab.paper).exists()


# ------------------------------------------------------------- results: wide


def test_results_become_marked_attempts(ready):
    response = post_results(ready)
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["layout"] == "wide" and body["ok"] is True
    assert (body["students_in_file"], body["students_ingested"], body["students_failed"]) == (3, 3, 0)
    assert body["attempts_created"] == 12 and body["ignored_columns"] == ["Name", "Total"]
    assert body["batch_id"] is not None and body["errors_total"] == 0

    a = attempts_of(ready, "A-1")
    assert {q: x.status for q, x in a.items()} == {q: "correct" for q in ("Q1", "Q2", "Q3", "Q4")}
    assert sum(x.marks for x in a.values()) == 16
    assert a["Q1"].chosen_option == "B" and a["Q1"].topic.name == "Kinematics"
    assert a["Q1"].source == "mock" and a["Q1"].institute_id == ready.cohort.institute.id

    b = attempts_of(ready, "A-2")
    assert [b[q].status for q in ("Q1", "Q2", "Q3", "Q4")] == ["wrong", "blank", "not_reached", "wrong"]
    assert sum(x.marks for x in b.values()) == -2
    assert b["Q2"].chosen_option == "" and b["Q1"].chosen_option == "C"

    c = attempts_of(ready, "A-3")
    assert [c[q].status for q in ("Q1", "Q2", "Q3", "Q4")] == ["correct", "wrong", "blank", "correct"]
    assert c["Q1"].chosen_option == "B", "the digit 2 should have been read as option B"
    assert sum(x.marks for x in c.values()) == 7


def test_the_sitting_is_dated_the_day_of_the_paper_and_traces_to_its_batch(ready):
    batch_id = post_results(ready).json()["batch_id"]
    attempt = Attempt.objects.filter(test_paper=ready.paper).first()
    assert attempt.ts.astimezone().date() == dt.date(2026, 10, 4)
    batch = IngestBatch.objects.get(pk=batch_id)
    assert attempt.ingest_batch_id == batch_id
    assert (batch.rows_ok, batch.rows_failed, batch.status) == (3, 0, "done")
    assert batch.raw_snapshot["header"][0] == "Roll No" and len(batch.raw_snapshot["rows"]) == 3


def test_what_arrives_is_usable_by_the_rest_of_the_system(ready):
    body = post_results(ready).json()
    assert body["derived_refreshed"] is True and isinstance(body["flags_raised"], int)

    aarav = ready.students["A-1"]
    scores = ready.client.get(f"/api/students/{aarav.id}/mock-scores/").json()["results"]
    assert scores == [{"paper_id": ready.paper.id, "paper_name": "Mock 15", "held_on": "2026-10-04",
                       "physics": 8.0, "chemistry": 4.0, "maths": 4.0, "total": 16.0,
                       "subjects": [{"subject": "Physics", "marks": 8.0},
                                    {"subject": "Chemistry", "marks": 4.0},
                                    {"subject": "Maths", "marks": 4.0}]}]
    lost = ready.client.get(f"/api/students/{ready.students['A-2'].id}/marks-lost/?paper={ready.paper.id}")
    assert lost.status_code == 200 and lost.json()["score"] == -2.0
    assert TopicState.objects.filter(student=aarav).exists(), "derived state was not refreshed"


def test_sending_the_same_file_twice_is_refused_and_nothing_doubles(ready):
    first = post_results(ready)
    again = post_results(ready)
    assert again.status_code == 409
    assert again.json()["batch_id"] == first.json()["batch_id"]
    assert "already imported" in again.json()["detail"]
    assert Attempt.objects.filter(test_paper=ready.paper).count() == 12
    assert IngestBatch.objects.count() == 1


def test_an_overlapping_correction_adds_only_what_is_new(ready):
    """The first file lacked Bhavna's last two answers; the corrected one has
    all four. Different file, so it is accepted — but the two answers she
    already had are skipped, not recorded twice."""
    partial = "Roll No,Q1,Q2\nA-2,C,-\n"
    assert post_results(ready, partial).status_code == 201
    assert Attempt.objects.filter(test_paper=ready.paper).count() == 2

    full = post_results(ready, "Roll No,Q1,Q2,Q3,Q4\nA-2,C,-,NR,8\n")
    assert full.status_code == 201
    body = full.json()
    assert body["attempts_created"] == 2 and body["attempts_already_recorded"] == 2
    assert Attempt.objects.filter(test_paper=ready.paper, student=ready.students["A-2"]).count() == 4


def test_a_file_that_adds_nothing_new_is_not_an_error(ready):
    post_results(ready, "Roll No,Q1\nA-1,B\n")
    body = post_results(ready, "Roll No,Q1,Name\nA-1,B,Aarav\n")           # different bytes, same answers
    assert body.status_code in (200, 201)
    assert body.json()["students_already_recorded"] == 1 and body.json()["attempts_created"] == 0


def test_one_bad_cell_fails_that_student_wholly_and_only_that_student(ready):
    text = "Roll No,Q1,Q2,Q3,Q4\nA-1,B,A,D,7\nA-2,E,A,D,7\nA-3,B,A,D,7\n"
    response = post_results(ready, text)
    assert response.status_code == 201
    body = response.json()
    assert (body["students_ingested"], body["students_failed"]) == (2, 1)
    assert body["errors"][0]["row"] == 3 and body["errors"][0]["roll_no"] == "A-2"
    assert "'E' is not an option for question Q1" in body["errors"][0]["message"]
    # Not one of Bhavna's good cells (Q2–Q4) was written alongside her bad one.
    assert attempts_of(ready, "A-2") == {}
    assert len(attempts_of(ready, "A-1")) == len(attempts_of(ready, "A-3")) == 4


def test_every_problem_in_a_row_is_reported_not_just_the_first(ready):
    body = post_results(ready, "Roll No,Q1,Q2,Q3,Q4\nA-1,E,F,D,xyz\n").json()
    assert body["students_failed"] == 1 and body["errors_total"] == 3


def test_an_unknown_roll_number_and_a_repeated_row_are_reported(ready):
    text = "Roll No,Q1\nZ-999,B\nA-1,B\nA-1,A\n"
    body = post_results(ready, text).json()
    assert body["students_ingested"] == 1 and body["students_failed"] == 2
    messages = [e["message"] for e in body["errors"]]
    assert any("No student with roll number Z-999" in m for m in messages)
    assert any("appears twice" in m for m in messages)
    assert len(attempts_of(ready, "A-1")) == 1, "the repeat overwrote or doubled the first"


def test_a_question_the_blueprint_does_not_know_stops_everything(ready):
    response = post_results(ready, "Roll No,Q1,Q2,Q99\nA-1,B,A,C\nA-2,B,A,C\n")
    assert response.status_code == 422
    body = response.json()
    assert body["unmapped_questions"] == ["Q99"] and body["ok"] is False
    assert Attempt.objects.filter(test_paper=ready.paper).count() == 0
    assert IngestBatch.objects.count() == 0, "a refused upload left a receipt that would block a retry"


def test_after_fixing_the_blueprint_the_same_file_goes_through(ready):
    text = "Roll No,Q1,Q5\nA-1,B,C\n"
    assert post_results(ready, text).status_code == 422
    post_blueprint(ready, BLUEPRINT + "Q5,Limits,C,\n")
    assert post_results(ready, text).status_code == 201


def test_a_question_with_no_key_stops_everything(ready):
    QuestionTopicMap.objects.create(
        institute=ready.cohort.institute, test_paper=ready.paper, question_id="Q5",
        topic=ready.cohort.chapter("Limits"),
    )
    response = post_results(ready, "Roll No,Q1,Q5\nA-1,B,C\n")
    assert response.status_code == 422 and response.json()["unkeyed_questions"] == ["Q5"]


def test_questions_the_file_does_not_cover_are_a_warning_not_a_refusal(ready):
    response = post_results(ready, "Roll No,Q1,Q2\nA-1,B,A\n")
    assert response.status_code == 201
    assert response.json()["questions_not_in_file"] == ["Q3", "Q4"]


def test_a_file_where_no_student_can_be_found_is_a_refusal_and_leaves_no_receipt(ready):
    response = post_results(ready, "Roll No,Q1\nX-1,B\nX-2,A\n")
    assert response.status_code == 422
    assert response.json()["students_failed"] == 2 and response.json()["batch_id"] is None
    assert IngestBatch.objects.count() == 0


def test_numeric_answers_are_compared_with_a_tolerance_and_must_be_numbers(ready):
    ok = post_results(ready, "Roll No,Q4\nA-1,7.0000000001\nA-2,6.9\n").json()
    assert ok["students_ingested"] == 2
    assert attempts_of(ready, "A-1")["Q4"].status == "correct"
    assert attempts_of(ready, "A-2")["Q4"].status == "wrong"
    bad = post_results(ready, "Roll No,Q4\nA-3,seven\n").json()
    assert bad["students_failed"] == 1 and "not a number" in bad["errors"][0]["message"]


@pytest.mark.parametrize("cell, expected", [
    ("", "blank"), ("-", "blank"), ("skip", "blank"), ("NA", "blank"),
    ("nr", "not_reached"), ("Not Reached", "not_reached"),
])
def test_blank_and_not_reached_are_different_things_and_never_guessed(ready, cell, expected):
    post_results(ready, f"Roll No,Q1\nA-1,{cell}\n")
    attempt = attempts_of(ready, "A-1")["Q1"]
    assert attempt.status == expected and attempt.marks == 0 and attempt.chosen_option == ""


# ------------------------------------------------- formats an institute really sends


def test_headers_are_read_forgivingly(ready):
    text = "ROLL NO.,q 1,Q.2,3,Q_4\nA-1,B,A,D,7\n"          # spacing, dots, a bare number
    body = post_results(ready, text)
    assert body.status_code == 201, body.content
    assert len(attempts_of(ready, "A-1")) == 4


@pytest.mark.parametrize("encoding", ["utf-8-sig", "cp1252"])
def test_semicolons_a_byte_order_mark_and_windows_1252_are_all_fine(ready, encoding):
    """Excel writes UTF-8 with a byte-order mark, or the legacy Windows code
    page; and in some locales it separates with semicolons. The accented
    letter in the name column is outside ASCII, so a reader that assumed
    either encoding would mangle or reject it."""
    text = "Roll No;Q1;Q2;Name\nA-1;B;A;Zo\u00eb\n"
    response = ready.client.post("/api/ingest/results/", {
        "file": SimpleUploadedFile("r.csv", text.encode(encoding)),
        "paper": ready.paper.id}, format="multipart")
    assert response.status_code == 201, response.content
    assert len(attempts_of(ready, "A-1")) == 2
    assert response.json()["students_failed"] == 0


def test_the_institutes_own_column_names_can_be_mapped(ready):
    text = "Candidate No,Seat,Q1,Q2\nA-1,12,B,A\n"
    refused = post_results(ready, text)
    assert refused.status_code == 400 and "roll number column" in refused.json()["detail"]

    mapped = post_results(ready, text, column_map='{"Candidate No": "roll_no", "Seat": "ignore"}')
    assert mapped.status_code == 201 and mapped.json()["ignored_columns"] == ["Seat"]


def test_a_mapping_can_be_saved_and_reused(ready):
    first = "Candidate No,Q1\nA-1,B\n"
    assert post_results(ready, first, column_map='{"Candidate No": "roll_no"}',
                        save_mapping_as="Vendor X").status_code == 201
    profile = ColumnMappingProfile.objects.get(name="Vendor X")
    assert profile.mapping == {"Candidate No": "roll_no"}

    again = post_results(ready, "Candidate No,Q2\nA-2,A\n", mapping_profile=profile.id)
    assert again.status_code == 201 and len(attempts_of(ready, "A-2")) == 1
    listed = ready.client.get("/api/ingest/mappings/").json()["results"]
    assert [m["name"] for m in listed] == ["Vendor X"]


@pytest.mark.parametrize("column_map, key", [
    ("not json", "column_map"),
    ('["a"]', "column_map"),
    ('{"A": "salary"}', "column_map"),
    ('{"A": 3}', "column_map"),
])
def test_a_bad_column_map_is_a_400_that_names_the_problem(ready, column_map, key):
    response = post_results(ready, column_map=column_map)
    assert response.status_code == 400 and key in response.json()


def test_a_mapping_from_another_institute_cannot_be_used(ready, other_cohort):
    theirs = ColumnMappingProfile.objects.create(
        institute=other_cohort.institute, name="Theirs", mapping={"X": "roll_no"})
    assert post_results(ready, mapping_profile=theirs.id).status_code == 400


def test_mapping_profiles_have_unique_names_and_valid_fields(ready):
    body = {"name": "A", "mapping": {"Col": "roll_no"}}
    assert ready.client.post("/api/ingest/mappings/", body, format="json").status_code == 201
    assert ready.client.post("/api/ingest/mappings/", body, format="json").status_code == 400
    assert ready.client.post("/api/ingest/mappings/", {"name": "B", "mapping": {"Col": "salary"}},
                             format="json").status_code == 400


def test_two_columns_that_both_look_like_the_roll_number_are_refused_not_guessed(ready):
    response = post_results(ready, "Roll No,Roll,Q1\nA-1,A-2,B\n")
    assert response.status_code == 400 and "roll number" in response.json()["detail"]


# --------------------------------------------------------------- results: long


LONG = """roll_no,question_id,answer,time_spent
A-1,Q1,B,95
A-1,Q2,A,40
A-2,Q1,C,120
A-2,Q2,,
"""


def test_the_long_layout_carries_time_per_question(ready):
    response = post_results(ready, LONG)
    assert response.status_code == 201, response.content
    assert response.json()["layout"] == "long" and response.json()["students_ingested"] == 2
    a = attempts_of(ready, "A-1")
    assert (a["Q1"].time_spent, a["Q2"].time_spent) == (95, 40)
    assert attempts_of(ready, "A-2")["Q1"].status == "wrong"
    assert attempts_of(ready, "A-2")["Q2"].status == "blank"


def test_in_the_long_layout_one_bad_row_fails_that_student_wholly(ready):
    text = LONG + "A-3,Q1,B,5\nA-3,Q2,Z,5\n"
    body = post_results(ready, text).json()
    assert body["students_failed"] == 1 and attempts_of(ready, "A-3") == {}
    assert len(attempts_of(ready, "A-1")) == 2


def test_a_long_file_answering_the_same_question_twice_fails_that_student(ready):
    body = post_results(ready, "roll_no,question_id,answer\nA-1,Q1,B\nA-1,Q1,C\n").json()
    assert body["students_failed"] == 1 and "answered twice" in body["errors"][0]["message"]


def test_a_question_column_without_an_answer_column_is_explained(ready):
    response = post_results(ready, "roll_no,question_id\nA-1,Q1\n")
    assert response.status_code == 400 and "both" in response.json()["detail"]


# --------------------------------------------------------------- dry runs


def test_a_dry_run_reports_everything_and_writes_nothing(ready):
    text = "Roll No,Q1,Q2\nA-1,B,A\nA-2,E,A\n"
    response = post_results(ready, text, dry_run="true")
    assert response.status_code == 200
    body = response.json()
    assert body["dry_run"] is True and body["students_ingested"] == 1 and body["students_failed"] == 1
    assert body["batch_id"] is None and body["ok"] is True
    assert Attempt.objects.filter(test_paper=ready.paper).count() == 0
    assert IngestBatch.objects.count() == 0
    # …and the real run then does what the dry run said it would.
    assert post_results(ready, text).json()["students_ingested"] == 1


def test_a_dry_run_says_when_the_file_was_already_imported(ready):
    batch = post_results(ready).json()["batch_id"]
    body = post_results(ready, dry_run="true").json()
    assert body["duplicate_of_batch"] == batch and body["ok"] is False


# --------------------------------------------------------------- roll numbers


def test_a_roll_number_in_two_batches_needs_a_batch_column(ready):
    other_batch = f.BatchFactory(institute=ready.cohort.institute, exam=ready.cohort.exam,
                                 name="Beta", syllabus=ready.cohort.syllabus)
    twin = f.StudentFactory(institute=ready.cohort.institute, batch=other_batch,
                            name="Twin", roll_no="A-1", mentor=ready.cohort.mentor)
    ambiguous = post_results(ready, "Roll No,Q1\nA-1,B\n")
    assert ambiguous.status_code == 422
    assert "more than one batch" in ambiguous.json()["errors"][0]["message"]

    resolved = post_results(ready, "Roll No,Batch,Q1\nA-1,Beta,B\n")
    assert resolved.status_code == 201
    assert Attempt.objects.get(test_paper=ready.paper).student_id == twin.id


def test_another_institutes_students_are_invisible_to_the_upload(ready, other_cohort):
    f.make_student(other_cohort, "Outsider", roll_no="Z-1")
    body = post_results(ready, "Roll No,Q1\nZ-1,B\n").json()
    assert body["students_failed"] == 1 and "No student with roll number Z-1" in body["errors"][0]["message"]


# ------------------------------------------------------- limits and permissions


def test_an_oversized_file_is_refused_without_being_read_into_memory(ready):
    big = b"Roll No,Q1\n" + b"A-1,B\n" * 400_000
    response = ready.client.post("/api/ingest/results/", {
        "file": SimpleUploadedFile("big.csv", big), "paper": ready.paper.id}, format="multipart")
    assert response.status_code == 400 and "limit" in response.json()["detail"]


def test_results_for_someone_elses_paper_are_a_404(ready, other_cohort):
    stranger = APIClient()
    stranger.force_login(f.make_mentor_user(other_cohort, "stranger-mentor"))
    response = stranger.post("/api/ingest/results/", {"file": upload(RESULTS), "paper": ready.paper.id},
                             format="multipart")
    assert response.status_code == 404
    assert Attempt.objects.filter(test_paper=ready.paper).count() == 0


def test_students_and_strangers_cannot_upload(ready):
    student = APIClient()
    student.force_login(f.make_student_user(ready.students["A-1"], "aarav"))
    for client in (student, APIClient()):
        for url, extra in (("/api/ingest/results/", {"paper": ready.paper.id}),
                           (f"/api/papers/{ready.paper.id}/blueprint/", {})):
            response = client.post(url, {"file": upload(RESULTS), **extra}, format="multipart")
            assert response.status_code in (401, 403), url
    assert student.get("/api/ingest/batches/").status_code == 403


def test_uploads_are_rate_limited(lab, monkeypatch):
    """Blueprints and results share one budget per account, so this uses
    `lab` (no blueprint yet) to keep every counted request visible."""
    from rest_framework.throttling import ScopedRateThrottle

    monkeypatch.setitem(ScopedRateThrottle.THROTTLE_RATES, "ingest", "2/hour")
    codes = [post_results(lab, dry_run="true").status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    # The blueprint endpoint draws on the same budget.
    assert post_blueprint(lab).status_code == 429


# ----------------------------------------------------------------- the receipts


def test_batches_list_the_receipts_and_have_no_delete(ready, other_cohort):
    batch_id = post_results(ready).json()["batch_id"]
    rows = ready.client.get("/api/ingest/batches/").json()["results"]
    assert [(r["id"], r["paper_name"], r["rows_ok"], r["status"]) for r in rows] == [
        (batch_id, "Mock 15", 3, "done")]
    assert ready.client.get(f"/api/ingest/batches/{batch_id}/").status_code == 200
    assert ready.client.delete(f"/api/ingest/batches/{batch_id}/").status_code == 405

    stranger = APIClient()
    stranger.force_login(f.make_mentor_user(other_cohort, "stranger-mentor"))
    assert stranger.get("/api/ingest/batches/").json()["count"] == 0
    assert stranger.get(f"/api/ingest/batches/{batch_id}/").status_code == 404


def test_the_student_lookup_itself_is_confined_to_the_institute(cohort, other_cohort):
    """Postgres RLS also hides other tenants' students from a request, so the
    endpoint tests above would pass even if this filter were deleted. This
    checks the application's own half directly, where RLS is not in play."""
    from apps.ingestion.services.results import StudentIndex

    f.make_student(cohort, "Mine", roll_no="M-1")
    f.make_student(other_cohort, "Theirs", roll_no="T-1")
    index = StudentIndex(cohort.institute.id)
    assert index.find("M-1", "").name == "Mine"
    with pytest.raises(LookupError, match="No student with roll number T-1"):
        index.find("T-1", "")
