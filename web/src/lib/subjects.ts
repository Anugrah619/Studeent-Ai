/**
 * Subject identity. Categorical: one hue per subject, fixed order, never
 * recoloured when a filter changes the series count.
 *
 * `var()` rather than a hex literal so the mark follows the theme without any
 * JS. Both palettes are validated — see the token block in `index.css`.
 */
export const SUBJECT_KEYS = ["physics", "chemistry", "maths"] as const;
export type SubjectKey = (typeof SUBJECT_KEYS)[number];

export interface SubjectToken {
  key: SubjectKey;
  label: string;
  short: string;
  /** CSS colour for marks (line, bar, swatch). */
  color: string;
  /** Tailwind class for a text-token-safe swatch background. */
  swatch: string;
}

export const SUBJECTS: Record<SubjectKey, SubjectToken> = {
  physics: {
    key: "physics",
    label: "Physics",
    short: "Phy",
    color: "var(--subject-physics)",
    swatch: "bg-subject-physics",
  },
  chemistry: {
    key: "chemistry",
    label: "Chemistry",
    short: "Chem",
    color: "var(--subject-chemistry)",
    swatch: "bg-subject-chemistry",
  },
  maths: {
    key: "maths",
    label: "Maths",
    short: "Math",
    color: "var(--subject-maths)",
    swatch: "bg-subject-maths",
  },
};

export const SUBJECT_LIST: SubjectToken[] = SUBJECT_KEYS.map((k) => SUBJECTS[k]);

const ALIASES: Record<string, SubjectKey> = {
  physics: "physics",
  phy: "physics",
  chemistry: "chemistry",
  chem: "chemistry",
  maths: "maths",
  math: "maths",
  mathematics: "maths",
};

/**
 * `SubjectBreakdown.subject` is a free-form string in the contract, so it is
 * normalised here rather than assumed. An unknown subject gets a neutral token
 * instead of silently stealing another subject's hue.
 */
export function resolveSubject(raw: string): SubjectToken {
  const key = ALIASES[raw.trim().toLowerCase()];
  return key
    ? SUBJECTS[key]
    : {
        key: "physics",
        label: raw,
        short: raw.slice(0, 4),
        color: "var(--status-neutral)",
        swatch: "bg-status-neutral",
      };
}
