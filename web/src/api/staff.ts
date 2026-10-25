/**
 * The console's staff tools: student logins, papers and their uploads, tagging,
 * the answer-key review queue, and a student's own activity as a mentor reads
 * it on Student 360.
 *
 * Kept out of `queries.ts` so the two frontend tracks of this round touch
 * different files. Every shape is an alias into the generated contract
 * (`types.ts`); nothing here is hand-written.
 *
 * Two kinds of request are not `client.ts`'s typed `apiGet`/`apiPost`, and both
 * go through `send()` below rather than a second fetch wrapper:
 *
 *   - **Uploads** are `multipart/form-data`, and their "failures" are answers:
 *     a blueprint check that finds bad rows is a 422 *with the report*, and a
 *     results file sent twice is a 409 with the batch it duplicates. Treating
 *     those as thrown errors would lose the very report the screen exists to
 *     show, so `send()` hands the status and the body back and lets the caller
 *     say which statuses carry a report.
 *   - **Tagging** is a `PATCH`, which `client.ts` has no verb for.
 *
 * `send()` keeps the same session rules as `client.ts`: cookies on every
 * request, the CSRF token re-read before every unsafe one.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { API_BASE, ApiError, apiGet, apiGetRows, apiPost, ensureCsrfToken } from "./client";
import { qk } from "./queries";
import type { paths } from "./schema";
import type {
  BlueprintReport,
  ColumnMappingField,
  ColumnMappingProfile,
  ConfidenceRating,
  IngestBatch,
  Intervention,
  KeyDisagreement,
  KeyReviewDecision,
  Misconception,
  PaperQuestions,
  PlanBlock,
  QuestionContentUpdate,
  ResultsReport,
  Revision,
  StudentCredential,
  StudyLog,
  TaggableQuestion,
  TestPaper,
  TestPaperCreateRequest,
  TopicState,
} from "./types";

/* ------------------------------------------------------------------ *
 * Keys
 * ------------------------------------------------------------------ */

export const staffKeys = {
  plan: (id: number, date: string) => ["students", id, "plan", date] as const,
  studyLogs: (id: number) => ["students", id, "study-logs"] as const,
  confidence: (id: number) => ["students", id, "confidence"] as const,
  revisions: (id: number) => ["students", id, "revisions", "pending"] as const,
  fading: (id: number) => ["students", id, "topic-states", "forgetting"] as const,
  interventions: (flagId: number) => ["flags", flagId, "interventions"] as const,
  paper: (id: number) => ["papers", id] as const,
  paperQuestions: (id: number) => ["papers", id, "questions"] as const,
  batches: ["ingest", "batches"] as const,
  mappings: ["ingest", "mappings"] as const,
  misconceptions: (subject: string | null) => ["misconceptions", subject] as const,
  disagreements: (status: ReviewFilter) => ["review", "disagreements", status] as const,
};

/* ------------------------------------------------------------------ *
 * The one request helper for multipart and PATCH
 * ------------------------------------------------------------------ */

type StaffPath = keyof paths;

/** `"/api/papers/{id}/blueprint/"` with its `{params}` filled in. */
function fill(template: StaffPath, params: Record<string, number | string>): string {
  return `${API_BASE}${template.replace(/\{(\w+)\}/g, (_, key: string) =>
    encodeURIComponent(String(params[key])),
  )}`;
}

export interface Sent<T> {
  status: number;
  body: T;
}

/**
 * One request, with the statuses that carry an answer handed back rather than
 * thrown. Any status outside `answers` (and outside 2xx) throws `ApiError`, so
 * a 400 "unreadable file" or a 429 reaches the screen as an error, exactly as
 * every other route's does.
 */
async function send<T>(
  method: "POST" | "PATCH",
  url: string,
  {
    form,
    json,
    answers = [],
  }: { form?: FormData; json?: unknown; answers?: number[] },
): Promise<Sent<T>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = await ensureCsrfToken();
  if (token) headers["X-CSRFToken"] = token;
  // No Content-Type for a form: the browser writes the multipart boundary.
  if (json !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(url, {
    method,
    credentials: "include",
    headers,
    body: form ?? (json === undefined ? undefined : JSON.stringify(json)),
  });
  const body: unknown =
    response.status === 204 ? null : await response.json().catch(() => null);

  if (response.ok || answers.includes(response.status)) {
    return { status: response.status, body: body as T };
  }
  throw new ApiError(response.status, url, body);
}

