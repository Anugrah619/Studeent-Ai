/**
 * What has been imported from official documents — the one set of figures on
 * the explainer pages that is NOT read from the API.
 *
 * `TestPaper.source` says where a paper came from now, and "Data & trust"
 * counts the official past papers in the bank from `usePapers()`. What no route
 * reports is in here: a syllabus's chapter count, how often the AI matched the
 * official key at import, and how many of those mismatches were our own copying
 * errors. They were counted when the documents were imported (and checked by
 * hand afterwards). Every place that shows one labels it "From our import
 * records", so it is never mistaken for a live figure.
 *
 * Change these only alongside a real import. A trust page with one invented
 * figure on it is worse than no trust page.
 */

export interface SyllabusRecord {
  exam: string;
  chapters: number;
  /** Chapters linked to a current NCERT chapter. */
  ncertLinked: number;
}

export interface PastPaperRecord {
  key: string;
  exam: string;
  /** Which sitting: the date and shift, or the booklet code. */
  sitting: string;
  /**
   * Whose copy of the question paper was read. NTA publishes JEE Main papers
   * but not NEET's, so the NEET paper is a publisher's typeset copy
   * (`data/raw/manifest.json`: "Physics Wallah (mirror)"), proven to be booklet
   * Code 45 against NTA's official key. Calling both "official" was wrong.
   */
  paperSource: string;
  questions: number;
  /** Questions where Gemini's own answer matched NTA's official key. */
  agreed: number;
  /** The agreement share as reported at import, 0–100. */
  agreedPct: number;
}

export const SYLLABI: SyllabusRecord[] = [
  { exam: "JEE Main 2026", chapters: 54, ncertLinked: 51 },
  { exam: "NEET UG 2026", chapters: 71, ncertLinked: 68 },
];

export const PAST_PAPERS: PastPaperRecord[] = [
  {
    key: "jee-main-2026-04-02-s1",
    exam: "JEE Main 2026",
    sitting: "2 April, Shift 1",
    paperSource: "NTA's published paper",
    questions: 75,
    agreed: 66,
    agreedPct: 88,
  },
  {
    key: "neet-ug-2025-code-45",
    exam: "NEET UG 2025",
    sitting: "booklet Code 45",
    paperSource: "Publisher's copy (PW)",
    questions: 180,
    agreed: 157,
    agreedPct: 87.2,
  },
];

/** Across both papers. Stated, not summed, so it cannot drift from the log. */
export const CROSS_CHECK_DISAGREEMENTS = 32;

/**
 * The disagreements were first gone through by an AI assistant, not a person
 * (`agent_review.by` in `data/extracted/*.json`: "question-factory agent
 * (Claude), not a human review"). It sided with NTA's key every time, and
 * traced two of them to copying errors in our own transcription — JEE Main
 * Q21 and NEET Q44 — rather than to the model or the key.
 */
export const CROSS_CHECK_TRANSCRIPTION_ERRORS = 2;

/** The paper the AI diagnosis runs on today — ours, not an official one. */
export const DIAGNOSTIC_PAPER = { questions: 46, misconceptions: 15 } as const;

export const IMPORT_RECORDS_NOTE =
  "Counted when the documents were imported. The system says where each paper came from, but not how many chapters a syllabus has or how often the AI matched the key, so these figures are written into this page rather than read live.";
