/**
 * `GET /api/questions/{id}/` — the route that closes the loop the diagnosis
 * card opens.
 *
 * A finding cites `D16`; the chip says "D16 chose C". This endpoint is what
 * turns that from an assertion into something a teacher can check: the stem, the
 * four options, which one is right, which one this student reached for, and — the
 * reason the endpoint is worth opening at all — the *belief* that produces the
 * option they reached for, written in their own voice.
 *
 * Three things about the response are load-bearing and neither the types nor a
 * casual read of the docs makes them obvious. All three were checked against the
 * running server, not inferred:
 *
 *   1. `options[].chosen` is **tri-state**. `null` on every option when
 *      `?student=` was not given, which is "not asked" — a different claim from
 *      `false`, "asked, and they did not pick this one". Rendering null as false
 *      shows a paper where the student appears to have answered nothing.
 *   2. `?student=` **given, but no attempt on file** is a third state again:
 *      `student_id` echoes back, `chosen` is `false` on every option, and
 *      `status`, `chosen_label`, `marks` and `time_spent` are all null. So the
 *      per-option `false` and the per-question `null` disagree on purpose, and
 *      only `student_id` tells you which of the two questions was asked.
 *   3. A student from another institute, or a non-numeric `?student=`, is a
 *      **404 on the whole question** — not a 200 with the student fields null.
 *      The panel therefore cannot treat 404 as "no data for this student".
 *
 * The field is `question_text`, not `stem`. Worth saying once, loudly, because
 * every human description of this endpoint calls it the stem.
 */
import { apiGet, ApiError } from "./client";
import type {
  Misconception,
  QuestionDetail as WireQuestionDetail,
  QuestionOption as WireQuestionOption,
  AttemptStatus,
} from "./types";

export const QUESTION_PATH = "/api/questions/{id}/";

export type { Misconception };

/** The difficulty bands, `""` (the contract's `BlankEnum`) collapsed to null. */
export type Difficulty = "easy" | "medium" | "hard";

const DIFFICULTIES = ["easy", "medium", "hard"] as const;
const STATUSES = ["correct", "wrong", "blank", "not_reached"] as const;

/**
 * One option, with `chosen` kept tri-state rather than defaulted.
 *
 * Every narrowing in this file exists to stop a component writing
 * `option.chosen ? … : …` and quietly turning "we never asked" into "they said
 * no".
 */
export type QuestionOption = Omit<WireQuestionOption, "is_correct"> & {
  is_correct: boolean;
  chosen: boolean | null;
};

export type QuestionDetail = Omit<
  WireQuestionDetail,
  "difficulty" | "question_text" | "solution" | "options" | "status"
> & {
  difficulty: Difficulty | null;
  question_text: string;
  solution: string;
  options: QuestionOption[];
  status: AttemptStatus | null;
};

/* ------------------------------------------------------------------ *
 * The three states the panel has to tell apart
 * ------------------------------------------------------------------ */

/**
 * Was this fetched *about a student* at all?
 *
 * `student_id` is the only field that answers it. `options[].chosen` cannot:
 * it is `false` both for an option a student did not pick and for a question
 * they never attempted.
 */
export function askedAboutStudent(q: QuestionDetail): boolean {
  return typeof q.student_id === "number";
}

/**
 * Does this student have an attempt on file here?
 *
 * `status` is the discriminator. When `?student=` was given and the answer is
 * no, the options come back `chosen: false` across the board — which reads
 * exactly like a wrong answer with the option stripped out unless you check
 * this first.
 */
export function hasAttempt(q: QuestionDetail): boolean {
  return askedAboutStudent(q) && q.status !== null;
}

/** The option this student picked, if any. Matched on `chosen`, not on label. */
export function chosenOption(q: QuestionDetail): QuestionOption | null {
  return q.options.find((option) => option.chosen === true) ?? null;
}

/** The right answer. Position is never assumed — the seeder shuffles labels. */
export function correctOption(q: QuestionDetail): QuestionOption | null {
  return q.options.find((option) => option.is_correct) ?? null;
}

