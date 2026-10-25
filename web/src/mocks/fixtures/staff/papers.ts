import type {
  Misconception,
  OptionContentUpdate,
  PaperQuestions,
  QuestionContentUpdate,
  TaggableOption,
  TaggableQuestion,
  TestPaper,
  TestPaperCreateRequest,
} from "@/api/types";
import { papers as basePapers } from "../institute";
import { isoDate } from "../rng";
import { SUBJECT_LABEL, syllabus } from "../syllabus";
import { PAPER_17 } from "./paper17";
import { TAXONOMY } from "./taxonomy";

/**
 * The mock server's papers: the seeded demo papers, one paper of the
 * institute's own with its blueprint already uploaded (so the results upload
 * can be demoed straight away), and any paper added in the session.
 *
 * Questions live in a per-paper store that the blueprint upload writes and the
 * tagging PATCH edits. "Mock 15 — Diagnostic" starts from the live server's
 * transcript; the institute's own paper starts as a blueprint only — chapters
 * and answers, no text — which is what a real one looks like after step two.
 */

export const INSTITUTE_PAPER_ID = 31;

const institutePaper: TestPaper = {
  id: INSTITUTE_PAPER_ID,
  name: "Aarambh Mock 16",
  held_on: isoDate(1),
  total_questions: 20,
  max_marks: 80,
  duration_min: 60,
  source: "institute",
};

let created: TestPaper[] = [];
const exams = new Map<number, string>();
const questions = new Map<number, TaggableQuestion[]>();

const LETTERS = ["A", "B", "C", "D"];

function blankOptions(correct: string): TaggableOption[] {
  return LETTERS.map((label) => ({
    label,
    text: "",
    is_correct: label === correct,
    misconception: null,
    draft_misconception: null,
  }));
}

/** A question as a blueprint row leaves it: a chapter and a key, nothing else. */
export function blueprintQuestion(
  id: number,
  label: string,
  topic: { id: number; name: string; subject: string } | null,
  correct: string | null,
): TaggableQuestion {
  return {
    id,
    label,
    topic: topic?.name ?? null,
    topic_id: topic?.id ?? null,
    subject: topic?.subject ?? null,
    answer_type: "mcq",
    correct_option: correct,
    official_answer: "",
    question_text: "",
    solution: "",
    difficulty: "",
    verification: "",
    has_answers: false,
    options: blankOptions(correct ?? ""),
  };
}

function seedQuestions() {
  questions.clear();
  // A deep copy: the PATCH handler edits these in place.
  const diagnostic: TaggableQuestion[] = JSON.parse(JSON.stringify(PAPER_17.questions));
  // One proposal waiting for a person, as the question factory's tagger leaves
  // them: a belief the taxonomy does not have yet. Demo content, not a
  // transcript — the live paper has none pending.
  const d01 = diagnostic.find((q) => q.label === "D01");
  const option = d01?.options.find((o) => o.label === "B");
  if (option && !option.misconception) {
    option.draft_misconception = {
      code: "MIS-ROT-POINTMASS",
      name: "Rod treated as a point mass at its end",
      description:
        "The whole mass of the rod sits at the far end, so the moment of inertia about the other end is simply M times L squared.",
      is_new: true,
      proposed_by: "model",
      status: "draft",
    };
  }
  questions.set(17, diagnostic);

  const own = Array.from({ length: 20 }, (_, i) => {
    const topic = syllabus[(i * 3) % syllabus.length];
    return blueprintQuestion(
      3100 + i + 1,
      `Q${i + 1}`,
      { id: topic.id, name: topic.name, subject: SUBJECT_LABEL[topic.subject] },
      LETTERS[(i * 7) % 4],
    );
  });
  questions.set(INSTITUTE_PAPER_ID, own);
}

function seedAll() {
  created = [];
  exams.clear();
  exams.set(INSTITUTE_PAPER_ID, "JEE_MAIN");
  seedQuestions();
}
seedAll();

/** Back to the seeded state. Tests call this between cases. */
export function resetPapers() {
  seedAll();
}

