"""Official answer keys and paper skeletons — the deterministic half of the question factory.

WHY THIS FILE EXISTS

    The cross-check is only as good as the official answer it compares
    against, and every way of getting that answer wrong is silent: read
    booklet 45's paper against booklet 46's key, or take JEE Main's option
    *position* instead of its option *id*, or match a question id against
    another shift's page, and every answer still looks like an answer. These
    tests pin each of those traps with a synthetic document shaped exactly
    like NTA's — no PDFs, no network, no database.
"""

from __future__ import annotations

import pytest

from apps.ingestion.factory.keys import (
    KeyMappingError,
    KeyParseError,
    jee_official_answer,
    parse_jee_key,
    parse_mirror_key,
    parse_neet_key,
)
from apps.ingestion.factory.structure import (
    StructureError,
    jee_slots,
    neet_slots,
    verify_booklet,
)


def neet_key_page(code: str, answers: dict[int, str]) -> str:
    rows = "\n".join(f"{n:>3} {a}" for n, a in sorted(answers.items()))
    return (f"NATIONAL TESTING AGENCY\nTest Booklet Code : {code}\n"
            f"Q.No.   Answer\n1 of 4\nFINAL ANSWER KEY\n{rows}\n")


# ================================================================ NEET


def test_neet_key_is_read_for_the_booklet_code_asked_for_and_no_other():
    texts = [neet_key_page("45", {1: "2", 2: "4", 3: "1"}),
             neet_key_page("46", {1: "3", 2: "1", 3: "4"})]
    assert parse_neet_key(texts, "45", total=3) == {1: ("2",), 2: ("4",), 3: ("1",)}
    assert parse_neet_key(texts, "46", total=3)[1] == ("3",)


def test_neet_key_keeps_both_options_when_nta_accepted_two():
    """NEET 2025 code 45, Q40 and Q63: the final key accepts '1,2'."""
    key = parse_neet_key([neet_key_page("45", {1: "1,2", 2: "3"})], "45", total=2)
    assert key[1] == ("1", "2")


def test_an_incomplete_neet_key_is_an_error_not_a_shorter_key():
    with pytest.raises(KeyParseError, match="missing"):
        parse_neet_key([neet_key_page("45", {1: "2", 3: "1"})], "45", total=3)


def test_a_booklet_code_not_in_the_key_is_an_error():
    with pytest.raises(KeyParseError, match="booklet code 47"):
        parse_neet_key([neet_key_page("45", {1: "2"})], "47", total=1)


def test_booklet_check_proves_the_claimed_code_and_rejects_a_wrong_claim():
    """The mirror's own printed key decides which NTA code its order belongs to."""
    import random

    rng = random.Random(7)
    official = {code: {n: (str(rng.randint(1, 4)),) for n in range(1, 41)}
                for code in ("45", "46", "47", "48")}
    mirror_text = " ".join(f"{n}. ({official['45'][n][0]})" for n in range(1, 41))

    good = verify_booklet(mirror_text, official, "45")
    assert good["ok"] and good["best_match"] == "45"
    assert good["matches_by_code"]["45"] == 40

    bad = verify_booklet(mirror_text, official, "46")
    assert not bad["ok"]


def test_mirror_key_parser_reads_multi_answers():
    assert parse_mirror_key("1. (2) 2. (1,2) 100. (4)") == {
        1: ("2",), 2: ("1", "2"), 100: ("4",)}


# ================================================================ JEE Main


def jee_key_page(date: str, shift: str, centre: str, rows: list[tuple[str, str]]) -> str:
    body = "\n".join(f"{q} {a}" for q, a in rows)
    return (f"NATIONAL TESTING AGENCY\nExam Date : {date}\n"
            f"QUESTION ID  CORRECT OPTION ID\nExam Shift : {shift}\n1 of 18\n"
            f"JEE (Main) - 2026 : SESSION - 2 FINAL ANSWER KEY\n({centre})\n"
            f"( MATHEMATICS )\n{body}\n")


def test_jee_key_reads_only_its_own_shift_even_when_ids_collide():
    """Real case: on the Session 2 key, shift 2's question ids are the same
    strings as shift 1's option ids. Reading the whole file as one table
    would cross-wire them; the parser must take only its page."""
    shift1 = jee_key_page("02.04.2026", "First", "For Centers in India",
                          [("6911211", "6911213"), ("6911212", "691121151")])
    shift2 = jee_key_page("02.04.2026", "Second", "For Centers in India",
                          [("691121151", "691121514")])
    rows = parse_jee_key([shift1, shift2], "02.04.2026", "First")
    assert [(r.question_id, r.value) for r in rows] == [
        ("6911211", "6911213"), ("6911212", "691121151")]
    assert rows[0].section == "MATHEMATICS"