/** `true`/`false` as a multipart field, the way DRF's BooleanField reads it. */
const flag = (value: boolean) => (value ? "true" : "false");

/* ------------------------------------------------------------------ *
 * Student logins
 *
 * Deliberately NOT React Query. A mutation keeps its last result in the
 * mutation cache until it is garbage-collected, and a query would keep it in
 * the query cache: either way a temporary password would outlive the dialog
 * that showed it. Here it lives in one component's state, and `clear()` —
 * called when the dialog closes — is the only copy going away.
 * ------------------------------------------------------------------ */

export type CredentialAction = "issue" | "reset";

function requestCredential(action: CredentialAction, studentId: number) {
  return action === "issue"
    ? apiPost("/api/students/{id}/account/", { path: { id: studentId }, body: {} })
    : apiPost("/api/students/{id}/account/reset-password/", {
        path: { id: studentId },
        body: {},
      });
}

export function useCredentialAction() {
  const queryClient = useQueryClient();
  const [credential, setCredential] = useState<StudentCredential | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [pending, setPending] = useState(false);
  // A request still in flight when the dialog closes must not write its
  // password into a dialog nobody is looking at.
  const generation = useRef(0);

  const run = useCallback(
    async (action: CredentialAction, studentId: number) => {
      const mine = ++generation.current;
      setPending(true);
      setError(null);
      setCredential(null);
      try {
        const result = await requestCredential(action, studentId);
        if (mine !== generation.current) return;
        setCredential(result);
      } catch (caught) {
        if (mine !== generation.current) return;
        setError(caught instanceof Error ? caught : new Error(String(caught)));
      } finally {
        if (mine === generation.current) setPending(false);
        // The login status moved (none → awaiting first sign-in), whatever
        // this dialog does next. The password is not in what refetches.
        void queryClient.invalidateQueries({ queryKey: ["students"] });
      }
    },
    [queryClient],
  );

  const clear = useCallback(() => {
    generation.current += 1;
    setCredential(null);
    setError(null);
    setPending(false);
  }, []);

  return { run, clear, credential, error, pending };
}

/* ------------------------------------------------------------------ *
 * Student 360: the student's own activity, read by their mentor
 * ------------------------------------------------------------------ */

/** Today, `YYYY-MM-DD`, in the browser's timezone — the day the mentor means. */
export function todayIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * This student's plan for one day.
 *
 * `/api/students/{id}/plan/`, not `/api/my/plan/`: the latter answers for
 * whoever is signed in, and a mentor has no plan of their own — so the panel
 * built on it was always empty for exactly the reader it was for.
 */
export function useStudentPlan(id: number, date: string) {
  return useQuery<PlanBlock[], Error>({
    queryKey: staffKeys.plan(id, date),
    queryFn: ({ signal }) =>
      apiGetRows("/api/students/{id}/plan/", { path: { id }, query: { date }, signal }),
    enabled: Number.isFinite(id),
  });
}

export function useStudyLogs(id: number) {
  return useQuery<StudyLog[], Error>({
    queryKey: staffKeys.studyLogs(id),
    queryFn: ({ signal }) =>
      apiGetRows("/api/students/{id}/study-logs/", { path: { id }, signal }),
    enabled: Number.isFinite(id),
  });
}

export function useConfidenceHistory(id: number) {
  return useQuery<ConfidenceRating[], Error>({
    queryKey: staffKeys.confidence(id),
    queryFn: ({ signal }) =>
      apiGetRows("/api/students/{id}/confidence/", { path: { id }, signal }),
    enabled: Number.isFinite(id),
  });
}

/** Revisions not yet done — overdue first, then soonest. */
export function useRevisions(id: number) {
  return useQuery<Revision[], Error>({
    queryKey: staffKeys.revisions(id),
    queryFn: ({ signal }) =>
      apiGetRows("/api/students/{id}/revisions/", {
        path: { id },
        query: { pending: true },
        signal,
      }),
    enabled: Number.isFinite(id),
    // The server sorts soonest first, which already puts overdue cycles on top;
    // the sort here says so in code rather than leaving it to the reader.
    select: (rows) =>
      [...rows].sort(
        (a, b) =>
          Number(b.is_overdue) - Number(a.is_overdue) ||
          a.scheduled_for.localeCompare(b.scheduled_for),
      ),
  });
}

