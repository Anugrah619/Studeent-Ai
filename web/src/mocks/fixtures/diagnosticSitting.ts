import type { Attempt, MarksLost } from "@/api/types";
import {
  DIAGNOSTIC_MAX_MARKS,
  DIAGNOSTIC_PAPER_ID,
  DIAGNOSTIC_PAPER_NAME,
  paperById,
} from "./institute";

/**
 * Aarav's sitting of the diagnostic paper, transcribed from the live server.
 *
 * `GET /api/students/1/attempts/?paper=17` and
 * `GET /api/students/1/marks-lost/?paper=17`, copied row for row. The "How it
 * works" page walks a director through exactly this sitting — the answer sheet,
 * the counts, the diagnosis, the question behind each citation — so every
 * number it shows in mock mode has to be the number the live API gives, or
 * flipping `VITE_USE_MOCKS` changes the story mid-pitch.
 *
 * Before this file the mocks had no paper-17 sitting for Aarav at all: his
 * attempts were 75 synthetic rows for whatever paper was asked about, and his
 * marks-lost for paper 17 was a 404. The diagnosis fixture meanwhile cited
 * D16–D21 on that paper. A fixture set that diagnoses a sitting it does not
 * contain is the seventh instance of the same bug the last six were.
 *
 * Only the dates are local: the fixture paper is held a few days before
 * "today" rather than on the live seed's calendar date, so it stays the most
 * recent paper in the mock world.
 */

const HELD_ON = paperById.get(DIAGNOSTIC_PAPER_ID)?.held_on ?? "2026-09-20";
const SAT_AT = `${HELD_ON}T10:00:00+05:30`;

type Row = [id: number, label: string, topic: string, status: Attempt["status"], seconds: number, marks: number];

/** Verbatim, in the server's order (`question_id` ascending). */
const AARAV_ROWS: Row[] = [
  [40809, "D01", "Rotational Motion", "correct", 147, 4],
  [40810, "D02", "Rotational Motion", "correct", 50, 4],
  [40811, "D03", "Rotational Motion", "correct", 129, 4],
  [40812, "D04", "Rotational Motion", "correct", 103, 4],
  [40813, "D05", "Rotational Motion", "correct", 127, 4],
  [40814, "D06", "Rotational Motion", "correct", 148, 4],
  [40815, "D07", "Rotational Motion", "correct", 122, 4],
  [40816, "D08", "Rotational Motion", "correct", 81, 4],
  [40817, "D09", "Rotational Motion", "correct", 121, 4],
  [40818, "D10", "Electrostatics", "correct", 123, 4],
  [40819, "D11", "Electrostatics", "wrong", 99, -1],
  [40820, "D12", "Magnetic Effects of Current and Magnetism", "correct", 118, 4],
  [40821, "D13", "Kinematics", "wrong", 151, -1],
  [40822, "D14", "Kinematics", "correct", 89, 4],
  [40823, "D15", "Kinematics", "correct", 84, 4],
  [40824, "D16", "Hydrocarbons", "wrong", 158, -1],
  [40825, "D17", "Hydrocarbons", "wrong", 134, -1],
  [40826, "D18", "Organic Compounds Containing Oxygen", "wrong", 127, -1],
  [40827, "D19", "Hydrocarbons", "correct", 83, 4],
  [40828, "D20", "Organic Compounds Containing Oxygen", "wrong", 111, -1],
  [40829, "D21", "Organic Compounds Containing Halogens", "wrong", 147, -1],
  [40830, "D22", "Hydrocarbons", "correct", 38, 4],
  [40831, "D23", "Organic Compounds Containing Oxygen", "correct", 101, 4],
  [40832, "D24", "Hydrocarbons", "correct", 128, 4],
  [40833, "D25", "Hydrocarbons", "correct", 94, 4],
  [40834, "D26", "Hydrocarbons", "correct", 104, 4],
  [40835, "D27", "Hydrocarbons", "correct", 56, 4],
  [40836, "D28", "Hydrocarbons", "correct", 141, 4],
  [40837, "D29", "Hydrocarbons", "wrong", 165, -1],
  [40838, "D30", "Chemical Bonding and Molecular Structure", "wrong", 109, -1],
  [40839, "D31", "Equilibrium", "correct", 28, 4],
  [40840, "D32", "Integral Calculus", "correct", 135, 4],
  [40841, "D33", "Limits, Continuity and Differentiability", "correct", 105, 4],
  [40842, "D34", "Integral Calculus", "correct", 118, 4],
  [40843, "D35", "Limits, Continuity and Differentiability", "correct", 96, 4],
  [40844, "D36", "Integral Calculus", "correct", 168, 4],
  [40845, "D37", "Limits, Continuity and Differentiability", "correct", 111, 4],
  [40846, "D38", "Limits, Continuity and Differentiability", "correct", 111, 4],
  [40847, "D39", "Integral Calculus", "correct", 82, 4],
  [40848, "D40", "Complex Numbers and Quadratic Equations", "correct", 38, 4],
  [40849, "D41", "Complex Numbers and Quadratic Equations", "correct", 142, 4],
  [40850, "D42", "Trigonometry", "correct", 130, 4],
  [40851, "D43", "Trigonometry", "wrong", 149, -1],
  [40852, "D44", "Trigonometry", "correct", 134, 4],
  [40853, "D45", "Complex Numbers and Quadratic Equations", "correct", 155, 4],
  [40854, "D46", "Sets, Relations and Functions", "correct", 72, 4],
];

