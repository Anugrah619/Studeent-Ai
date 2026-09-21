import type { Flag, Intervention } from "@/api/types";
import { batches, mentors } from "./institute";
import { isoDateTime } from "./rng";
import { seedById } from "./students";

interface FlagSeed {
  id: number;
  studentId: number;
  type: string;
  severity: Flag["severity"];
  topic: string;
  headline: string;
  evidence: Record<string, string | number>;
  raisedDaysAgo: number;
  resolvedDaysAgo?: number;
  outcome?: Flag["outcome"];
}

/**
 * Ten open flags across 312 students. That ratio is deliberate — a console that
 * cries wolf in week one is ignored by week three, and a director reads a short
 * list as evidence the detectors are tuned.
 */
const seeds: FlagSeed[] = [
  {
    id: 101,
    studentId: 1,
    type: "subject_imbalance",
    severity: "critical",
    topic: "Chemistry",
    headline:
      "Chemistry is 11% of study time and 46% of marks lost — the gap has widened for 5 straight mocks",
    evidence: {
      time_share_pct: 11,
      marks_lost_share_pct: 46,
      mocks_widening: 5,
      chemistry_delta: -17,
    },
    raisedDaysAgo: 3,
  },
  {
    id: 102,
    studentId: 1,
    type: "plateau",
    severity: "high",
    topic: "Coordination Compounds",
    headline:
      "Mastery flat at 0.18 across 34 attempts and 6.2 hours of exposure",
    evidence: {
      mastery: 0.18,
      attempts: 34,
      exposure_hours: 6.2,
      slope_per_mock: 0.004,
    },
    raisedDaysAgo: 9,
  },
  {
    id: 103,
    studentId: 2,
    type: "overload",
    severity: "critical",
    topic: "All subjects",
    headline:
      "Study hours up 31% while accuracy fell 11 points — the overload signature",
    evidence: {
      hours_delta_pct: 31,
      accuracy_delta_pts: -11,
      load_index: 1.34,
      window_days: 21,
    },
    raisedDaysAgo: 2,
  },
  {
    id: 104,
    studentId: 2,
    type: "revision_overdue",
    severity: "high",
    topic: "9 high-weight chapters",
    headline: "9 chapters worth 38% of the paper are below the recall floor",
    evidence: {
      chapters_overdue: 9,
      paper_weight_pct: 38,
      worst_retention: 0.21,
      days_since_revision: 27,
    },
    raisedDaysAgo: 11,
  },
  {
    id: 105,
    studentId: 3,
    type: "disengagement",
    severity: "watch",
    topic: "All subjects",
    headline: "Zero practice logs in 9 days — attendance unaffected",
    evidence: {
      days_since_log: 9,
      baseline_logs_per_week: 11,
      attendance_pct: 96,
    },
    raisedDaysAgo: 4,
  },
  {
    id: 106,
    studentId: 4,
    type: "confidence_mismatch",
    severity: "watch",
    topic: "Rotational Motion",
    headline: "Rates this 4 of 5; scores 31% on it across 3 mocks",
    evidence: {
      self_rating: 4,
      mastery: 0.31,
      mocks_confirming: 3,
      confidence_gap: 0.49,
    },
    raisedDaysAgo: 6,
  },
  {
    id: 107,
    studentId: 5,
    type: "over_attempting",
    severity: "watch",
    topic: "All subjects",
    headline:
      "Attempts 82 of 75 questions — negative marking now exceeds the gain",
    evidence: {
      attempted: 82,
      optimal_attempts: 75,
      negative_marks: -19,
      marginal_gain: 12,
    },
    raisedDaysAgo: 5,
  },
  {
    id: 108,
    studentId: 6,
    type: "weak_topic",
    severity: "improving",
    topic: "Application of Derivatives",
    headline:
      "Maths accuracy 44% → 67% in the three weeks since mentor contact",
    evidence: {
      accuracy_before_pct: 44,
      accuracy_after_pct: 67,
      weeks_since_contact: 3,
      mocks_since: 2,
    },
    raisedDaysAgo: 21,
  },
  {
    id: 109,
    studentId: 9,
    type: "weak_topic",
    severity: "watch",
    topic: "Chemical Thermodynamics",
    headline: "Below the mastery floor after 34 attempts",
    evidence: { mastery: 0.24, attempts: 34, floor: 0.35 },
    raisedDaysAgo: 7,
  },
  {
    id: 110,
    studentId: 12,
    type: "weak_topic",
    severity: "watch",
    topic: "Conic Sections",
    headline: "Mastery 0.28 with 41 attempts and no upward slope",
    evidence: { mastery: 0.28, attempts: 41, slope_per_mock: -0.002 },
    raisedDaysAgo: 12,
  },

  /* Closed — this is what makes a contract renew. */
  {
    id: 90,
    studentId: 6,
    type: "weak_topic",
    severity: "high",
    topic: "Application of Derivatives",
    headline: "Maths mastery 0.31 across 4 mocks",
    evidence: { mastery: 0.31, attempts: 52 },
    raisedDaysAgo: 42,
    resolvedDaysAgo: 14,
    outcome: "recovered",
  },
  {
    id: 91,
    studentId: 8,
    type: "disengagement",
    severity: "watch",
    topic: "All subjects",
    headline: "Practice logs down 70% against her own baseline",
    evidence: { logs_delta_pct: -70, days: 12 },
    raisedDaysAgo: 55,
    resolvedDaysAgo: 33,
    outcome: "recovered",
  },
  {
    id: 92,
    studentId: 14,
    type: "overload",
    severity: "critical",
    topic: "All subjects",
    headline: "Hours up 44%, accuracy down 19 points, two mocks missed",
    evidence: { hours_delta_pct: 44, accuracy_delta_pts: -19, mocks_missed: 2 },
    raisedDaysAgo: 71,
    resolvedDaysAgo: 40,
    outcome: "declined",
  },
  {
    id: 93,
    studentId: 10,
    type: "revision_overdue",
    severity: "high",
    topic: "6 high-weight chapters",
    headline: "6 chapters past the recall floor before Mock 11",
    evidence: { chapters_overdue: 6, worst_retention: 0.29 },
    raisedDaysAgo: 48,
    resolvedDaysAgo: 29,
    outcome: "recovered",
  },
  {
    id: 94,
    studentId: 7,
    type: "over_attempting",
    severity: "watch",
    topic: "All subjects",
    headline: "Attempted 79 of 75 with negative marking at −21",
    evidence: { attempted: 79, negative_marks: -21 },
    raisedDaysAgo: 60,
    resolvedDaysAgo: 38,
    outcome: "recovered",
  },
  {
    id: 95,
    studentId: 13,
    type: "confidence_mismatch",
    severity: "watch",
    topic: "Electrochemistry",
    headline: "Rated 5 of 5; scored 38% across 2 mocks",
    evidence: { self_rating: 5, mastery: 0.38 },
    raisedDaysAgo: 64,
    resolvedDaysAgo: 51,
    outcome: "unknown",
  },
];

