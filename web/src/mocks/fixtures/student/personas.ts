import type { Batch, Finding } from "@/api/types";
import { JEE_CHAPTERS, NEET_CHAPTERS, type ChapterSeed } from "./syllabi";
import type { AttemptSeed, PaperSeed } from "./types";

/**
 * The two students the mock server can sign in as, with everything the
 * student app reads about them that is not derived.
 *
 * Aarav is the live seed's own hero — roll A-1041, Alpha, Dr. S. Bhatia,
 * "AIR < 5000", the 171 → 134 mock series and the Mock 15 diagnostic sitting
 * transcribed in `../diagnosticSitting.ts`. His story is the concept note's:
 * Chemistry gets 11% of his study time and 46% of his lost marks.
 *
 * Diya is a NEET student, so the app has to draw four subjects (Physics,
 * Chemistry, Botany, Zoology) wherever it draws subjects at all. The live
 * seed has no NEET batch; she exists so mock mode can prove the screens never
 * assume three. Her mentor has not agreed with any diagnosis yet, so her
 * findings are empty — the other state the Guide has to explain.
 */

export interface ChapterPin {
  /** `null` pins "below the evidence floor" — fewer than four answers. */
  mastery?: number | null;
  attempts?: number;
  selfRating?: number | null;
  /** Days since the newest attempt; `null` means never attempted. */
  lastSeenDays?: number | null;
  /** Completed revision cycles, 0–3. */
  cycles?: number;
}

export interface RevisionSeed {
  topic: string;
  cycle: number;
  /** Days from today: negative is in the past. */
  inDays: number;
  /** Days from today it was done, for a completed one. */
  doneInDays?: number;
}

export interface LogSeed {
  topic: string;
  minutes: number;
  mode: "learn" | "practice" | "revise";
  daysAgo: number;
  hour: number;
}

export interface Persona {
  key: "jee" | "neet";
  userId: number;
  studentId: number;
  rollNo: string;
  name: string;
  /** The free-text target the institute recorded; may be empty. */
  target: string;
  joinedAt: string;
  mentorName: string;
  examName: string;
  batch: Batch;
  /** Subjects in syllabus order. */
  subjects: string[];
  chapters: ChapterSeed[];
  /** Mastery band per subject, for chapters that are not pinned. */
  bands: Record<string, [number, number]>;
  pins: Record<string, ChapterPin>;
  /** Chapters with no attempt at all (never seen). */
  unseen: string[];
  /** One unseen chapter taught in class recently: [name, days ago]. */
  taughtNotAttempted: [string, number] | null;
  papers: PaperSeed[];
  /** Pinned [conceptual, execution, time, skip, insufficient] per paper id. */
  marksLostPins: Record<number, [number, number, number, number, number]>;
  timeSharePct: number[];
  marksLostSharePct: number[];
  accuracyPct: (number | null)[];
  consistency: number;
  syllabusPct: number;
  revisions: RevisionSeed[];
  logs: LogSeed[];
  ratings: { topic: string; rating: number; daysAgo: number }[];
  attempts: AttemptSeed[];
  findings: (today: Date) => Finding[];
  /** The plan-level sentence on a deliberately lighter day, or null. */
  planNote: string | null;
  /** The subject an open imbalance would name, for the planner's first block. */
  neglectedSubject: string | null;
}

const INSTITUTE = { id: 1, name: "Aarambh Classes", city: "Kota", slug: "aarambh" } as const;
export { INSTITUTE };

/** `planner.NOTE_LIGHTER`, verbatim. */
export const NOTE_LIGHTER =
  "We've kept today a little lighter than usual, with nothing new to start — steady days add up to more than long ones.";

function daysBefore(today: Date, days: number, hour = 17): string {
  const d = new Date(today);
  d.setDate(d.getDate() - days);
  d.setHours(hour, 10, 0, 0);
  return d.toISOString();
}

/* ------------------------------------------------------------------ *
 * Aarav Mehta — JEE Main
 * ------------------------------------------------------------------ */