/** Chapters whose forecast recall is below one half, fastest-fading first. */
export function useFadingTopics(id: number) {
  return useQuery<TopicState[], Error>({
    queryKey: staffKeys.fading(id),
    queryFn: ({ signal }) =>
      apiGetRows("/api/students/{id}/topic-states/", {
        path: { id },
        query: { forgetting: true },
        signal,
      }),
    enabled: Number.isFinite(id),
  });
}

/** What was done about one flag, newest first. Fetched only when shown. */
export function useFlagInterventions(flagId: number, enabled = true) {
  return useQuery<Intervention[], Error>({
    queryKey: staffKeys.interventions(flagId),
    queryFn: ({ signal }) =>
      apiGetRows("/api/flags/{id}/interventions/", { path: { id: flagId }, signal }),
    enabled: enabled && Number.isFinite(flagId),
  });
}

/* ------------------------------------------------------------------ *
 * Papers
 * ------------------------------------------------------------------ */

export function usePaper(id: number) {
  return useQuery<TestPaper, Error>({
    queryKey: staffKeys.paper(id),
    queryFn: ({ signal }) => apiGet("/api/papers/{id}/", { path: { id }, signal }),
    enabled: Number.isFinite(id),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 1,
  });
}

export function useCreatePaper() {
  const queryClient = useQueryClient();
  return useMutation<TestPaper, Error, TestPaperCreateRequest>({
    mutationFn: (body) => apiPost("/api/papers/", { body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.papers });
    },
  });
}

/* ------------------------------------------------------------------ *
 * Uploads — check (dry run), then import
 * ------------------------------------------------------------------ */

export interface BlueprintUpload {
  file: File;
  dryRun: boolean;
}

/** A blueprint report, whichever of 200 (applies) or 422 (refused) it came with. */
export interface BlueprintOutcome {
  status: number;
  report: BlueprintReport;
}

export function useBlueprintUpload(paperId: number) {
  const queryClient = useQueryClient();
  return useMutation<BlueprintOutcome, Error, BlueprintUpload>({
    mutationFn: async ({ file, dryRun }) => {
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("dry_run", flag(dryRun));
      const sent = await send<BlueprintReport>(
        "POST",
        fill("/api/papers/{id}/blueprint/", { id: paperId }),
        { form, answers: [422] },
      );
      return { status: sent.status, report: sent.body };
    },
    onSuccess: ({ report }) => {
      if (!report.dry_run && report.ok) {
        void queryClient.invalidateQueries({ queryKey: staffKeys.paperQuestions(paperId) });
        void queryClient.invalidateQueries({ queryKey: qk.papers });
      }
    },
  });
}

export interface ResultsUpload {
  paper: number;
  file: File;
  dryRun: boolean;
  mappingProfile?: number;
  /** `{ "Their column": "roll_no" }` — sent as the JSON string the route takes. */
  columnMap?: Record<string, ColumnMappingField>;
  saveMappingAs?: string;
}

export type ResultsOutcome =
  | { kind: "report"; status: number; report: ResultsReport }
  /** 409: this exact file was imported before. Nothing was written. */
  | { kind: "duplicate"; detail: string; batchId: number | null };