/**
 * The generated `Flag` marks server-computed fields `readonly`. The fixture
 * store is the server here, so it holds a writable copy — logging an
 * intervention has to be able to close a flag.
 */
export type MutableFlag = { -readonly [K in keyof Flag]: Flag[K] };

function toFlag(seed: FlagSeed): MutableFlag {
  const student = seedById.get(seed.studentId)!;
  const batch = batches.find((b) => b.id === student.batchId)!;
  const mentor = mentors.find((m) => m.id === student.mentorId)!;
  return {
    id: seed.id,
    student_id: seed.studentId,
    student_name: student.name,
    batch_name: batch.name,
    mentor_name: mentor.name,
    topic_name: seed.topic,
    type: seed.type,
    severity: seed.severity,
    headline: seed.headline,
    evidence: seed.evidence,
    rule_version: "v0.4.1",
    raised_at: isoDateTime(seed.raisedDaysAgo, 6),
    resolved_at:
      seed.resolvedDaysAgo === undefined ? null : isoDateTime(seed.resolvedDaysAgo, 15),
    outcome: seed.outcome ?? "",
    is_open: seed.resolvedDaysAgo === undefined,
  };
}

export const flags: MutableFlag[] = seeds.map(toFlag);

/** Interventions logged during the session live here so the UI can echo them. */
export const interventions: Intervention[] = [];