/**
 * The misconception this student's own wrong choice reveals.
 *
 * Null when they were right, when they did not answer, or when the distractor
 * they picked has never been explained — a gap in the taxonomy rather than a
 * bug, and one the panel says out loud instead of rendering an empty block.
 */
export function chosenMisconception(q: QuestionDetail): Misconception | null {
  const chosen = chosenOption(q);
  if (!chosen || chosen.is_correct) return null;
  return chosen.misconception ?? null;
}

/**
 * The other tagged distractors — wrong options carrying a belief this student
 * did *not* fall for.
 *
 * Shown quietly and only as a count. Six of the forty tagged questions offer
 * two different misconceptions across their distractors, and a teacher reading
 * the panel needs to know that the one named above is the one that fired, not
 * the only one on offer.
 */
export function otherTaggedOptions(q: QuestionDetail): QuestionOption[] {
  return q.options.filter(
    (option) =>
      !option.is_correct && option.misconception != null && option.chosen !== true,
  );
}

export const STATUS_LABEL: Record<AttemptStatus, string> = {
  correct: "Answered correctly",
  wrong: "Answered wrongly",
  blank: "Skipped deliberately",
  not_reached: "Never reached — ran out of time",
};

/* ------------------------------------------------------------------ *
 * Parsing
 *
 * A malformed field degrades one row of the panel; it never throws inside a
 * render. Same contract as `api/diagnosis.ts`, same reason.
 * ------------------------------------------------------------------ */

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableStr(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function nullableNum(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** `true`/`false` survive; anything else — `undefined` included — is `null`. */
function triState(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function parseOption(raw: unknown): QuestionOption {
  const row = (raw ?? {}) as Record<string, unknown>;
  const m = row.misconception as Record<string, unknown> | null | undefined;
  return {
    label: str(row.label),
    text: str(row.text),
    is_correct: row.is_correct === true,
    // NOT `=== true`. An absent or malformed `chosen` is "we do not know",
    // and the panel renders that as "not asked" rather than as "not picked".
    chosen: triState(row.chosen),
    misconception:
      m && typeof m === "object"
        ? {
            code: str(m.code, "UNCODED"),
            subject: str(m.subject),
            name: str(m.name),
            description: str(m.description),
            // Optional in the contract. A tagged distractor with no remedy is
            // half an answer, and the panel says which half is missing.
            remedy: str(m.remedy),
          }
        : null,
  };
}

export function parseQuestion(raw: unknown): QuestionDetail {
  const body = (raw ?? {}) as Record<string, unknown>;
  const difficulty = DIFFICULTIES.includes(body.difficulty as Difficulty)
    ? (body.difficulty as Difficulty)
    : null;
  return {
    id: nullableNum(body.id) ?? 0,
    label: str(body.label),
    paper_id: nullableNum(body.paper_id) ?? 0,
    paper_name: str(body.paper_name),
    topic: nullableStr(body.topic),
    subject: nullableStr(body.subject),
    difficulty,
    question_text: str(body.question_text),
    solution: str(body.solution),
    options: Array.isArray(body.options) ? body.options.map(parseOption) : [],
    // The field that says whether a student was named at all. Never defaulted.
    student_id: nullableNum(body.student_id),
    chosen_label: nullableStr(body.chosen_label),
    status: STATUSES.includes(body.status as AttemptStatus)
      ? (body.status as AttemptStatus)
      : null,
    marks: nullableNum(body.marks),
    time_spent: nullableNum(body.time_spent),
  };
}

/* ------------------------------------------------------------------ *
 * The call
 * ------------------------------------------------------------------ */

export async function fetchQuestion(
  questionId: number,
  studentId: number | undefined,
  signal?: AbortSignal,
): Promise<QuestionDetail> {
  const raw = await apiGet(QUESTION_PATH, {
    path: { id: questionId },
    query: { student: studentId },
    signal,
  });
  return parseQuestion(raw);
}

/**
 * 404 — and it means one specific thing here.
 *
 * The citation did not resolve to a question this institute holds (or named a
 * student it does not hold). It is not a transient failure, so the panel says
 * so in a sentence and offers no spinner and no retry loop.
 */
export function isQuestionMissing(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}
