import type { IngestBatch, PaperSource, Verification } from "@/api/types";

/**
 * Where a paper came from, said out loud — the product must always be able to
 * say this (`TestPaper.source`).
 */
export const SOURCE: Record<PaperSource, { label: string; long: string }> = {
  institute: {
    label: "Your institute's own",
    long: "Your institute's own mock, with the blueprint and results you uploaded.",
  },
  official_pyq: {
    label: "Official past paper",
    long: "An official past paper, loaded from the published paper and the official answer key.",
  },
  demo: {
    label: "Demo, written by us",
    long: "A paper we wrote for the demo. Its students and their answers are simulated.",
  },
  generated: {
    label: "Generated",
    long: "A generated paper.",
  },
};

export const SOURCE_ORDER: PaperSource[] = ["institute", "official_pyq", "demo", "generated"];

/** Exam codes as a person says them. Unknown codes are shown as they are. */
const EXAM_NAME: Record<string, string> = {
  JEE_MAIN: "JEE Main",
  JEE_ADV: "JEE Advanced",
  NEET_UG: "NEET UG",
};

export function examName(code: string): string {
  const key = code.toUpperCase().replace(/-/g, "_");
  return EXAM_NAME[key] ?? code;
}

/** Trust in a question's answer key, in words. Blank is "not cross-checked". */
export const VERIFICATION: Record<Verification | "", { label: string; trusted: boolean }> = {
  "": { label: "Key not cross-checked", trusted: true },
  agreed: { label: "Key confirmed by the cross-check", trusted: true },
  disagreed: { label: "Key disputed, waiting for review", trusted: false },
  unverifiable: { label: "Key could not be checked", trusted: false },
  key_stands: { label: "Key reviewed: stands", trusted: true },
  key_wrong: { label: "Key reviewed: wrong", trusted: false },
  key_unclear: { label: "Key reviewed: unclear", trusted: false },
};

export const BATCH_STATUS: Record<NonNullable<IngestBatch["status"]>, string> = {
  pending: "In progress",
  done: "Imported",
  failed: "Failed",
};

/** "12.4 KB". */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