/** Newest first, as `TestPaper.Meta.ordering` has it. */
export function allPapers(): TestPaper[] {
  return [...basePapers, institutePaper, ...created].sort((a, b) =>
    b.held_on.localeCompare(a.held_on),
  );
}

export function paperFor(id: number): TestPaper | undefined {
  return allPapers().find((p) => p.id === id);
}

export function questionsOf(paperId: number): TaggableQuestion[] {
  return questions.get(paperId) ?? [];
}

export function setQuestions(paperId: number, rows: TaggableQuestion[]) {
  questions.set(paperId, rows);
}

/* ------------------------------------------------------------------ *
 * POST /api/papers/
 * ------------------------------------------------------------------ */

export function createPaper(
  body: Partial<TestPaperCreateRequest>,
): { ok: true; paper: TestPaper } | { ok: false; errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {};
  if (!body.name?.trim()) errors.name = ["This field may not be blank."];
  if (!body.exam?.trim()) errors.exam = ["This field may not be blank."];
  if (!body.held_on || !/^\d{4}-\d{2}-\d{2}$/.test(body.held_on)) {
    errors.held_on = ["Date has wrong format. Use one of these formats instead: YYYY-MM-DD."];
  }
  if (body.total_questions !== undefined && !(body.total_questions >= 1)) {
    errors.total_questions = ["Ensure this value is greater than or equal to 1."];
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  if (allPapers().some((p) => p.name === body.name!.trim() && p.held_on === body.held_on)) {
    return {
      ok: false,
      errors: {
        non_field_errors: [
          "A paper with this name was already held on that date. If it is a different paper, give it another name.",
        ],
      },
    };
  }

  const neet = /NEET/i.test(body.exam!);
  const total = body.total_questions ?? (neet ? 180 : 75);
  const paper: TestPaper = {
    id: 40 + created.length,
    name: body.name!.trim(),
    held_on: body.held_on!,
    total_questions: total,
    max_marks: body.max_marks ?? total * (body.marks_correct ?? 4),
    duration_min: body.duration_min ?? 180,
    source: "institute",
  };
  created.push(paper);
  exams.set(paper.id, body.exam!);
  questions.set(paper.id, []);
  return { ok: true, paper };
}

/* ------------------------------------------------------------------ *
 * GET /api/papers/{id}/questions/
 * ------------------------------------------------------------------ */

export function paperQuestions(paperId: number): PaperQuestions | null {
  const paper = paperFor(paperId);
  if (!paper) return null;
  const rows = questionsOf(paperId);
  const wrong = rows.flatMap((q) =>
    q.answer_type === "mcq" ? q.options.filter((o) => !o.is_correct) : [],
  );
  return {
    paper_id: paper.id,
    paper_name: paper.name,
    paper_source: paper.source,
    held_on: paper.held_on,
    summary: {
      questions: rows.length,
      with_text: rows.filter((q) => q.question_text.trim()).length,
      wrong_options: wrong.length,
      wrong_options_tagged: wrong.filter((o) => o.misconception).length,
      wrong_options_with_draft: wrong.filter(
        (o) => !o.misconception && o.draft_misconception?.status === "draft",
      ).length,
    },
    questions: rows,
  };
}

/* ------------------------------------------------------------------ *
 * GET /api/misconceptions/?subject=
 * ------------------------------------------------------------------ */

/** Spellings of one subject match each other, as the server's do. */
function canonical(subject: string): string {
  const s = subject.trim().toLowerCase();
  if (s === "botany" || s === "zoology" || s === "bio") return "biology";
  if (s === "mathematics" || s === "math") return "maths";
  return s;
}

export function misconceptionsFor(subject: string | null): Misconception[] {
  if (!subject?.trim()) return TAXONOMY;
  return TAXONOMY.filter((m) => canonical(m.subject) === canonical(subject));
}

/* ------------------------------------------------------------------ *
 * PATCH /api/papers/{id}/questions/{question_pk}/
 *
 * The server's rules, in the server's words: all or nothing, every problem
 * at once, option errors aligned with the request's own `options`.
 * ------------------------------------------------------------------ */

export type EditOutcome =
  | { status: 200; question: TaggableQuestion }
  | { status: 400; body: Record<string, unknown> }
  | { status: 404; body: { detail: string } };

export function applyEdit(
  paperId: number,
  questionPk: number,
  body: QuestionContentUpdate,
): EditOutcome {
  const rows = questionsOf(paperId);
  const question = rows.find((q) => q.id === questionPk);
  if (!paperFor(paperId) || !question) {
    return { status: 404, body: { detail: "No such question on this paper." } };
  }

  const edits: OptionContentUpdate[] = body.options ?? [];
  if (edits.length) {
    if (question.answer_type === "numerical" || !question.options.length) {
      return {
        status: 400,
        body: { options: ["This is a numerical-value question; it has no options to describe."] },
      };
    }
    const labels = edits.map((e) => e.label.toUpperCase());
    const repeated = [...new Set(labels.filter((l, i) => labels.indexOf(l) !== i))];
    if (repeated.length) {
      return {
        status: 400,
        body: { options: [`Option ${repeated.join(", ")} appears more than once in the request.`] },
      };
    }

    const errors = edits.map((edit) => {
      const problems: Record<string, string[]> = {};
      const option = question.options.find(
        (o) => o.label.toUpperCase() === edit.label.toUpperCase(),
      );
      if (!option) {
        problems.label = [
          `There is no option '${edit.label}' on this question; its options are ${question.options
            .map((o) => o.label)
            .join(", ")}.`,
        ];
        return problems;
      }
      const tagging = edit.misconception_code != null && edit.misconception_code !== "";
      const proposing = edit.draft_misconception != null;
      const field = tagging ? "misconception_code" : "draft_misconception";
      if (tagging && proposing) {
        problems.draft_misconception = [
          "Give either a misconception from the taxonomy or a proposal for a new one, not both.",
        ];
      }
      if ((tagging || proposing) && option.is_correct) {
        problems[field] = [
          `Option ${option.label} is the correct answer, and the correct option cannot carry a misconception.`,
        ];
      } else if ((tagging || proposing) && question.verification === "key_wrong") {
        problems[field] = [
          "A reviewer found this question's answer key wrong, so which options are wrong is not settled. Correct the key (or the option text) and review it again before describing its options.",
        ];
      } else if (tagging) {
        const code = String(edit.misconception_code).trim().toUpperCase();
        const found = TAXONOMY.find((m) => m.code.toUpperCase() === code);
        if (!found) {
          problems.misconception_code = [`'${edit.misconception_code}' is not in the misconception taxonomy.`];
        } else if (!question.subject) {
          problems.misconception_code = [
            "This question has no chapter or subject yet, so no misconception can be checked against it. Map it to a chapter first.",
          ];
        } else if (canonical(found.subject) !== canonical(question.subject)) {
          problems.misconception_code = [
            `${found.code} is a ${found.subject} misconception; this is a ${question.subject} question.`,
          ];
        }
      }
      return problems;
    });
    if (errors.some((e) => Object.keys(e).length)) {
      return { status: 400, body: { options: errors } };
    }
  }

  // Valid: write all of it.
  if (body.question_text !== undefined) question.question_text = body.question_text;
  if (body.solution !== undefined) question.solution = body.solution;
  for (const edit of edits) {
    const option = question.options.find((o) => o.label.toUpperCase() === edit.label.toUpperCase())!;
    if (edit.text !== undefined) option.text = edit.text;
    if (edit.misconception_code !== undefined) {
      const code = edit.misconception_code ? edit.misconception_code.trim().toUpperCase() : "";
      const found = TAXONOMY.find((m) => m.code.toUpperCase() === code);
      option.misconception = found ? { code: found.code, name: found.name } : null;
      if (found && option.draft_misconception?.status === "draft") {
        option.draft_misconception = {
          ...option.draft_misconception,
          status: option.draft_misconception.code === found.code ? "accepted" : "superseded",
        };
      }
    }
    if (edit.draft_misconception !== undefined) {
      option.draft_misconception = edit.draft_misconception
        ? {
            code: "",
            name: edit.draft_misconception.name,
            description: edit.draft_misconception.description,
            is_new: true,
            proposed_by: "console",
            status: "draft",
          }
        : null;
    }
  }
  return { status: 200, question };
}
