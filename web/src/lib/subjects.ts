/**
 * Subject identity. Categorical: one hue per subject, fixed by the subject's
 * name, never recoloured when a filter changes the series count.
 *
 * `var()` rather than a hex literal so the mark follows the theme without any
 * JS. Both palettes are validated — see the token block in `index.css`.
 *
 * SUBJECTS ARE WHATEVER THE EXAM HAS. JEE is Physics, Chemistry, Maths; NEET is
 * Physics, Chemistry, Botany, Zoology. The contract sends each exam's own list
 * (`MockScore.subjects[]`, one `SubjectBreakdown` row per syllabus subject) in
 * syllabus order, and every chart renders that list in the order given rather
 * than assuming three.
 *
 * `index.css` carries three validated subject hues. They are assigned by name,
 * so a subject keeps its colour on every screen:
 *
 *   Physics            blue    (`--subject-physics`)
 *   Chemistry          orange  (`--subject-chemistry`)
 *   Maths / Biology /  green   (`--subject-maths`) — the third slot. No exam
 *   Botany                       has both Maths and Biology, so they never meet
 *                                in one chart.
 *   anything else      neutral grey (`--status-neutral`), drawn DASHED in a
 *   (Zoology, …)                 line chart and always labelled by name, so it
 *                                is never told apart by colour alone.
 *
 * A fourth validated hue would let Zoology have its own colour; it belongs in
 * `index.css` beside the other three and is noted as a gap, not invented here.
 */

import type { MockScore } from "@/api/types";

/** The three subjects the legacy `MockScore` fields name. */
export const SUBJECT_KEYS = ["physics", "chemistry", "maths"] as const;
export type SubjectKey = (typeof SUBJECT_KEYS)[number];

export interface SubjectToken {
  /**
   * A stable identity for this subject — the hue slot for the three named
   * subjects, otherwise the normalised name. Use it for React keys and data
   * keys, never as a label.
   */
  key: string;
  label: string;
  short: string;
  /** CSS colour for marks (line, bar, swatch). */
  color: string;
  /**
   * Ink that clears 4.5:1 *on this subject's fill*, for a value label placed
   * inside its own bar. Hand-picked per hue and per theme in `index.css`;
   * `undefined` means "this fill has no verified ink", and a label on it must
   * be placed outside the mark rather than guessed at.
   */
  ink?: string;
  /** Tailwind class for a text-token-safe swatch background. */
  swatch: string;
  /**
   * True for a subject past the three validated hues. It is drawn in the
   * neutral grey, so a line chart must give it a second encoding (a dash).
   */
  neutral: boolean;
}

const HUED: Record<SubjectKey, Omit<SubjectToken, "label" | "short">> = {
  physics: {
    key: "physics",
    color: "var(--subject-physics)",
    ink: "var(--subject-physics-ink)",
    swatch: "bg-subject-physics",
    neutral: false,
  },
  chemistry: {
    key: "chemistry",
    color: "var(--subject-chemistry)",
    ink: "var(--subject-chemistry-ink)",
    swatch: "bg-subject-chemistry",
    neutral: false,
  },
  maths: {
    key: "maths",
    color: "var(--subject-maths)",
    ink: "var(--subject-maths-ink)",
    swatch: "bg-subject-maths",
    neutral: false,
  },
};

export const SUBJECTS: Record<SubjectKey, SubjectToken> = {
  physics: { ...HUED.physics, label: "Physics", short: "Phy" },
  chemistry: { ...HUED.chemistry, label: "Chemistry", short: "Chem" },
  maths: { ...HUED.maths, label: "Maths", short: "Math" },
};

/** The JEE three, for the legacy `physics` / `chemistry` / `maths` fields. */
export const SUBJECT_LIST: SubjectToken[] = SUBJECT_KEYS.map((k) => SUBJECTS[k]);

