import type { Batch, Mentor, TestPaper } from "@/api/types";
import { isoDate } from "./rng";

/**
 * Aarambh Classes, Kota — 312 students across 4 batches.
 *
 * The name matches the seeded institute on the live server, so flipping
 * `VITE_USE_MOCKS` does not change which institute the masthead claims to be
 * showing. `/api/me/` carries it for real; this is the offline stand-in.
 */
export const INSTITUTE = {
  name: "Aarambh Classes",
  city: "Kota",
  director: "Mr. V. Agarwal",
} as const;

/**
 * Names and ids match the live `tenancy_mentor` rows, so a flag routed to
 * mentor 1 in the mock is routed to Dr. S. Bhatia in both worlds.
 */
export const mentors: Mentor[] = [
  { id: 1, name: "Dr. S. Bhatia", email: "bhatia@aarambh.example", student_count: 12 },
  {
    id: 2,
    name: "Prof. R. Nagarajan",
    email: "nagarajan@aarambh.example",
    student_count: 12,
  },
  {
    id: 3,
    name: "Dr. M. Kulkarni",
    email: "kulkarni@aarambh.example",
    student_count: 12,
  },
  {
    id: 4,
    name: "Ms. A. Fernandes",
    email: "fernandes@aarambh.example",
    student_count: 10,
  },
];

export const batches: Batch[] = [
  {
    id: 1,
    name: "Alpha",
    exam_code: "JEE-ADV",
    year: 2027,
    exam_date: "2027-05-23",
    student_count: 78,
  },
  {
    id: 2,
    name: "Beta",
    exam_code: "JEE-MAIN",
    year: 2027,
    exam_date: "2027-01-24",
    student_count: 96,
  },
  {
    id: 3,
    name: "Dropper",
    exam_code: "JEE-MAIN",
    year: 2027,
    exam_date: "2027-01-24",
    student_count: 64,
  },
  {
    id: 4,
    name: "Gamma",
    exam_code: "JEE-MAIN",
    year: 2028,
    exam_date: "2028-01-23",
    student_count: 74,
  },
];

/** Mocks 08–14, a fortnight apart, the most recent one six days ago. */
export const PAPER_IDS = [8, 9, 10, 11, 12, 13, 14] as const;

/**
 * The diagnostic paper, and the one every diagnosis in these fixtures is
 * about. Named and sized to match the live server exactly — id 17,
 * "Mock 15 — Diagnostic", 46 misconception-tagged questions out of 184.
 *
 * It was previously "AIT Mock 14" out of 300 here while the server called
 * it "Mock 15 — Diagnostic" out of 184, so mock mode showed a paper that
 * does not exist, with the wrong denominator. That is the sixth instance
 * of the same bug: a fixture agreeing with the console instead of with the
 * server. They are only caught by comparing against a live response, which
 * is why these are transcripts now rather than inventions.
 */
export const DIAGNOSTIC_PAPER_ID = 17;
export const DIAGNOSTIC_PAPER_NAME = "Mock 15 — Diagnostic";
export const DIAGNOSTIC_MAX_MARKS = 184;

export const papers: TestPaper[] = [
  ...PAPER_IDS.map((id, index) => ({
    id,
    name: `AIT Mock ${String(id).padStart(2, "0")}`,
    held_on: isoDate(6 + (PAPER_IDS.length - 1 - index) * 14),
    total_questions: 75,
    max_marks: 300,
    duration_min: 180,
  })),
  {
    id: DIAGNOSTIC_PAPER_ID,
    name: DIAGNOSTIC_PAPER_NAME,
    held_on: isoDate(4),
    total_questions: 46,
    max_marks: DIAGNOSTIC_MAX_MARKS,
    duration_min: 60,
  },
];

export const paperById = new Map(papers.map((p) => [p.id, p]));

export const MAX_MARKS = 300;
export const SUBJECT_MAX = 100;
