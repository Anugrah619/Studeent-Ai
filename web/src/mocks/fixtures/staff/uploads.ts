import type {
  BlueprintReport,
  ColumnMappingField,
  ColumnMappingProfile,
  IngestBatch,
  IngestRowError,
  ResultsReport,
  TaggableQuestion,
} from "@/api/types";
import { syllabus, SUBJECT_LABEL } from "../syllabus";
import { seeds } from "../students";
import { blueprintQuestion, paperFor, questionsOf, setQuestions } from "./papers";

/**
 * The two upload routes, simulated well enough to demo every answer they give.
 *
 * A CSV is really read: its header, every row, every cell. A blueprint row is
 * checked for a question number, a chapter this syllabus has and an answer
 * key; a results row for a roll number this institute has and answers the
 * paper can mark. So a file with mistakes in it comes back with exactly those
 * mistakes, by line, and a clean one imports. An Excel file cannot be read
 * without a spreadsheet library the mock does not carry, so it gets a fixed,
 * realistic report instead — one with a problem in it, so the error path shows.
 */

/* ------------------------------------------------------------------ *
 * Reading a CSV
 * ------------------------------------------------------------------ */

interface Table {
  header: string[];
  rows: string[][];
}

function parseLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      cells.push(cell.trim());
      cell = "";
    } else cell += c;
  }
  cells.push(cell.trim());
  return cells;
}

export class Unreadable extends Error {}

export async function readTable(file: File): Promise<Table | "excel"> {
  if (/\.xlsx$/i.test(file.name)) return "excel";
  if (/\.xls$/i.test(file.name)) {
    throw new Unreadable(
      "This is a legacy .xls file. Open it in Excel and save it as .xlsx or .csv, then upload that.",
    );
  }
  const text = (await file.text()).replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) throw new Unreadable("The file is empty.");
  return { header: parseLine(lines[0]), rows: lines.slice(1).map(parseLine) };
}

