import type { MarksLost } from "@/api/types";

/**
 * What a lost mark is put down to.
 *
 * Four of these are *causes*, ordered hardest-to-fix first, and they share one
 * ordinal ramp (one hue, dark to light) because that ordering is the argument
 * the chart makes.
 *
 * The fifth is not a cause and must never be drawn as one. `insufficient_
 * evidence` means the student has barely attempted that chapter, so the engine
 * declines to call the loss a proven gap. It is achromatic, it sits outside the
 * ramp, and it sits last.
 *
 * That separation is load-bearing. Folding these marks into `conceptual_gap`
 * would re-introduce, in the presentation layer, the exact overstatement the
 * engine was just changed to stop making — and it is the overstatement a
 * director is most likely to catch, because he knows which of his students
 * have not opened the chapter yet.
 */
export const CAUSE_KEYS = [
  "conceptual_gap",
  "execution_error",
  "time_exhaustion",
  "avoidable_skip",
  "insufficient_evidence",
] as const;

export type CauseKey = (typeof CAUSE_KEYS)[number];

export interface CauseToken {
  key: CauseKey;
  label: string;
  /** One line a director can repeat back. */
  meaning: string;
  color: string;
  /** Ink that clears contrast when set on top of this fill. */
  ink: string;
  /**
   * False for the bucket the engine refuses to attribute. Every ratio quoted
   * in prose on this screen now divides by the attributed total, so this flag
   * is what keeps the unattributed marks out of those denominators.
   */
  attributed: boolean;
  /** False when the mark is recoverable without learning anything new. */
  needsNewLearning: boolean;
}

export const CAUSES: Record<CauseKey, CauseToken> = {
  conceptual_gap: {
    key: "conceptual_gap",
    label: "Conceptual gap",
    meaning: "Wrong, and mastery on that topic was already low",
    color: "var(--cause-conceptual)",
    ink: "#ffffff",
    attributed: true,
    needsNewLearning: true,
  },
  execution_error: {
    key: "execution_error",
    label: "Execution error",
    meaning: "Wrong, but mastery high and time normal",
    color: "var(--cause-execution)",
    ink: "#ffffff",
    attributed: true,
    needsNewLearning: false,
  },
  time_exhaustion: {
    key: "time_exhaustion",
    label: "Time exhaustion",
    meaning: "Unattempted — the clock ran out before he reached it",
    color: "var(--cause-time)",
    ink: "#ffffff",
    attributed: true,
    needsNewLearning: false,
  },
  avoidable_skip: {
    key: "avoidable_skip",
    label: "Avoidable skip",
    meaning: "Unattempted despite demonstrated competence",
    color: "var(--cause-skip)",
    ink: "#1c1428",
    attributed: true,
    needsNewLearning: false,
  },
  insufficient_evidence: {
    key: "insufficient_evidence",
    label: "Not enough evidence",
    meaning:
      "Too few attempts on that chapter to call this anything — counted, not judged",
    // Achromatic on purpose: outside the ordinal ramp because it is outside
    // the taxonomy. Grey reads as "no claim". Red would read as one.
    color: "var(--cause-unattributed)",
    ink: "#0f0f0f",
    attributed: false,
    needsNewLearning: false,
  },
};

export const CAUSE_LIST: CauseToken[] = CAUSE_KEYS.map((k) => CAUSES[k]);

export interface CauseSlice extends CauseToken {
  marks: number;
  /** Share of `total_lost`, so the five slices tile the bar exactly. */
  sharePct: number;
}

/**
 * The five slices, as shares of the **whole** loss.
 *
 * `total_lost` is the right denominator here and only here: these numbers are
 * bar geometry, and the bar spans every lost mark including the ones nobody
 * will pin a cause on. Every rate quoted in prose divides by the attributed
 * total instead — see `marksLostTotals`.
 */
export function causeSlices(data: MarksLost): CauseSlice[] {
  const total = data.total_lost || 1;
  return CAUSE_LIST.map((cause) => ({
    ...cause,
    marks: data[cause.key] ?? 0,
    sharePct: ((data[cause.key] ?? 0) / total) * 100,
  }));
}

export interface MarksLostTotals {
  totalLost: number;
  /** The part of the loss with a cause behind it. */
  attributed: number;
  /** The part the engine declines to attribute. */
  unattributed: number;
  /** `recoverable` as a share of `attributed`, from the server. */
  recoverablePct: number | null;
  /** `attributed` as a share of `totalLost`. Bar and rail geometry. */
  attributedPct: number;
}

/**
 * The denominators, in one place.
 *
 * `recoverablePct` is **read, never computed**. The server divides by
 * `attributed_lost`; dividing by `total_lost` here would turn "61 of the 90 we
 * can explain" into "37% of your marks" — a weaker claim, and a false one. The
 * old code computed it, which is how the wrong denominator survived a review.
 *
 * The rest is derived, but derived so that a server which has not shipped the
 * new fields degrades to "everything is attributed" — which is exactly what
 * that server meant.
 */
export function marksLostTotals(data: MarksLost): MarksLostTotals {
  const totalLost = data.total_lost;
  const unattributed = data.insufficient_evidence ?? 0;
  const attributed = data.attributed_lost ?? totalLost - unattributed;
  return {
    totalLost,
    attributed,
    unattributed,
    recoverablePct: data.recoverable_pct ?? null,
    attributedPct: totalLost > 0 ? (attributed / totalLost) * 100 : 0,
  };
}