/** AIT Mocks 08–14, a fortnight apart, then the diagnostic four days ago. */
const AARAV_PAPERS: PaperSeed[] = [
  { id: 8, name: "AIT Mock 08", daysAgo: 90, maxMarks: 300, questions: 75, marks: [62, 41, 68] },
  { id: 9, name: "AIT Mock 09", daysAgo: 76, maxMarks: 300, questions: 75, marks: [58, 38, 64] },
  { id: 10, name: "AIT Mock 10", daysAgo: 62, maxMarks: 300, questions: 75, marks: [65, 34, 66] },
  { id: 11, name: "AIT Mock 11", daysAgo: 48, maxMarks: 300, questions: 75, marks: [61, 31, 60] },
  { id: 12, name: "AIT Mock 12", daysAgo: 34, maxMarks: 300, questions: 75, marks: [57, 28, 63] },
  { id: 13, name: "AIT Mock 13", daysAgo: 20, maxMarks: 300, questions: 75, marks: [54, 26, 58] },
  { id: 14, name: "AIT Mock 14", daysAgo: 6, maxMarks: 300, questions: 75, marks: [52, 24, 58] },
  // Physics D01–D15, Chemistry D16–D31, Maths D32–D46 — the transcribed
  // sitting, which totals 134 of 184.
  { id: 17, name: "Mock 15 — Diagnostic", daysAgo: 4, maxMarks: 184, questions: 46, marks: [50, 29, 55] },
];

/** Aarav's wrong answers on the diagnostic — `diagnosticSitting.ts`, verbatim. */
const AARAV_DIAGNOSTIC_WRONG: AttemptSeed[] = [
  { paperId: 17, label: "D11", topic: "Electrostatics", status: "wrong", chosen: "A", marks: -1, seconds: 99, questionPk: 961 },
  { paperId: 17, label: "D13", topic: "Kinematics", status: "wrong", chosen: "C", marks: -1, seconds: 151, questionPk: 962 },
  { paperId: 17, label: "D16", topic: "Hydrocarbons", status: "wrong", chosen: "C", marks: -1, seconds: 158, questionPk: 923 },
  { paperId: 17, label: "D17", topic: "Hydrocarbons", status: "wrong", chosen: "C", marks: -1, seconds: 134, questionPk: 924 },
  { paperId: 17, label: "D18", topic: "Organic Compounds Containing Oxygen", status: "wrong", chosen: "D", marks: -1, seconds: 127, questionPk: 925 },
  { paperId: 17, label: "D20", topic: "Organic Compounds Containing Oxygen", status: "wrong", chosen: "B", marks: -1, seconds: 111, questionPk: 927 },
  { paperId: 17, label: "D21", topic: "Organic Compounds Containing Halogens", status: "wrong", chosen: "C", marks: -1, seconds: 147, questionPk: 928 },
  { paperId: 17, label: "D29", topic: "Hydrocarbons", status: "wrong", chosen: "A", marks: -1, seconds: 165, questionPk: 963 },
  { paperId: 17, label: "D30", topic: "Chemical Bonding and Molecular Structure", status: "wrong", chosen: "A", marks: -1, seconds: 109, questionPk: 964 },
  { paperId: 17, label: "D43", topic: "Trigonometry", status: "wrong", chosen: "D", marks: -1, seconds: 149, questionPk: 965 },
];

/**
 * AIT Mock 13 and 14 were imported as scores only — an answer sheet with no
 * question text behind it, so `question_pk` is null and there is nothing to
 * open. That is a real state of the live data, not a gap in the fixture.
 */
const AARAV_SCORES_ONLY: AttemptSeed[] = [
  ["Q04", "Kinematics", "wrong", "B"],
  ["Q11", "Rotational Motion", "wrong", "D"],
  ["Q29", "Chemical Bonding and Molecular Structure", "wrong", "A"],
  ["Q33", "Coordination Compounds", "wrong", "C"],
  ["Q38", "Some Basic Principles of Organic Chemistry", "wrong", "B"],
  ["Q41", "Hydrocarbons", "wrong", "D"],
  ["Q62", "Integral Calculus", "wrong", "A"],
].flatMap(([label, topic, status, chosen], i) => [
  {
    paperId: 14,
    label,
    topic,
    status: status as AttemptSeed["status"],
    chosen,
    marks: -1,
    seconds: 70 + i * 13,
    questionPk: null,
  },
  ...(i < 4
    ? [
        {
          paperId: 13,
          label: `Q${String(Number(label.slice(1)) + 3).padStart(2, "0")}`,
          topic,
          status: status as AttemptSeed["status"],
          chosen,
          marks: -1,
          seconds: 80 + i * 11,
          questionPk: null,
        },
      ]
    : []),
]);

