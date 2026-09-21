import type {
  MockScore,
  StudentDetail,
  StudentList,
  StudentState,
} from "@/api/types";
import { batches, MAX_MARKS, mentors, papers } from "./institute";
import { clamp, hashSeed, isoDateTime, mulberry32, round } from "./rng";

interface Seed {
  id: number;
  name: string;
  roll_no: string;
  batchId: number;
  mentorId: number;
  target: string;
  joined_at: string;
  exited_at?: string | null;
  risk_score: number;
  /** Intent for the generated mock series; the real figures are derived. */
  avg: number;
  trend: number;
  open_flags: number;
  state: Partial<StudentState>;
}

/**
 * The six names in the triage story come straight from the concept note, so the
 * screen a director is shown matches the deck he was pitched. The rest fill the
 * roster out so filters and sorting have something to bite on.
 */
export const seeds: Seed[] = [
  {
    id: 1,
    name: "Aarav Mehta",
    roll_no: "AC-27-0114",
    batchId: 1,
    mentorId: 1,
    target: "AIR < 5000",
    joined_at: "2025-06-02",
    risk_score: 86,
    avg: 152.6,
    trend: -37,
    open_flags: 2,
    state: {
      consistency: 0.62,
      load_index: 0.88,
      balance_index: 0.34,
      revision_debt: 14,
      syllabus_pct: 71.4,
    },
  },
  {
    id: 2,
    name: "Ishita Rao",
    roll_no: "AC-27-0231",
    batchId: 3,
    mentorId: 2,
    target: "AIR < 10000",
    joined_at: "2025-04-18",
    risk_score: 81,
    avg: 168,
    trend: -22,
    open_flags: 2,
    state: {
      consistency: 0.91,
      load_index: 1.34,
      balance_index: 0.58,
      revision_debt: 9,
      syllabus_pct: 83.2,
    },
  },
  {
    id: 3,
    name: "Md. Faizan Ali",
    roll_no: "AC-27-0158",
    batchId: 2,
    mentorId: 3,
    target: "NIT — CSE",
    joined_at: "2025-06-11",
    risk_score: 62,
    avg: 141,
    trend: -6,
    open_flags: 1,
    state: {
      consistency: 0.28,
      load_index: 0.41,
      balance_index: 0.66,
      revision_debt: 11,
      syllabus_pct: 64.8,
    },
  },
  {
    id: 4,
    name: "Kunal Deshpande",
    roll_no: "AC-27-0102",
    batchId: 1,
    mentorId: 1,
    target: "AIR < 8000",
    joined_at: "2025-06-02",
    risk_score: 58,
    avg: 176,
    trend: 3,
    open_flags: 1,
    state: {
      consistency: 0.74,
      load_index: 0.96,
      balance_index: 0.71,
      revision_debt: 6,
      syllabus_pct: 78.1,
    },
  },
  {
    id: 5,
    name: "Tanvi Shah",
    roll_no: "AC-27-0244",
    batchId: 3,
    mentorId: 4,
    target: "AIR < 15000",
    joined_at: "2025-04-22",
    risk_score: 55,
    avg: 150,
    trend: -4,
    open_flags: 1,
    state: {
      consistency: 0.81,
      load_index: 1.05,
      balance_index: 0.63,
      revision_debt: 7,
      syllabus_pct: 80.5,
    },
  },
  {
    id: 6,
    name: "Priya Nair",
    roll_no: "AC-27-0167",
    batchId: 2,
    mentorId: 3,
    target: "NIT — ECE",
    joined_at: "2025-06-09",
    risk_score: 34,
    avg: 159,
    trend: 19,
    open_flags: 1,
    state: {
      consistency: 0.77,
      load_index: 0.94,
      balance_index: 0.79,
      revision_debt: 3,
      syllabus_pct: 74.6,
    },
  },
  {
    id: 7,
    name: "Rohan Iyer",
    roll_no: "AC-27-0121",
    batchId: 1,
    mentorId: 1,
    target: "AIR < 3000",
    joined_at: "2025-06-02",
    risk_score: 41,
    avg: 189,
    trend: 8,
    open_flags: 0,
    state: { syllabus_pct: 82.3 },
  },
  {
    id: 8,
    name: "Sneha Kulkarni",
    roll_no: "AC-27-0173",
    batchId: 2,
    mentorId: 3,
    target: "NIT — Mech",
    joined_at: "2025-06-09",
    risk_score: 28,
    avg: 172,
    trend: 11,
    open_flags: 0,
    state: { syllabus_pct: 76.9 },
  },
  {
    id: 9,
    name: "Aditya Verma",
    roll_no: "AC-28-0311",
    batchId: 4,
    mentorId: 4,
    target: "AIR < 20000",
    joined_at: "2026-04-06",
    risk_score: 47,
    avg: 133,
    trend: -9,
    open_flags: 1,
    state: { syllabus_pct: 41.2 },
  },
  {
    id: 10,
    name: "Nikhil Joshi",
    roll_no: "AC-27-0256",
    batchId: 3,
    mentorId: 2,
    target: "AIR < 12000",
    joined_at: "2025-04-18",
    risk_score: 30,
    avg: 163,
    trend: 4,
    open_flags: 0,
    state: { syllabus_pct: 85.7 },
  },
  {
    id: 11,
    name: "Meera Pillai",
    roll_no: "AC-27-0108",
    batchId: 1,
    mentorId: 1,
    target: "AIR < 1500",
    joined_at: "2025-06-02",
    risk_score: 22,
    avg: 205,
    trend: 14,
    open_flags: 0,
    state: { syllabus_pct: 88.4 },
  },
  {
    id: 12,
    name: "Arjun Reddy",
    roll_no: "AC-28-0326",
    batchId: 4,
    mentorId: 4,
    target: "AIR < 25000",
    joined_at: "2026-04-06",
    risk_score: 51,
    avg: 127,
    trend: -2,
    open_flags: 1,
    state: { syllabus_pct: 38.9 },
  },
  {
    id: 13,
    name: "Zoya Khan",
    roll_no: "AC-27-0182",
    batchId: 2,
    mentorId: 3,
    target: "NIT — EE",
    joined_at: "2025-06-09",
    risk_score: 19,
    avg: 182,
    trend: 6,
    open_flags: 0,
    state: { syllabus_pct: 79.5 },
  },
  {
    id: 14,
    name: "Harshit Gupta",
    roll_no: "AC-27-0263",
    batchId: 3,
    mentorId: 2,
    target: "AIR < 20000",
    joined_at: "2025-04-18",
    exited_at: "2026-08-30",
    risk_score: 72,
    avg: 119,
    trend: -18,
    open_flags: 0,
    state: { syllabus_pct: 52.1 },
  },
];