/** Same bytes, same file — the server hashes the upload. */
async function fingerprint(file: File): Promise<string> {
  const text = await file.text();
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${file.size}:${h >>> 0}`;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "_");
const LETTERS = ["A", "B", "C", "D"];
/** NTA's numbered options read as the paper's letters. */
const asLetter = (raw: string) => {
  const v = raw.trim().toUpperCase();
  return /^[1-4]$/.test(v) ? LETTERS[Number(v) - 1] : v;
};

/* ------------------------------------------------------------------ *
 * POST /api/papers/{id}/blueprint/
 * ------------------------------------------------------------------ */

export async function importBlueprint(
  paperId: number,
  file: File,
  dryRun: boolean,
): Promise<{ status: number; body: BlueprintReport | { detail: string } }> {
  const paper = paperFor(paperId);
  if (!paper) return { status: 404, body: { detail: "No such paper." } };

  let table: Table | "excel";
  try {
    table = await readTable(file);
  } catch (error) {
    return { status: 400, body: { detail: (error as Error).message } };
  }

  const existing = questionsOf(paperId);
  const expected = paper.total_questions ?? existing.length;

  if (table === "excel") {
    // A clean blueprint covering the paper as it stands.
    const count = existing.length || Math.min(expected, 20);
    const report: BlueprintReport = {
      dry_run: dryRun,
      ok: true,
      paper_id: paperId,
      questions_in_file: count,
      expected_questions: expected,
      created: existing.length ? 0 : count,
      updated: 0,
      unchanged: existing.length,
      errors_total: 0,
      errors: [],
    };
    if (!dryRun && !existing.length) {
      setQuestions(
        paperId,
        Array.from({ length: count }, (_, i) => {
          const topic = syllabus[(i * 5) % syllabus.length];
          return blueprintQuestion(
            paperId * 1000 + i + 1,
            `Q${i + 1}`,
            { id: topic.id, name: topic.name, subject: SUBJECT_LABEL[topic.subject] },
            LETTERS[i % 4],
          );
        }),
      );
    }
    return { status: 200, body: report };
  }

  const header = table.header.map(norm);
  const col = (name: string) => header.indexOf(name);
  const qi = col("question_id");
  const ci = col("chapter");
  const ki = col("correct_option") >= 0 ? col("correct_option") : col("answer");
  const errors: IngestRowError[] = [];
  const missing = [
    qi < 0 ? "question_id" : null,
    ci < 0 ? "chapter" : null,
    ki < 0 ? "correct_option (or answer)" : null,
  ].filter(Boolean);
  if (missing.length) {
    errors.push({
      row: 1,
      message: `The header has no ${missing.join(", ")} column. The first row must name the columns.`,
    });
  }

  const byName = new Map(syllabus.map((t) => [t.name.toLowerCase(), t]));
  const seen = new Set<string>();
  const parsed: { label: string; topic: (typeof syllabus)[number]; key: string }[] = [];

  if (!missing.length) {
    table.rows.forEach((cells, index) => {
      const row = index + 2;
      const label = (cells[qi] ?? "").trim();
      const chapter = (cells[ci] ?? "").trim();
      const key = asLetter(cells[ki] ?? "");
      if (!label) {
        errors.push({ row, message: "No question number on this line." });
        return;
      }
      if (seen.has(label.toUpperCase())) {
        errors.push({ row, question_id: label, message: `${label} appears twice in the file.` });
        return;
      }
      seen.add(label.toUpperCase());
      const topic = byName.get(chapter.toLowerCase());
      if (!chapter) {
        errors.push({ row, question_id: label, message: "No chapter given." });
      } else if (!topic) {
        errors.push({
          row,
          question_id: label,
          message: `'${chapter}' is not a chapter of your ${/NEET/i.test(paper.name) ? "NEET UG" : "JEE Main"} syllabus.`,
        });
      }
      if (!key) {
        errors.push({ row, question_id: label, message: "No answer given. Every question needs its key." });
      } else if (!LETTERS.includes(key)) {
        errors.push({
          row,
          question_id: label,
          message: `'${cells[ki]}' is not one of A, B, C, D.`,
        });
      }
      if (topic && LETTERS.includes(key)) parsed.push({ label, topic, key });
    });
  }

  const before = new Map(existing.map((q) => [q.label.toUpperCase(), q]));
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  for (const p of parsed) {
    const prior = before.get(p.label.toUpperCase());
    if (!prior) created++;
    else if (prior.topic_id === p.topic.id && prior.correct_option === p.key) unchanged++;
    else updated++;
  }

  const ok = errors.length === 0;
  const report: BlueprintReport = {
    dry_run: dryRun,
    ok,
    paper_id: paperId,
    questions_in_file: table.rows.length,
    expected_questions: expected,
    created,
    updated,
    unchanged,
    errors_total: errors.length,
    errors: errors.slice(0, 100),
  };

  if (ok && !dryRun) {
    const next = new Map(before);
    parsed.forEach((p, i) => {
      const prior = before.get(p.label.toUpperCase());
      const topic = { id: p.topic.id, name: p.topic.name, subject: SUBJECT_LABEL[p.topic.subject] };
      next.set(
        p.label.toUpperCase(),
        prior
          ? {
              ...prior,
              topic: topic.name,
              topic_id: topic.id,
              subject: topic.subject,
              correct_option: p.key,
              options: prior.options.map((o) => ({
                ...o,
                is_correct: o.label === p.key,
                misconception: o.label === p.key ? null : o.misconception,
              })),
            }
          : blueprintQuestion(paperId * 1000 + existing.length + i + 1, p.label, topic, p.key),
      );
    });
    setQuestions(paperId, [...next.values()]);
  }
  return { status: ok ? 200 : 422, body: report };
}

/* ------------------------------------------------------------------ *
 * Mappings and batches
 * ------------------------------------------------------------------ */

const SEEDED_MAPPINGS: ColumnMappingProfile[] = [
  {
    id: 1,
    name: "OMR scanner export",
    mapping: { "Candidate No": "roll_no", Seat: "ignore", Section: "batch" },
    created_at: "2026-09-02T10:15:00+05:30",
  },
];

let mappings: ColumnMappingProfile[] = [...SEEDED_MAPPINGS];
let batches: (IngestBatch & { fingerprint: string })[] = [];
/** Students whose answers on a paper are already on file. */
const recorded = new Map<number, Set<string>>();

export function resetUploads() {
  mappings = [...SEEDED_MAPPINGS];
  batches = [];
  recorded.clear();
}

export function listMappings(): ColumnMappingProfile[] {
  return [...mappings].sort((a, b) => a.name.localeCompare(b.name));
}

export function saveMapping(name: string, mapping: Record<string, ColumnMappingField>) {
  const existing = mappings.find((m) => m.name === name);
  if (existing) existing.mapping = mapping;
  else {
    mappings.push({
      id: 1 + Math.max(0, ...mappings.map((m) => m.id)),
      name,
      mapping,
      created_at: new Date().toISOString(),
    });
  }
  return mappings.find((m) => m.name === name)!;
}

export function listBatches(): IngestBatch[] {
  return [...batches]
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
    .map(({ fingerprint: _, ...batch }) => batch);
}

/* ------------------------------------------------------------------ *
 * POST /api/ingest/results/
 * ------------------------------------------------------------------ */

const FIELDS = new Set(["roll_no", "batch", "question_id", "answer", "time_spent", "ignore"]);

export interface ResultsRequest {
  paperId: number;
  file: File;
  dryRun: boolean;
  mappingProfile?: number;
  columnMap?: string;
  saveMappingAs?: string;
}

type ResultsAnswer =
  | { status: 200 | 201 | 422; body: ResultsReport }
  | { status: 400 | 404; body: Record<string, unknown> }
  | { status: 409; body: { detail: string; batch_id: number } };

function emptyReport(paperId: number, dryRun: boolean): ResultsReport {
  return {
    dry_run: dryRun,
    ok: false,
    paper_id: paperId,
    layout: "wide",
    batch_id: null,
    students_in_file: 0,
    students_ingested: 0,
    students_already_recorded: 0,
    students_failed: 0,
    attempts_created: 0,
    attempts_already_recorded: 0,
    unmapped_questions: [],
    unkeyed_questions: [],
    ignored_columns: [],
    questions_not_in_file: [],
    duplicate_of_batch: null,
    derived_refreshed: false,
    flags_raised: null,
    errors_total: 0,
    errors: [],
  };
}

export async function importResults(request: ResultsRequest): Promise<ResultsAnswer> {
  const { paperId, file, dryRun } = request;
  const paper = paperFor(paperId);
  if (!paper) return { status: 404, body: { detail: "No such paper." } };

  // The column map: a saved profile, overlaid by the inline one.
  const merged: Record<string, string> = {};
  if (request.mappingProfile !== undefined) {
    const profile = mappings.find((m) => m.id === request.mappingProfile);
    if (!profile) return { status: 400, body: { mapping_profile: ["No such saved mapping."] } };
    Object.assign(merged, profile.mapping);
  }
  if (request.columnMap) {
    let inline: unknown;
    try {
      inline = JSON.parse(request.columnMap);
    } catch {
      return { status: 400, body: { column_map: ["That is not valid JSON."] } };
    }
    const unknown = Object.values(inline as Record<string, string>).filter((v) => !FIELDS.has(v));
    if (unknown.length) {
      return {
        status: 400,
        body: {
          column_map: [
            `Unknown field: ${unknown.join(", ")}. Use one of answer, batch, ignore, question_id, roll_no, time_spent.`,
          ],
        },
      };
    }
    Object.assign(merged, inline);
  }

  let table: Table | "excel";
  try {
    table = await readTable(file);
  } catch (error) {
    return { status: 400, body: { detail: (error as Error).message } };
  }

  const print = await fingerprint(file);
  const previous = batches.find((b) => b.fingerprint === print && b.paper_id === paperId);
  if (previous && !dryRun) {
    return {
      status: 409,
      body: {
        detail: `This exact file was already imported on ${new Date(previous.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} (${previous.rows_ok} students ingested, ${previous.rows_failed} failed). To import rows that failed, correct them and upload the new file.`,
        batch_id: previous.id,
      },
    };
  }

  const paperQuestions = questionsOf(paperId);
  const byLabel = new Map(paperQuestions.map((q) => [q.label.toUpperCase(), q]));
  const report = emptyReport(paperId, dryRun);
  report.duplicate_of_batch = previous?.id ?? null;

  if (table === "excel") {
    // A fixed, realistic report: twelve students, one with an unknown roll number.
    const sitters = seeds.filter((s) => !s.exited_at).slice(0, 11);
    report.layout = "wide";
    report.students_in_file = sitters.length + 1;
    report.students_ingested = sitters.length;
    report.students_failed = 1;
    report.attempts_created = sitters.length * paperQuestions.length;
    report.errors = [{ row: 13, roll_no: "AC-27-0999", message: "No student with roll number AC-27-0999." }];
    report.errors_total = 1;
    report.ok = paperQuestions.length > 0;
    if (!paperQuestions.length) {
      report.unmapped_questions = ["Q1", "Q2", "Q3"];
    }
    return finish(report, request, print, sitters.map((s) => s.roll_no));
  }

  // Rename columns, then read the header.
  const header = table.header.map((name) => {
    const mapped = merged[name] ?? merged[name.trim()];
    return mapped ?? norm(name);
  });
  report.ignored_columns = table.header.filter((_, i) => header[i] === "ignore");

  const rollAt = header.indexOf("roll_no");
  if (rollAt < 0) {
    report.errors = [
      {
        row: 1,
        message:
          "No roll number column. Name the column that holds roll numbers roll_no, or rename it above.",
      },
    ];
    report.errors_total = 1;
    report.students_in_file = table.rows.length;
    report.students_failed = table.rows.length;
    return { status: dryRun ? 200 : 422, body: report };
  }

  const long = header.includes("question_id") && header.includes("answer");
  report.layout = long ? "long" : "wide";
  const reserved = new Set(["roll_no", "batch", "time_spent", "ignore"]);

  // Answers per roll number, with the line each came from.
  const answers = new Map<string, { row: number; label: string; answer: string }[]>();
  const fileQuestions = new Set<string>();
  if (long) {
    const qi = header.indexOf("question_id");
    const ai = header.indexOf("answer");
    table.rows.forEach((cells, index) => {
      const roll = (cells[rollAt] ?? "").trim();
      const label = (cells[qi] ?? "").trim().toUpperCase();
      if (label) fileQuestions.add(label);
      const list = answers.get(roll) ?? [];
      list.push({ row: index + 2, label, answer: (cells[ai] ?? "").trim() });
      answers.set(roll, list);
    });
  } else {
    const candidates = header
      .map((name, i) => ({ name: table.header[i].trim().toUpperCase(), i, field: name }))
      .filter((c) => !reserved.has(c.field));
    // A column that does not look like a question number ("Name", "Centre")
    // is left out and listed, rather than read as a question nobody mapped.
    const looksLikeQuestion = (label: string) => /^[A-Z]{0,2}\d{1,3}$/.test(label);
    const columns = candidates.filter((c) => looksLikeQuestion(c.name));
    report.ignored_columns.push(
      ...candidates.filter((c) => !looksLikeQuestion(c.name)).map((c) => table.header[c.i]),
    );
    for (const c of columns) fileQuestions.add(c.name);
    table.rows.forEach((cells, index) => {
      const roll = (cells[rollAt] ?? "").trim();
      answers.set(
        roll,
        columns.map((c) => ({ row: index + 2, label: c.name, answer: (cells[c.i] ?? "").trim() })),
      );
    });
  }

  report.unmapped_questions = [...fileQuestions].filter((l) => !byLabel.has(l));
  report.unkeyed_questions = [...fileQuestions].filter(
    (l) => byLabel.has(l) && !byLabel.get(l)!.correct_option,
  );
  report.questions_not_in_file = paperQuestions
    .map((q) => q.label)
    .filter((l) => !fileQuestions.has(l.toUpperCase()));

  const rolls = new Map(seeds.map((s) => [s.roll_no.toUpperCase(), s]));
  const already = recorded.get(paperId) ?? new Set<string>();
  const ingested: string[] = [];
  const errors: IngestRowError[] = [];

  for (const [roll, list] of answers) {
    const row = list[0]?.row ?? 2;
    const student = rolls.get(roll.toUpperCase());
    if (!roll) {
      errors.push({ row, message: "No roll number on this line." });
      report.students_failed++;
      continue;
    }
    if (!student) {
      errors.push({ row, roll_no: roll, message: `No student with roll number ${roll}.` });
      report.students_failed++;
      continue;
    }
    if (student.exited_at) {
      errors.push({ row, roll_no: roll, message: `${student.name} left the institute before this paper was held.` });
      report.students_failed++;
      continue;
    }
    const bad = list.find((a) => a.answer && !LETTERS.includes(asLetter(a.answer)));
    if (bad) {
      errors.push({
        row: bad.row,
        roll_no: roll,
        message: `'${bad.answer}' is not an option for question ${bad.label} (use A, B, C, D, or leave it blank).`,
      });
      report.students_failed++;
      continue;
    }
    const marked = list.filter((a) => byLabel.has(a.label) && a.answer).length;
    if (already.has(student.roll_no)) {
      report.students_already_recorded++;
      report.attempts_already_recorded += marked;
    } else {
      report.students_ingested++;
      report.attempts_created += marked;
      ingested.push(student.roll_no);
    }
  }

  report.students_in_file = answers.size;
  report.errors_total = errors.length;
  report.errors = errors.slice(0, 100);
  report.ok =
    report.unmapped_questions.length === 0 &&
    report.unkeyed_questions.length === 0 &&
    report.students_ingested + report.students_already_recorded > 0;

  return finish(report, request, print, ingested);
}

function finish(
  report: ResultsReport,
  request: ResultsRequest,
  print: string,
  ingested: string[],
): ResultsAnswer {
  if (request.dryRun) return { status: 200, body: report };
  if (!report.ok) return { status: 422, body: report };

  const id = 1 + Math.max(0, ...batches.map((b) => b.id));
  const paper = paperFor(request.paperId)!;
  batches.push({
    id,
    filename: request.file.name,
    paper_id: paper.id,
    paper_name: paper.name,
    row_count: report.students_in_file,
    rows_ok: report.students_ingested + report.students_already_recorded,
    rows_failed: report.students_failed,
    status: "done",
    created_at: new Date().toISOString(),
    fingerprint: print,
  });
  const set = recorded.get(request.paperId) ?? new Set<string>();
  for (const roll of ingested) set.add(roll);
  recorded.set(request.paperId, set);
  for (const q of questionsOf(request.paperId)) (q as TaggableQuestion).has_answers = true;

  if (request.saveMappingAs?.trim() && request.columnMap) {
    saveMapping(request.saveMappingAs.trim(), JSON.parse(request.columnMap));
  }
  return {
    status: 201,
    body: {
      ...report,
      batch_id: id,
      derived_refreshed: true,
      flags_raised: report.students_ingested > 3 ? 1 : 0,
    },
  };
}