export const AARAV: Persona = {
  key: "jee",
  userId: 501,
  studentId: 1,
  rollNo: "A-1041",
  name: "Aarav Mehta",
  target: "AIR < 5000",
  joinedAt: "2026-04-01",
  mentorName: "Dr. S. Bhatia",
  examName: "JEE Main",
  batch: {
    id: 1,
    name: "Alpha",
    exam_code: "JEE_MAIN",
    year: 2027,
    exam_date: "2027-04-06",
    student_count: null,
  },
  subjects: ["Physics", "Chemistry", "Maths"],
  chapters: JEE_CHAPTERS,
  bands: { Physics: [0.42, 0.76], Chemistry: [0.18, 0.46], Maths: [0.46, 0.82] },
  pins: {
    "Chemical Bonding and Molecular Structure": { mastery: 0.22, attempts: 31, selfRating: 3, lastSeenDays: 9, cycles: 0 },
    "Coordination Compounds": { mastery: 0.18, attempts: 22, selfRating: 2, lastSeenDays: 13, cycles: 0 },
    Hydrocarbons: { mastery: 0.34, attempts: 18, selfRating: null, lastSeenDays: 4, cycles: 0 },
    "Organic Compounds Containing Oxygen": { mastery: 0.29, attempts: 14, selfRating: null, lastSeenDays: 4, cycles: 0 },
    Equilibrium: { mastery: 0.41, attempts: 26, selfRating: null, lastSeenDays: 11, cycles: 1 },
    "Rotational Motion": { mastery: 0.63, attempts: 44, selfRating: 4, lastSeenDays: 1, cycles: 1 },
    "Integral Calculus": { mastery: 0.71, attempts: 52, selfRating: 4, lastSeenDays: 1, cycles: 2 },
    Electrostatics: { mastery: 0.58, attempts: 29, selfRating: 3, lastSeenDays: 2, cycles: 1 },
    Kinematics: { mastery: 0.66, attempts: 38, selfRating: 4, lastSeenDays: 4, cycles: 1 },
    Trigonometry: { mastery: 0.69, attempts: 21, selfRating: null, lastSeenDays: 4, cycles: 1 },
    "Organic Compounds Containing Halogens": { mastery: null, attempts: 3, selfRating: null, lastSeenDays: 4, cycles: 0 },
    "Wave Optics": { mastery: null, attempts: 2, selfRating: null, lastSeenDays: 16, cycles: 0 },
    "Differential Equations": { mastery: null, attempts: 3, selfRating: 3, lastSeenDays: 19, cycles: 0 },
  },
  unseen: ["Electronic Devices", "Biomolecules", "Atoms and Nuclei", "Statistics and Probability"],
  taughtNotAttempted: ["Atoms and Nuclei", 2],
  papers: AARAV_PAPERS,
  marksLostPins: {
    14: [29, 24, 21, 16, 76],
    // The diagnostic, as `marks-lost/?paper=17` answers on the live server.
    17: [0, 10, 0, 0, 40],
  },
  timeSharePct: [52, 11, 37],
  marksLostSharePct: [28.2, 46.3, 25.5],
  accuracyPct: [54, 31, 58],
  consistency: 0.62,
  syllabusPct: 71.4,
  revisions: [
    { topic: "Chemical Bonding and Molecular Structure", cycle: 1, inDays: -3 },
    { topic: "Equilibrium", cycle: 2, inDays: -1 },
    { topic: "Rotational Motion", cycle: 2, inDays: 0 },
    { topic: "Hydrocarbons", cycle: 1, inDays: 2 },
    { topic: "Electrostatics", cycle: 2, inDays: 5 },
    { topic: "Integral Calculus", cycle: 3, inDays: 9 },
    { topic: "Kinematics", cycle: 1, inDays: -12, doneInDays: -11 },
    { topic: "Rotational Motion", cycle: 1, inDays: -8, doneInDays: -7 },
  ],
  logs: [
    { topic: "Rotational Motion", minutes: 60, mode: "practice", daysAgo: 1, hour: 19 },
    { topic: "Integral Calculus", minutes: 90, mode: "practice", daysAgo: 1, hour: 16 },
    { topic: "Electrostatics", minutes: 45, mode: "learn", daysAgo: 2, hour: 18 },
    { topic: "Conic Sections", minutes: 60, mode: "practice", daysAgo: 3, hour: 17 },
    { topic: "Chemical Bonding and Molecular Structure", minutes: 25, mode: "revise", daysAgo: 4, hour: 21 },
    { topic: "Kinematics", minutes: 40, mode: "revise", daysAgo: 5, hour: 7 },
    { topic: "Limits, Continuity and Differentiability", minutes: 75, mode: "practice", daysAgo: 6, hour: 16 },
  ],
  ratings: [
    { topic: "Rotational Motion", rating: 4, daysAgo: 9 },
    { topic: "Integral Calculus", rating: 4, daysAgo: 9 },
    { topic: "Chemical Bonding and Molecular Structure", rating: 3, daysAgo: 9 },
    { topic: "Coordination Compounds", rating: 2, daysAgo: 9 },
    { topic: "Electrostatics", rating: 3, daysAgo: 15 },
    { topic: "Kinematics", rating: 4, daysAgo: 15 },
    { topic: "Differential Equations", rating: 3, daysAgo: 20 },
  ],
  attempts: [...AARAV_DIAGNOSTIC_WRONG, ...AARAV_SCORES_ONLY],
  findings: (today) => [
    {
      paper_id: 17,
      paper_name: "Mock 15 — Diagnostic",
      title: "Which way a group on the ring sends the next one",
      explanation:
        "On D16, D17, D18, D20 and D21 you sent the incoming group to the position the group already on the ring does not favour. You got D22 and D23 right, so this is one rule to straighten out, not the whole chapter.",
      what_to_do:
        "Redo D16 and D17 without looking at your old answers, then check each one against the working. If the rule still feels unclear, your teacher or mentor can go over it with you.",
      questions: [
        { question_pk: 923, label: "D16" },
        { question_pk: 924, label: "D17" },
        { question_pk: 925, label: "D18" },
        { question_pk: 927, label: "D20" },
        { question_pk: 928, label: "D21" },
      ],
      approved_at: daysBefore(today, 2, 17),
      reworded: true,
    },
  ],
  planNote: NOTE_LIGHTER,
  neglectedSubject: "Chemistry",
};