export const seedById = new Map(seeds.map((s) => [s.id, s]));

/* ------------------------------------------------------------------ *
 * Mock score series
 * ------------------------------------------------------------------ */

/** The hero series from the concept note: 171 → 134 across seven mocks. */
const AARAV: [number, number, number][] = [
  [62, 41, 68],
  [58, 38, 64],
  [65, 34, 66],
  [61, 31, 60],
  [57, 28, 63],
  [54, 26, 58],
  [52, 24, 58],
];

function generateSeries(seed: Seed): [number, number, number][] {
  if (seed.id === 1) return AARAV;
  const rand = mulberry32(hashSeed("mock", seed.id));
  const w: [number, number, number] = [
    0.34 + (rand() - 0.5) * 0.08,
    0.32 + (rand() - 0.5) * 0.08,
    0.34 + (rand() - 0.5) * 0.08,
  ];
  const wSum = w[0] + w[1] + w[2];

  return papers.map((_, i) => {
    const total =
      seed.avg + (seed.trend * (i - (papers.length - 1) / 2)) / (papers.length - 1) * 2 +
      (rand() - 0.5) * 13;
    return w.map((weight) =>
      Math.round(clamp((total * weight) / wSum, 8, 98)),
    ) as unknown as [number, number, number];
  });
}

const seriesCache = new Map<number, MockScore[]>();

export function mockScoresFor(studentId: number): MockScore[] {
  const cached = seriesCache.get(studentId);
  if (cached) return cached;
  const seed = seedById.get(studentId);
  if (!seed) return [];

  const rows = generateSeries(seed).map((subjects, i) => {
    const paper = papers[i];
    const [physics, chemistry, maths] = subjects;
    return {
      paper_id: paper.id,
      paper_name: paper.name,
      held_on: paper.held_on,
      physics,
      chemistry,
      maths,
      total: physics + chemistry + maths,
    } satisfies MockScore;
  });
  seriesCache.set(studentId, rows);
  return rows;
}

/** Derived, never asserted — the list row and the trend chart cannot disagree. */
export function derivedScores(studentId: number) {
  const rows = mockScoresFor(studentId);
  if (!rows.length) return { mock_avg: 0, mock_trend: 0 };
  const sum = rows.reduce((acc, row) => acc + row.total, 0);
  return {
    mock_avg: round(sum / rows.length, 1),
    mock_trend: round(rows[rows.length - 1].total - rows[0].total, 1),
  };
}

/* ------------------------------------------------------------------ *
 * Serialised shapes
 * ------------------------------------------------------------------ */

function stateFor(seed: Seed): StudentState {
  const rand = mulberry32(hashSeed("state", seed.id));
  const derived = derivedScores(seed.id);
  return {
    consistency: round(seed.state.consistency ?? 0.45 + rand() * 0.45, 2),
    load_index: round(seed.state.load_index ?? 0.75 + rand() * 0.45, 2),
    balance_index: round(seed.state.balance_index ?? 0.45 + rand() * 0.45, 2),
    revision_debt: seed.state.revision_debt ?? Math.round(2 + rand() * 14),
    risk_score: seed.risk_score,
    mock_avg: derived.mock_avg,
    mock_trend: derived.mock_trend,
    syllabus_pct: seed.state.syllabus_pct ?? round(55 + rand() * 32, 1),
    computed_at: isoDateTime(0, 5),
  };
}

export function studentListRow(seed: Seed): StudentList {
  const batch = batches.find((b) => b.id === seed.batchId)!;
  const mentor = mentors.find((m) => m.id === seed.mentorId)!;
  const derived = derivedScores(seed.id);
  return {
    id: seed.id,
    name: seed.name,
    roll_no: seed.roll_no,
    batch_name: batch.name,
    mentor_name: mentor.name,
    target: seed.target,
    risk_score: seed.risk_score,
    mock_trend: derived.mock_trend,
    mock_avg: derived.mock_avg,
    open_flags: seed.open_flags,
    exited_at: seed.exited_at ?? null,
  };
}

export function studentDetail(id: number): StudentDetail | undefined {
  const seed = seedById.get(id);
  if (!seed) return undefined;
  const batch = batches.find((b) => b.id === seed.batchId)!;
  const mentor = mentors.find((m) => m.id === seed.mentorId)!;
  return {
    id: seed.id,
    name: seed.name,
    roll_no: seed.roll_no,
    target: seed.target,
    joined_at: seed.joined_at,
    exited_at: seed.exited_at ?? null,
    batch,
    mentor,
    state: stateFor(seed),
  };
}

export const studentRows: StudentList[] = seeds.map(studentListRow);

export { MAX_MARKS };
