import type {
  Attempt,
  MarksLost,
  SubjectBreakdown,
  TopicState,
} from "@/api/types";
import type { SubjectKey } from "@/lib/subjects";
import { MAX_MARKS, SUBJECT_MAX, papers } from "./institute";
import {
  clamp,
  hashSeed,
  isoDateTime,
  mulberry32,
  round,
  splitInteger,
} from "./rng";
import { mockScoresFor } from "./students";
import { SUBJECT_LABEL, syllabus } from "./syllabus";

/* ------------------------------------------------------------------ *
 * Subject breakdown — the neglect chart
 * ------------------------------------------------------------------ */

/**
 * Aarav's shares are pinned to the concept note: Chemistry is 11% of his study
 * time and 46% of his marks lost. The marks-lost half is also what falls out of
 * his mock series (Chemistry 478 of 1,032 lost marks = 46.3%), so the chart and
 * the trend line tell the same story rather than two rounded approximations.
 */
const PINNED_TIME_SHARE: Record<number, Record<SubjectKey, number>> = {
  1: { physics: 52, chemistry: 11, maths: 37 },
};

const PINNED_ACCURACY: Record<number, Record<SubjectKey, number>> = {
  1: { physics: 54, chemistry: 31, maths: 58 },
};

const SUBJECT_ORDER: SubjectKey[] = ["physics", "chemistry", "maths"];

export function subjectBreakdownFor(studentId: number): SubjectBreakdown[] {
  const rows = mockScoresFor(studentId);
  if (!rows.length) return [];
  const rand = mulberry32(hashSeed("breakdown", studentId));

  const lost: Record<SubjectKey, number> = {
    physics: 0,
    chemistry: 0,
    maths: 0,
  };
  const scored: Record<SubjectKey, number> = {
    physics: 0,
    chemistry: 0,
    maths: 0,
  };
  for (const row of rows) {
    for (const key of SUBJECT_ORDER) {
      scored[key] += row[key];
      lost[key] += SUBJECT_MAX - row[key];
    }
  }
  const lostTotal = SUBJECT_ORDER.reduce((a, k) => a + lost[k], 0) || 1;

  const timeWeights = SUBJECT_ORDER.map(() => 0.9 + rand() * 0.5);
  const timeSum = timeWeights.reduce((a, b) => a + b, 0);

  return SUBJECT_ORDER.map((key, i) => ({
    subject: SUBJECT_LABEL[key],
    time_share_pct:
      PINNED_TIME_SHARE[studentId]?.[key] ??
      round((timeWeights[i] / timeSum) * 100, 1),
    marks_lost_share_pct: round((lost[key] / lostTotal) * 100, 1),
    accuracy_pct:
      PINNED_ACCURACY[studentId]?.[key] ??
      round(
        clamp(scored[key] / rows.length + (rand() - 0.5) * 8, 12, 92),
        1,
      ),
  }));
}

/* ------------------------------------------------------------------ *
 * Marks-lost attribution
 * ------------------------------------------------------------------ */

/** Mock 14, Aarav: 68 conceptual of 166 lost — 98 recoverable. */
const PINNED_MARKS_LOST: Record<string, [number, number, number, number]> = {
  "1:14": [68, 38, 34, 26],
};

export function marksLostFor(studentId: number, paperId: number): MarksLost | undefined {
  const row = mockScoresFor(studentId).find((r) => r.paper_id === paperId);
  if (!row) return undefined;

  const total = MAX_MARKS - row.total;
  const pinned = PINNED_MARKS_LOST[`${studentId}:${paperId}`];
  const rand = mulberry32(hashSeed("lost", studentId, paperId));
  const [conceptual, execution, time, skip] =
    pinned ??
    splitInteger(total, [
      0.40 + (rand() - 0.5) * 0.1,
      0.24 + (rand() - 0.5) * 0.08,
      0.21 + (rand() - 0.5) * 0.08,
      0.15 + (rand() - 0.5) * 0.06,
    ]);

  return {
    conceptual_gap: conceptual,
    execution_error: execution,
    time_exhaustion: time,
    avoidable_skip: skip,
    total_lost: conceptual + execution + time + skip,
    // Everything except a genuine conceptual gap needs no new learning.
    recoverable: execution + time + skip,
  };
}