/* ------------------------------------------------------------------ *
 * Diya Sharma — NEET (UG)
 * ------------------------------------------------------------------ */

export const DIYA: Persona = {
  key: "neet",
  userId: 502,
  studentId: 901,
  rollNo: "N-5012",
  name: "Diya Sharma",
  target: "",
  joinedAt: "2026-04-06",
  mentorName: "Ms. A. Fernandes",
  examName: "NEET (UG)",
  batch: {
    id: 9,
    name: "Neev",
    exam_code: "NEET_UG",
    year: 2027,
    exam_date: "2027-05-02",
    student_count: null,
  },
  subjects: ["Physics", "Chemistry", "Botany", "Zoology"],
  chapters: NEET_CHAPTERS,
  bands: {
    Physics: [0.34, 0.66],
    Chemistry: [0.4, 0.72],
    Botany: [0.58, 0.88],
    Zoology: [0.54, 0.84],
  },
  pins: {
    "Current Electricity": { mastery: 0.31, attempts: 24, selfRating: 4, lastSeenDays: 3, cycles: 1 },
    Equilibrium: { mastery: 0.44, attempts: 19, selfRating: null, lastSeenDays: 7, cycles: 0 },
    Photosynthesis: { mastery: 0.47, attempts: 28, selfRating: null, lastSeenDays: 10, cycles: 0 },
    "Body fluids and circulation": { mastery: 0.52, attempts: 22, selfRating: 3, lastSeenDays: 3, cycles: 1 },
    "Human Reproduction": { mastery: 0.81, attempts: 30, selfRating: 5, lastSeenDays: 5, cycles: 1 },
    "Rotational Motion": { mastery: 0.27, attempts: 17, selfRating: null, lastSeenDays: 12, cycles: 0 },
    Evolution: { mastery: null, attempts: 2, selfRating: null, lastSeenDays: 15, cycles: 0 },
  },
  unseen: ["Electronic Devices", "Biomolecules", "Ecosystem", "Reproductive health", "Experimental Skills"],
  taughtNotAttempted: ["Ecosystem", 1],
  papers: [
    { id: 51, name: "NEET Full Test 03", daysAgo: 49, maxMarks: 720, questions: 180, marks: [98, 112, 141, 132] },
    { id: 52, name: "NEET Full Test 04", daysAgo: 35, maxMarks: 720, questions: 180, marks: [104, 118, 146, 138] },
    { id: 53, name: "NEET Full Test 05", daysAgo: 21, maxMarks: 720, questions: 180, marks: [96, 121, 150, 141] },
    { id: 54, name: "NEET Full Test 06", daysAgo: 7, maxMarks: 720, questions: 180, marks: [110, 124, 152, 147] },
  ],
  marksLostPins: { 54: [41, 38, 22, 14, 72] },
  timeSharePct: [30, 22, 26, 22],
  marksLostSharePct: [37.2, 29.1, 15.4, 18.3],
  accuracyPct: [52, 61, 79, 76],
  consistency: 0.84,
  syllabusPct: 64.5,
  revisions: [
    { topic: "Photosynthesis", cycle: 1, inDays: -2 },
    { topic: "Current Electricity", cycle: 2, inDays: 3 },
    { topic: "Human Reproduction", cycle: 2, inDays: 6 },
  ],
  logs: [
    { topic: "Body fluids and circulation", minutes: 50, mode: "learn", daysAgo: 1, hour: 18 },
    { topic: "Current Electricity", minutes: 40, mode: "practice", daysAgo: 2, hour: 17 },
    { topic: "Human Reproduction", minutes: 35, mode: "revise", daysAgo: 3, hour: 20 },
  ],
  ratings: [
    { topic: "Current Electricity", rating: 4, daysAgo: 6 },
    { topic: "Body fluids and circulation", rating: 3, daysAgo: 6 },
    { topic: "Human Reproduction", rating: 5, daysAgo: 6 },
  ],
  attempts: [
    { paperId: 54, label: "Q12", topic: "Current Electricity", status: "wrong", chosen: "C", marks: -1, seconds: 96, questionPk: 971 },
    { paperId: 54, label: "Q58", topic: "Equilibrium", status: "wrong", chosen: "C", marks: -1, seconds: 74, questionPk: 972 },
    { paperId: 54, label: "Q104", topic: "Photosynthesis", status: "wrong", chosen: "A", marks: -1, seconds: 41, questionPk: 973 },
    { paperId: 54, label: "Q151", topic: "Body fluids and circulation", status: "wrong", chosen: "A", marks: -1, seconds: 38, questionPk: 974 },
    { paperId: 53, label: "Q09", topic: "Rotational Motion", status: "wrong", chosen: "B", marks: -1, seconds: 112, questionPk: null },
    { paperId: 53, label: "Q63", topic: "Equilibrium", status: "wrong", chosen: "D", marks: -1, seconds: 88, questionPk: null },
  ],
  findings: () => [],
  planNote: null,
  neglectedSubject: "Physics",
};

export const PERSONAS: Persona[] = [AARAV, DIYA];

/**
 * A username the mock login treats as a roll number: one to three letters, a
 * hyphen, three to five digits (`A-1041`, `N-5012`). The live server tells a
 * roll number from a staff username by which account the password opens; the
 * mock has no accounts table, so it goes by the shape.
 */
export function looksLikeRollNumber(username: string): boolean {
  return /^[A-Za-z]{1,3}-\d{3,5}$/.test(username.trim());
}

export function personaForRoll(roll: string): Persona | undefined {
  const wanted = roll.trim().toUpperCase();
  return PERSONAS.find((p) => p.rollNo === wanted);
}
