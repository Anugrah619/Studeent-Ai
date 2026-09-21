import type { MarksLost } from "@/api/types";

/**
 * The four causes a lost mark is attributed to. They are *ordered* — hardest to
 * fix first — so they use an ordinal ramp (one hue, dark to light), not four
 * unrelated categorical hues. The ordering is the argument the chart makes.
 */
export const CAUSE_KEYS = [
  "conceptual_gap",
  "execution_error",
  "time_exhaustion",
  "avoidable_skip",
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
    needsNewLearning: true,
  },
  execution_error: {
    key: "execution_error",
    label: "Execution error",
    meaning: "Wrong, but mastery high and time normal",
    color: "var(--cause-execution)",
    ink: "#ffffff",
    needsNewLearning: false,
  },
  time_exhaustion: {
    key: "time_exhaustion",
    label: "Time exhaustion",
    meaning: "Unattempted — the clock ran out before he reached it",
    color: "var(--cause-time)",
    ink: "#ffffff",
    needsNewLearning: false,
  },
  avoidable_skip: {
    key: "avoidable_skip",
    label: "Avoidable skip",
    meaning: "Unattempted despite demonstrated competence",
    color: "var(--cause-skip)",
    ink: "#1c1428",
    needsNewLearning: false,
  },
};

export const CAUSE_LIST: CauseToken[] = CAUSE_KEYS.map((k) => CAUSES[k]);

export interface CauseSlice extends CauseToken {
  marks: number;
  sharePct: number;
}

export function causeSlices(data: MarksLost): CauseSlice[] {
  const total = data.total_lost || 1;
  return CAUSE_LIST.map((cause) => ({
    ...cause,
    marks: data[cause.key],
    sharePct: (data[cause.key] / total) * 100,
  }));
}