/* ------------------------------------------------------------------ *
 * Topic states
 * ------------------------------------------------------------------ */

/**
 * Mastery is reported on 0–1. The contract says `number, nullable` with no
 * documented range (see API_GAPS.RISK_SCORE_BANDS for the same problem on
 * risk_score), so the UI has to pick one; it renders as a percentage.
 */
const SUBJECT_FLOOR: Record<SubjectKey, [number, number]> = {
  physics: [0.38, 0.74],
  chemistry: [0.16, 0.46],
  maths: [0.44, 0.82],
};

/** The confidence-mismatch story: Kunal rates this 4/5 and scores 31% on it. */
const PINNED_TOPICS: Record<string, { mastery: number; self_rating: number }> = {
  "4:Rotational Motion": { mastery: 0.31, self_rating: 4 },
  "1:Chemical Bonding": { mastery: 0.22, self_rating: 3 },
  "1:Coordination Compounds": { mastery: 0.18, self_rating: 2 },
};

export function topicStatesFor(studentId: number): TopicState[] {
  const rand = mulberry32(hashSeed("topics", studentId));
  const skill = 0.85 + (studentId === 1 ? 0 : rand() * 0.35);

  return syllabus.map((topic, i) => {
    const [lo, hi] = SUBJECT_FLOOR[topic.subject];
    const pinned = PINNED_TOPICS[`${studentId}:${topic.name}`];
    const mastery =
      pinned?.mastery ?? round(clamp((lo + rand() * (hi - lo)) * skill, 0.05, 0.97), 2);

    const attempts = Math.round(14 + rand() * 58);
    const correct = Math.round(attempts * clamp(mastery + (rand() - 0.5) * 0.14, 0.05, 0.98));
    const lastSeen = Math.round(rand() * 26);
    const lastRevised = lastSeen + Math.round(rand() * 22);
    const selfRating = pinned?.self_rating ?? clamp(Math.round(mastery * 5 + (rand() - 0.35)), 1, 5);
    const retention = round(clamp(mastery * (1 - lastRevised / 90) + rand() * 0.08, 0.04, 0.98), 2);

    return {
      id: studentId * 1000 + i,
      topic: {
        id: topic.id,
        name: topic.name,
        kind: "chapter",
        weight: topic.weight,
        subject: SUBJECT_LABEL[topic.subject],
      },
      mastery,
      retention,
      attempts_n: attempts,
      correct_n: correct,
      accuracy_30d: round(clamp(mastery * 100 + (rand() - 0.5) * 16, 4, 98), 1),
      exposure_min: Math.round(40 + rand() * 520),
      avg_time_spent: round(70 + rand() * 130, 1),
      self_rating: selfRating,
      confidence_gap: round(selfRating / 5 - mastery, 2),
      last_seen: isoDateTime(lastSeen, 18),
      last_revised: isoDateTime(lastRevised, 20),
    } satisfies TopicState;
  });
}

/* ------------------------------------------------------------------ *
 * Raw attempts
 * ------------------------------------------------------------------ */

export function attemptsFor(studentId: number): Attempt[] {
  const rand = mulberry32(hashSeed("attempts", studentId));
  const latest = papers[papers.length - 1];
  const states = topicStatesFor(studentId);

  return Array.from({ length: 75 }, (_, i) => {
    const state = states[i % states.length];
    const mastery = state.mastery ?? 0.4;
    const roll = rand();
    const status: Attempt["status"] =
      roll < mastery
        ? "correct"
        : roll < mastery + 0.22
          ? "wrong"
          : roll < mastery + 0.32
            ? "blank"
            : "not_reached";
    const marks = status === "correct" ? 4 : status === "wrong" ? -1 : 0;
    return {
      id: studentId * 10_000 + i,
      question_id: `${latest.name.replace(/\s+/g, "-").toUpperCase()}-Q${String(i + 1).padStart(2, "0")}`,
      topic_name: state.topic.name,
      status,
      time_spent: Math.round(30 + rand() * 210),
      marks,
      source: "mock",
      ts: isoDateTime(6, 9 + Math.floor(i / 25)),
    } satisfies Attempt;
  });
}
