/**
 * Pure derivations behind the "How it works" and "Data & trust" pages.
 *
 * Every function here *counts* — over rows the API returned — and none of them
 * estimates, rounds a claim up, or supplies a number the API did not imply.
 * That is not tidiness: the pages' whole argument is "the numbers are never
 * guessed", and a page making that argument cannot itself guess one. Anything
 * the server already computes (score, marks lost, marks at stake) is read off
 * the response and never recomputed here.
 */
import type { Attempt, AttemptStatus, Misconception } from "@/api/types";
import type { Diagnosis, Evidence, ResolvedEvidence } from "@/api/diagnosis";
import { isResolved } from "@/api/diagnosis";
import type { QuestionDetail } from "@/api/questions";
import { chosenMisconception } from "@/api/questions";

/**
 * The student every live example on the explainer pages is about.
 *
 * A *choice*, not a number the API provides: Aarav Mehta is the demo's hero on
 * the live seed and in the fixtures alike, and the pitch walks his diagnostic
 * paper. Everything shown *about* him — his paper, his answers, his diagnosis —
 * is fetched.
 */
export const EXAMPLE_STUDENT_ID = 1;

/* ------------------------------------------------------------------ *
 * The answer sheet
 * ------------------------------------------------------------------ */

export interface SheetTally {
  answered: number;
  correct: number;
  wrong: number;
  /** Skipped deliberately, and never reached — told apart, as the API does. */
  blank: number;
  notReached: number;
  total: number;
}

export function tallySheet(rows: Attempt[]): SheetTally {
  const count = (status: AttemptStatus) =>
    rows.filter((row) => row.status === status).length;
  const correct = count("correct");
  const wrong = count("wrong");
  return {
    answered: correct + wrong,
    correct,
    wrong,
    blank: count("blank"),
    notReached: count("not_reached"),
    total: rows.length,
  };
}

/** Right and wrong within one chapter, by the chapter's name on the attempt. */
export function chapterTally(
  rows: Attempt[],
  chapter: string,
): { correct: number; asked: number } {
  const inChapter = rows.filter((row) => row.topic_name === chapter);
  return {
    correct: inChapter.filter((row) => row.status === "correct").length,
    asked: inChapter.length,
  };
}

/* ------------------------------------------------------------------ *
 * What the diagnosis cites
 * ------------------------------------------------------------------ */

/** Every citation the server tied to a real answer, across all findings, once. */
export function resolvedEvidence(diagnosis: Diagnosis): ResolvedEvidence[] {
  const seen = new Map<number, ResolvedEvidence>();
  for (const hypothesis of diagnosis.hypotheses) {
    for (const row of hypothesis.evidence) {
      if (isResolved(row) && !seen.has(row.question_id)) {
        seen.set(row.question_id, row);
      }
    }
  }
  return [...seen.values()];
}

/** Every citation, resolved or not — for "N of M matched his answer sheet". */
export function allEvidence(diagnosis: Diagnosis): Evidence[] {
  const seen = new Map<string, Evidence>();
  for (const hypothesis of diagnosis.hypotheses) {
    for (const row of hypothesis.evidence) {
      if (!seen.has(row.label)) seen.set(row.label, row);
    }
  }
  return [...seen.values()];
}

/**
 * The answer-sheet labels a sentence names, matched against the sheet itself.
 *
 * API_GAPS.COUNTER_EVIDENCE_UNRESOLVED — the counter-evidence is prose. The
 * questions it names ("D22 and D23") come back with no `question_id`, so they
 * cannot be opened the way an evidence chip can. What *can* be done honestly is
 * to look each named label up in the student's own answer record and show what
 * was recorded there: the AI said he was right on D22, and the sheet says
 * whether he was.
 *
 * Matching runs from the sheet's labels into the text, never the other way —
 * a regex for "things that look like question labels" would find `SO3` in
 * "-SO3H". Only labels that exist on this paper can match, whole-word.
 */
export function labelsNamedIn(text: string, rows: Attempt[]): Attempt[] {
  if (!text) return [];
  return rows
    .filter((row) =>
      new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(row.question_id)}([^A-Za-z0-9]|$)`).test(
        text,
      ),
    )
    .sort((a, b) => text.indexOf(a.question_id) - text.indexOf(b.question_id));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ------------------------------------------------------------------ *
 * Which wrong options repeat
 * ------------------------------------------------------------------ */

export interface RepeatedMistake {
  misconception: Misconception;
  /** The questions on which the option this student chose carries this tag. */
  questions: { label: string; chose: string; questionId: number }[];
}

/**
 * Groups the cited wrong answers by the tag on the option actually chosen.
 *
 * The tag is read from the question bank (`GET /api/questions/{id}/`), not
 * from the diagnosis — so this tally is a fact about the record, checked one
 * question at a time, and holds whatever the AI made of it.
 *
 * API_GAPS.DISTRACTOR_TALLY_NOT_EXPOSED — the server counts this over *every*
 * wrong answer before it calls the model, but no route returns that count, so
 * the explainer counts over the answers the diagnosis cites and says so.
 */
export function repeatedMistakes(questions: QuestionDetail[]): RepeatedMistake[] {
  const byCode = new Map<string, RepeatedMistake>();
  for (const question of questions) {
    const tag = chosenMisconception(question);
    if (!tag) continue;
    const entry = byCode.get(tag.code) ?? { misconception: tag, questions: [] };
    entry.questions.push({
      label: question.label,
      chose: question.chosen_label ?? "",
      questionId: question.id,
    });
    byCode.set(tag.code, entry);
  }
  return [...byCode.values()].sort(
    (a, b) => b.questions.length - a.questions.length,
  );
}

/* ------------------------------------------------------------------ *
 * Privacy
 * ------------------------------------------------------------------ */

/**
 * The reference the reasoning layer sends instead of a name.
 *
 * API_GAPS.STUDENT_REF_NOT_EXPOSED — mirrors `student_ref = f"S-{student.id}"`
 * in `apps/reasoning/services/diagnose.py`. The diagnosis response does not
 * echo the pseudonym the model actually saw, so this is the one place the
 * console restates a server rule instead of reading it.
 */
export function pseudonymFor(studentId: number): string {
  return `S-${studentId}`;
}

/* ------------------------------------------------------------------ *
 * Prose
 * ------------------------------------------------------------------ */

/**
 * The name to address a student by in prose. Same rule as the diagnosis card:
 * "Md. Faizan Ali" must not become "Md.".
 */
export function firstName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return parts.find((part) => !part.endsWith(".")) ?? parts[0] ?? full;
}

/** "the student" -> "The student", for the start of a sentence. */
export function capitalise(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** "1 question", "3 questions". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