/** Which hue slot a subject name takes. */
const SLOT: Record<string, SubjectKey> = {
  physics: "physics",
  phy: "physics",
  chemistry: "chemistry",
  chem: "chemistry",
  maths: "maths",
  math: "maths",
  mathematics: "maths",
  biology: "maths",
  bio: "maths",
  botany: "maths",
};

/** How the three named subjects are spelled on screen when given an alias. */
const LABEL: Record<string, string> = {
  phy: "Physics",
  chem: "Chemistry",
  math: "Maths",
  bio: "Biology",
};

/**
 * Where a subject sits when a screen has to order subjects itself — the
 * mastery grid, which receives chapters weakest-first, not by subject. The
 * order every exam prints its own subjects in; anything unknown follows,
 * alphabetically. Charts never use this: they render the server's order.
 */
const EXAM_ORDER = [
  "physics",
  "chemistry",
  "maths",
  "mathematics",
  "biology",
  "botany",
  "zoology",
];

const norm = (raw: string) => raw.trim().toLowerCase();

/**
 * The token for one subject, by name.
 *
 * `subject` is a free-form string in the contract, so it is normalised here
 * rather than assumed. A subject outside the three hues gets the neutral
 * token instead of silently stealing another subject's hue.
 */
export function resolveSubject(raw: string | null | undefined): SubjectToken {
  const name = (raw ?? "").trim();
  const key = norm(name);
  const slot = SLOT[key];
  if (slot) {
    const isMaths = key === "maths" || key === "math" || key === "mathematics";
    const label = LABEL[key] ?? name;
    return {
      ...HUED[slot],
      // Botany and Biology share the third slot's hue, but keep their own name
      // and their own identity.
      key: slot === "maths" && !isMaths ? key : slot,
      label,
      short: label.slice(0, 4),
    };
  }
  return {
    key: key || "unknown",
    label: name || "Unmapped",
    short: name.slice(0, 4) || "—",
    color: "var(--status-neutral)",
    // A near-black that clears 5.5:1 on `--status-neutral` in the light
    // theme and 9.4:1 in the dark one — the neutral fill is mid-scale in
    // both, which is the one case a single ink can serve.
    ink: "#0a0a0a",
    swatch: "bg-status-neutral",
    neutral: true,
  };
}

/** Tokens for a list of subject names, in the order given, duplicates dropped. */
export function resolveSubjects(names: Iterable<string>): SubjectToken[] {
  const seen = new Set<string>();
  const out: SubjectToken[] = [];
  for (const name of names) {
    const token = resolveSubject(name);
    if (seen.has(token.key)) continue;
    seen.add(token.key);
    out.push(token);
  }
  return out;
}

/** Sort subject names into exam order (see `EXAM_ORDER`). */
export function compareSubjects(a: string, b: string): number {
  const rank = (s: string) => {
    const i = EXAM_ORDER.indexOf(norm(s));
    return i === -1 ? EXAM_ORDER.length : i;
  };
  return rank(a) - rank(b) || a.localeCompare(b);
}

/**
 * "Physics, Chemistry and Maths" — a list of subjects in prose, so a sentence
 * never says "three subjects" about an exam that has four.
 */
export function subjectsInWords(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * The subjects of one paper, in the order the server gave them. `subjects` is
 * the field to read — one entry per subject of the exam, on every row. A row
 * from a server too old to send it falls back to the three legacy fields.
 */
export function subjectsOf(row: MockScore): MockScore["subjects"] {
  if (row.subjects?.length) return row.subjects;
  return SUBJECT_LIST.map((s) => ({
    subject: s.label,
    marks: row[s.key as SubjectKey],
  }));
}

/** A dashed swatch for a legend, matching the dash a neutral line is drawn with. */
export function dashedSwatch(color: string): string {
  return `repeating-linear-gradient(90deg, ${color} 0 5px, transparent 5px 8px)`;
}

/** The dash a neutral subject's line is drawn with, in SVG units. */
export const NEUTRAL_DASH = "5 3";
