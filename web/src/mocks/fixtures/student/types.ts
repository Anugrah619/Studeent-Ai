/**
 * One NCERT chapter a syllabus chapter points to — the shape `MyTopic.ncert_ref`
 * documents in words (the contract types the field as `unknown`). The app
 * parses it defensively in `api/student.ts`; the fixtures write it exactly.
 */
export interface NcertRef {
  class: number;
  subject: string;
  book: string;
  chapter: number;
  title: string;
  pdf: string;
  sections?: string[];
}

/** One paper a persona sat: its name, date, maximum and marks per subject. */
export interface PaperSeed {
  id: number;
  name: string;
  /** Days before today it was held. */
  daysAgo: number;
  maxMarks: number;
  questions: number;
  /** Marks per subject, in the syllabus's subject order. */
  marks: number[];
}

/** A wrong (or blank) answer the persona can open, or not. */
export interface AttemptSeed {
  paperId: number;
  label: string;
  topic: string;
  status: "wrong" | "blank" | "not_reached";
  chosen: string;
  marks: number;
  seconds: number | null;
  /** Null when the paper has no question content on file. */
  questionPk: number | null;
}

/** A question the persona answered, as the student route shows it. */
export interface QuestionSeed {
  pk: number;
  label: string;
  paperId: number;
  topic: string;
  subject: string;
  difficulty: "easy" | "medium" | "hard";
  text: string;
  solution: string;
  /** In label order. `correct` is the right one. */
  options: { label: string; text: string }[];
  correct: string;
  chosen: string | null;
  status: "correct" | "wrong" | "blank" | "not_reached";
  marks: number;
  seconds: number | null;
}