export function useResultsUpload() {
  const queryClient = useQueryClient();
  return useMutation<ResultsOutcome, Error, ResultsUpload>({
    mutationFn: async (upload) => {
      const form = new FormData();
      form.append("file", upload.file, upload.file.name);
      form.append("paper", String(upload.paper));
      form.append("dry_run", flag(upload.dryRun));
      if (upload.mappingProfile !== undefined) {
        form.append("mapping_profile", String(upload.mappingProfile));
      }
      const columns = Object.entries(upload.columnMap ?? {}).filter(([name]) => name.trim());
      if (columns.length) {
        form.append("column_map", JSON.stringify(Object.fromEntries(columns)));
        if (upload.saveMappingAs?.trim()) {
          form.append("save_mapping_as", upload.saveMappingAs.trim());
        }
      }
      const sent = await send<ResultsReport | { detail?: string; batch_id?: number }>(
        "POST",
        fill("/api/ingest/results/", {}),
        { form, answers: [409, 422] },
      );
      if (sent.status === 409) {
        // The contract declares this body in prose (`{detail, batch_id}`), not
        // as a schema, so it is read defensively.
        const body = (sent.body ?? {}) as { detail?: unknown; batch_id?: unknown };
        return {
          kind: "duplicate",
          detail:
            typeof body.detail === "string"
              ? body.detail
              : "This exact file was already imported.",
          batchId: typeof body.batch_id === "number" ? body.batch_id : null,
        };
      }
      return { kind: "report", status: sent.status, report: sent.body as ResultsReport };
    },
    onSuccess: (outcome, upload) => {
      if (outcome.kind !== "report" || outcome.report.dry_run || outcome.status !== 201) return;
      void queryClient.invalidateQueries({ queryKey: staffKeys.batches });
      if (upload.saveMappingAs?.trim()) {
        void queryClient.invalidateQueries({ queryKey: staffKeys.mappings });
      }
      // New answers move every derived figure the console shows.
      void queryClient.invalidateQueries({ queryKey: ["students"] });
      void queryClient.invalidateQueries({ queryKey: ["flags"] });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

export function useIngestBatches() {
  return useQuery<IngestBatch[], Error>({
    queryKey: staffKeys.batches,
    queryFn: ({ signal }) => apiGetRows("/api/ingest/batches/", { signal }),
  });
}

export function useMappings() {
  return useQuery<ColumnMappingProfile[], Error>({
    queryKey: staffKeys.mappings,
    queryFn: ({ signal }) => apiGetRows("/api/ingest/mappings/", { signal }),
  });
}

/** The columns a results file's mapping can name, in the order a form offers them. */
export const MAPPABLE_FIELDS: { value: ColumnMappingField; label: string }[] = [
  { value: "roll_no", label: "Roll number" },
  { value: "question_id", label: "Question number" },
  { value: "answer", label: "Answer" },
  { value: "time_spent", label: "Time spent" },
  { value: "batch", label: "Batch" },
  { value: "ignore", label: "Ignore this column" },
];

/* ------------------------------------------------------------------ *
 * Questions and tagging
 * ------------------------------------------------------------------ */

export function usePaperQuestions(paperId: number) {
  return useQuery<PaperQuestions, Error>({
    queryKey: staffKeys.paperQuestions(paperId),
    queryFn: ({ signal }) =>
      apiGet("/api/papers/{id}/questions/", { path: { id: paperId }, signal }),
    enabled: Number.isFinite(paperId),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 1,
  });
}

/**
 * Why a question edit was refused, field by field — DRF's validation shape.
 * `options` is either sentences about the list as a whole, or a list ALIGNED
 * with the request's own `options`, one `{field: [sentences]}` per entry.
 */
export interface QuestionEditProblems {
  question_text?: string[];
  solution?: string[];
  /** Problems with the list as a whole. */
  options?: string[];
  /** By option label, mapped back from the aligned list. */
  byOption: Record<string, string[]>;
  /** Anything else the server said, flattened. */
  other: string[];
}

export class QuestionEditError extends Error {
  readonly problems: QuestionEditProblems;
  constructor(problems: QuestionEditProblems) {
    super("Nothing was saved.");
    this.name = "QuestionEditError";
    this.problems = problems;
  }
}

const sentences = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : typeof value === "string"
      ? [value]
      : [];

/** Read a 400 body against the request that caused it. */
export function readEditProblems(
  body: unknown,
  sentOptions: { label: string }[] = [],
): QuestionEditProblems {
  const problems: QuestionEditProblems = { byOption: {}, other: [] };
  if (!body || typeof body !== "object") {
    problems.other.push("The server refused the edit without saying why.");
    return problems;
  }
  for (const [field, value] of Object.entries(body as Record<string, unknown>)) {
    if (field === "question_text" || field === "solution") {
      problems[field] = sentences(value);
    } else if (field === "options" && Array.isArray(value)) {
      const aligned = value.some((entry) => entry && typeof entry === "object");
      if (!aligned) {
        problems.options = sentences(value);
        continue;
      }
      value.forEach((entry, index) => {
        if (!entry || typeof entry !== "object") return;
        const label = sentOptions[index]?.label ?? `#${index + 1}`;
        const found = Object.values(entry as Record<string, unknown>).flatMap(sentences);
        if (found.length) problems.byOption[label] = found;
      });
    } else if (field === "detail") {
      problems.other.push(...sentences(value));
    } else {
      problems.other.push(...sentences(value).map((s) => `${field}: ${s}`));
    }
  }
  return problems;
}

export function useUpdateQuestion(paperId: number) {
  const queryClient = useQueryClient();
  return useMutation<TaggableQuestion, Error, { questionPk: number; body: QuestionContentUpdate }>({
    mutationFn: async ({ questionPk, body }) => {
      try {
        const sent = await send<TaggableQuestion>(
          "PATCH",
          fill("/api/papers/{id}/questions/{question_pk}/", {
            id: paperId,
            question_pk: questionPk,
          }),
          { json: body },
        );
        return sent.body;
      } catch (error) {
        if (error instanceof ApiError && error.status === 400) {
          throw new QuestionEditError(readEditProblems(error.body, body.options));
        }
        throw error;
      }
    },
    onSuccess: (question) => {
      queryClient.setQueryData<PaperQuestions>(staffKeys.paperQuestions(paperId), (prev) =>
        prev
          ? {
              ...prev,
              questions: prev.questions.map((q) => (q.id === question.id ? question : q)),
            }
          : prev,
      );
      // The progress counts are the server's; ask again rather than recount.
      void queryClient.invalidateQueries({ queryKey: staffKeys.paperQuestions(paperId) });
    },
  });
}

/** The taxonomy a tag may use. `subject` narrows it to the question's own. */
export function useMisconceptions(subject: string | null, enabled = true) {
  return useQuery<Misconception[], Error>({
    queryKey: staffKeys.misconceptions(subject),
    queryFn: ({ signal }) =>
      apiGetRows("/api/misconceptions/", {
        query: subject ? { subject } : undefined,
        signal,
      }),
    enabled,
    staleTime: 10 * 60_000,
  });
}

/* ------------------------------------------------------------------ *
 * Answer-key review
 * ------------------------------------------------------------------ */

export type ReviewFilter = "unreviewed" | "reviewed";

export function useDisagreements(status: ReviewFilter) {
  return useQuery<KeyDisagreement[], Error>({
    queryKey: staffKeys.disagreements(status),
    queryFn: ({ signal }) =>
      apiGetRows("/api/review/disagreements/", { query: { status }, signal }),
  });
}

export function useReviewDecision() {
  const queryClient = useQueryClient();
  return useMutation<
    KeyDisagreement,
    Error,
    { questionPk: number; decision: KeyReviewDecision; note: string }
  >({
    mutationFn: ({ questionPk, decision, note }) =>
      apiPost("/api/review/disagreements/{question_pk}/", {
        path: { question_pk: questionPk },
        body: { decision, note },
      }),
    onSuccess: (item) => {
      void queryClient.invalidateQueries({ queryKey: ["review"] });
      void queryClient.invalidateQueries({ queryKey: staffKeys.paperQuestions(item.paper_id) });
    },
  });
}

/* ------------------------------------------------------------------ *
 * Plain words for the refusals these routes document
 * ------------------------------------------------------------------ */

/** The server's own sentence, when it sent one. */
export function detailOf(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const detail = (error.body as { detail?: unknown } | null)?.detail;
  return typeof detail === "string" ? detail : null;
}

/** 429, for any of the throttled staff routes. */
export const TOO_MANY = "Too many requests in a short time. Wait a minute, then try again.";

/** A failed upload, in one sentence for the person who sent the file. */
export function uploadErrorText(error: Error): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return TOO_MANY;
    if (error.status === 404) return "This paper is not in your institute, so nothing can be uploaded to it.";
    if (error.status === 400) {
      return detailOf(error) ?? `The file could not be read: ${error.message}`;
    }
    if (error.status === 403) return "Your account cannot upload files for this institute.";
  }
  return `The upload did not reach the server: ${error.message}`;
}