function toAttempt([id, label, topic, status, seconds, marks]: Row): Attempt {
  return {
    id,
    question_id: label,
    topic_name: topic,
    status,
    time_spent: seconds,
    marks,
    source: "mock",
    ts: SAT_AT,
  };
}

/** Attempts on the diagnostic paper, by student. */
const ATTEMPTS: Record<number, Attempt[]> = {
  1: AARAV_ROWS.map(toAttempt),
};

/** Marks lost on the diagnostic paper, by student. Verbatim. */
const MARKS_LOST: Record<number, MarksLost> = {
  1: {
    paper_id: DIAGNOSTIC_PAPER_ID,
    paper_name: DIAGNOSTIC_PAPER_NAME,
    held_on: HELD_ON,
    max_marks: DIAGNOSTIC_MAX_MARKS,
    questions: 46,
    attempted: 46,
    score: 134,
    conceptual_gap: 0,
    execution_error: 10,
    time_exhaustion: 0,
    avoidable_skip: 0,
    insufficient_evidence: 40,
    total_lost: 50,
    attributed_lost: 10,
    recoverable: 10,
    recoverable_pct: 100,
    time_baseline_sec: 100,
    causes: [
      { cause: "conceptual_gap", marks: 0, questions: 0, share_pct: 0 },
      { cause: "execution_error", marks: 10, questions: 2, share_pct: 20 },
      { cause: "time_exhaustion", marks: 0, questions: 0, share_pct: 0 },
      { cause: "avoidable_skip", marks: 0, questions: 0, share_pct: 0 },
      { cause: "insufficient_evidence", marks: 40, questions: 8, share_pct: 80 },
    ],
    top_loss_topics: [
      { topic_id: 46, topic: "Hydrocarbons", subject: "Chemistry", marks_lost: 15, questions: 3 },
      {
        topic_id: 48,
        topic: "Organic Compounds Containing Oxygen",
        subject: "Chemistry",
        marks_lost: 10,
        questions: 2,
      },
      { topic_id: 17, topic: "Electrostatics", subject: "Physics", marks_lost: 5, questions: 1 },
      { topic_id: 4, topic: "Kinematics", subject: "Physics", marks_lost: 5, questions: 1 },
      {
        topic_id: 47,
        topic: "Organic Compounds Containing Halogens",
        subject: "Chemistry",
        marks_lost: 5,
        questions: 1,
      },
      {
        topic_id: 32,
        topic: "Chemical Bonding and Molecular Structure",
        subject: "Chemistry",
        marks_lost: 5,
        questions: 1,
      },
      { topic_id: 71, topic: "Trigonometry", subject: "Maths", marks_lost: 5, questions: 1 },
    ],
  },
};

/** The transcribed attempts, when this student sat this paper in the transcripts. */
export function diagnosticAttemptsFor(
  studentId: number,
  paperId: number,
): Attempt[] | undefined {
  return paperId === DIAGNOSTIC_PAPER_ID ? ATTEMPTS[studentId] : undefined;
}

/** The transcribed attribution, when there is one. */
export function diagnosticMarksLostFor(
  studentId: number,
  paperId: number,
): MarksLost | undefined {
  return paperId === DIAGNOSTIC_PAPER_ID ? MARKS_LOST[studentId] : undefined;
}
