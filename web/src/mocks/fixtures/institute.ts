import type { Batch, Mentor, TestPaper } from "@/api/types";
import { isoDate } from "./rng";

/**
 * Aarambh Classes, Kota — 312 students across 4 batches.
 *
 * There is no endpoint that returns the institute itself, so the name lives
 * here and in the app shell (see API_GAPS.NO_SESSION_ENDPOINT).
 */
export const INSTITUTE = {
  name: "Aarambh Classes",
  city: "Kota",
  director: "Mr. V. Agarwal",
} as const;

export const mentors: Mentor[] = [
  { id: 1, name: "Dr. S. Bhatia", email: "bhatia@aarambh.example" },
  { id: 2, name: "Prof. R. Nair", email: "nair@aarambh.example" },
  { id: 3, name: "A. Kulkarni", email: "kulkarni@aarambh.example" },
  { id: 4, name: "Dr. M. Saxena", email: "saxena@aarambh.example" },
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

export const papers: TestPaper[] = PAPER_IDS.map((id, index) => ({
  id,
  name: `AIT Mock ${String(id).padStart(2, "0")}`,
  held_on: isoDate(6 + (PAPER_IDS.length - 1 - index) * 14),
  total_questions: 75,
  max_marks: 300,
  duration_min: 180,
}));

export const paperById = new Map(papers.map((p) => [p.id, p]));

export const MAX_MARKS = 300;
export const SUBJECT_MAX = 100;