def test_jee_key_separates_centres_inside_and_outside_india():
    india = jee_key_page("02.04.2026", "First", "For Centers in India", [("1111111", "2")])
    abroad = jee_key_page("02.04.2026", "First", "For Centers Outside India",
                          [("9999999", "3")])
    rows = parse_jee_key([india, abroad], "02.04.2026", "First")
    assert [r.question_id for r in rows] == ["1111111"]


def test_jee_answer_is_mapped_through_option_ids_not_positions():
    ids = ["6911219", "69112110", "69112111", "69112112"]
    ans = jee_official_answer("69112110", "MCQ", ids)
    assert ans.labels == ("2",) and ans.display == "2"


def test_an_option_id_that_belongs_to_another_question_is_refused():
    with pytest.raises(KeyMappingError):
        jee_official_answer("6911215", "MCQ", ["6911211", "6911212", "6911213", "6911214"])


def test_numerical_answers_are_kept_as_printed_and_dropped_questions_flagged():
    num = jee_official_answer("225", "SA", [])
    assert num.answer_type == "numerical" and num.numeric == "225" and num.display == "225"
    assert jee_official_answer("Drop", "MCQ", ["1", "2", "3", "4"]).dropped
    with pytest.raises(KeyMappingError):
        jee_official_answer("six", "SA", [])


# ================================================================ skeletons


def test_neet_question_starts_are_found_in_sequence_and_stray_numbers_ignored():
    pages = [
        "Instructions\n1. Read\n2. Write\n",                     # page 1 — not a question page
        "1. A ball is thrown\n(1) 1\n2. Statement list:\n 5. not a question\n",
        "3. A rod rotates\n4. Which gas\n",
    ]
    slots = neet_slots(pages, 2, 3, total=4, subjects=((1, 2, "Physics"), (3, 4, "Chemistry")))
    assert [(s.number, s.start_page, s.end_page) for s in slots] == [
        (1, 2, 2), (2, 2, 3), (3, 3, 3), (4, 3, 3)]
    assert slots[2].subject == "Chemistry"


def test_neet_skeleton_with_the_wrong_count_is_an_error():
    with pytest.raises(StructureError):
        neet_slots(["1. a\n2. b\n"], 1, 1, total=3)


JEE_PAGE = """\
Mathematics Section A
Section Id :
6911211
Question Number : 1 Question Id : 6911211 Question Type : MCQ Option Shuffling : Yes
Options :
6911211.
6911212.
6911213.
6911214.
Mathematics Section B
Question Number : 2 Question Id : 6911212 Question Type : SA Display Question Number : Yes
Possible Answers :
1
"""


def test_jee_skeleton_reads_ids_types_sections_and_option_order():
    slots = jee_slots([JEE_PAGE], 1, 1, total=2)
    assert slots[0].question_id == "6911211" and slots[0].qtype == "MCQ"
    assert slots[0].option_ids == ["6911211", "6911212", "6911213", "6911214"]
    assert slots[0].subject == "Mathematics" and slots[0].section == "Mathematics Section A"
    assert slots[1].answer_type == "numerical" and slots[1].option_ids == []
    assert slots[1].section == "Mathematics Section B"


def test_jee_mcq_without_four_option_ids_is_an_error():
    broken = JEE_PAGE.replace("6911214.", "")
    with pytest.raises(StructureError, match="Q1"):
        jee_slots([broken], 1, 1, total=2)


# ================================================================ LaTeX in JSON


def test_latex_backslashes_lost_to_json_escapes_are_restored():
    r"""Seen live: "\theta" arrived as TAB + "heta", "\rho" as CR + "ho"."""
    from apps.ingestion.factory.text import repair

    # What json.loads makes of an unescaped LaTeX string: real control chars.
    mangled = "angle $\theta_0$, density $\rho$, $\frac{1}{2}$, $\beta \times 2$"
    assert "\t" in mangled and "\r" in mangled and "\f" in mangled and "\b" in mangled
    assert repair(mangled) == (
        r"angle $\theta_0$, density $\rho$, $\frac{1}{2}$, $\beta \times 2$")
    # A real line break stays a line break; inside math before a command it was \n.
    assert repair("Statement I\nStatement II") == "Statement I\nStatement II"
    assert repair("$\nu = c/2$") == r"$\nu = c/2$"
    assert repair(repair(mangled)) == repair(mangled)          # idempotent
