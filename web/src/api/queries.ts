import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { ApiError, apiGet, apiGetRows, apiPost } from "./client";
import {
  NOT_ENOUGH_EVIDENCE,
  REASONING_UNAVAILABLE,
  fetchDiagnosis,
  postDiagnosisVerdict,
  type Diagnosis,
  type DiagnosisVerdictBody,
} from "./diagnosis";
import type {
  Batch,
  DashboardSummary,
  Flag,
  Intervention,
  InterventionRequest,
  MarksLost,
  MockScore,
  PlanBlock,
  StudentDetail,
  StudentList,
  SubjectBreakdown,
  TestPaper,
  TopicState,
} from "./types";

/**
 * Every list hook below returns a plain array, never a page envelope.
 *
 * That is not cosmetic. The contract promises `{count, next, previous,
 * results}` for every list route, and the live server now delivers it from all
 * of them — including the four `@action` detail routes that used to answer
 * with a bare array (see `pagination.ts`, which still accepts both). Unwrapping
 * inside `apiGetRows` rather than in each `select` means exactly one place has
 * to be right about which shape arrived, and no component holds a value whose
 * shape depends on which endpoint filled it.
 *
 * Only `/api/flags/` actually pages on the seeded data — 81 rows at
 * `PAGE_SIZE 50` — and `apiGetRows` follows `next` to the end. A triage table
 * showing 50 of 81 open flags beside a dashboard count of 81 is the worst bug
 * this console can have: wrong, and confident.
 */

export const qk = {
  me: ["me"] as const,
  dashboard: ["dashboard", "summary"] as const,
  batches: ["batches"] as const,
  papers: ["papers"] as const,
  students: (filters: StudentFilters) => ["students", filters] as const,
  student: (id: number) => ["students", id] as const,
  mockScores: (id: number) => ["students", id, "mock-scores"] as const,
  subjectBreakdown: (id: number) => ["students", id, "subject-breakdown"] as const,
  topicStates: (id: number) => ["students", id, "topic-states"] as const,
  marksLost: (id: number, paper: number) =>
    ["students", id, "marks-lost", paper] as const,
  flags: (filters: FlagFilters) => ["flags", filters] as const,
  plan: ["my", "plan"] as const,
  diagnosis: (id: number, paper?: number) =>
    ["students", id, "diagnosis", paper ?? null] as const,
};

export interface StudentFilters {
  batch?: number;
  at_risk?: boolean;
  active?: boolean;
}

export interface FlagFilters {
  /**
   * `true` narrows to unresolved flags. **A presence filter, not a boolean
   * field** — the contract says any other value, `false` included, is ignored
   * and returns everything. So `open: false` means "I want the closed ones",
   * the request goes out unfiltered, and the `select` below does the narrowing.
   */
  open?: boolean;
  student?: number;
}

type ListOpts<T> = Omit<UseQueryOptions<T[], Error, T[]>, "queryKey" | "queryFn">;

export function useDashboardSummary() {
  return useQuery<DashboardSummary, Error>({
    queryKey: qk.dashboard,
    queryFn: () => apiGet("/api/dashboard/summary/"),
  });
}

export function useBatches() {
  return useQuery<Batch[], Error>({
    queryKey: qk.batches,
    queryFn: () => apiGetRows("/api/batches/"),
  });
}

export function usePapers() {
  return useQuery<TestPaper[], Error>({
    queryKey: qk.papers,
    queryFn: () => apiGetRows("/api/papers/"),
  });
}

export function useStudents(
  filters: StudentFilters = {},
  opts?: ListOpts<StudentList>,
) {
  return useQuery<StudentList[], Error>({
    queryKey: qk.students(filters),
    queryFn: () => apiGetRows("/api/students/", { query: filters }),
    ...opts,
  });
}

export function useStudent(id: number) {
  return useQuery<StudentDetail, Error>({
    queryKey: qk.student(id),
    queryFn: () => apiGet("/api/students/{id}/", { path: { id } }),
    enabled: Number.isFinite(id),
  });
}

export function useMockScores(id: number) {
  return useQuery<MockScore[], Error>({
    queryKey: qk.mockScores(id),
    queryFn: () => apiGetRows("/api/students/{id}/mock-scores/", { path: { id } }),
    enabled: Number.isFinite(id),
    // API_GAPS.MOCK_SCORES_ORDER — the view does sort by `held_on`, but the
    // contract does not promise it, so the chart sorts rather than trusts.
    select: (rows) => [...rows].sort((a, b) => a.held_on.localeCompare(b.held_on)),
  });
}

export function useSubjectBreakdown(id: number) {
  return useQuery<SubjectBreakdown[], Error>({
    queryKey: qk.subjectBreakdown(id),
    queryFn: () =>
      apiGetRows("/api/students/{id}/subject-breakdown/", { path: { id } }),
    enabled: Number.isFinite(id),
  });
}

export function useTopicStates(id: number) {
  return useQuery<TopicState[], Error>({
    queryKey: qk.topicStates(id),
    queryFn: () => apiGetRows("/api/students/{id}/topic-states/", { path: { id } }),
    enabled: Number.isFinite(id),
  });
}

/**
 * The mistake taxonomy for one paper, straight off the wire.
 *
 * There used to be a `coerceMarksLost` between the response and this hook,
 * widening a generated row that predated the fifth bucket. The contract carries
 * `insufficient_evidence`, `attributed_lost` and `recoverable_pct` now, so the
 * coercion is deleted. `recoverable_pct` is still never recomputed here: the
 * server divides by `attributed_lost`, and a client that divides by
 * `total_lost` is wrong in a way nobody notices.
 */
export function useMarksLost(id: number, paper: number) {
  return useQuery<MarksLost, Error>({
    queryKey: qk.marksLost(id, paper),
    queryFn: () =>
      apiGet("/api/students/{id}/marks-lost/", {
        path: { id },
        query: { paper },
      }),
    enabled: Number.isFinite(id) && Number.isFinite(paper),
  });
}

/**
 * Flags, narrowed at the server where the contract lets us.
 *
 * `?open=` and `?student=` are declared now, so Student 360 asks for one
 * student's flags instead of pulling all 81 in the institute and filtering in
 * the browser. The client-side `filter` stays anyway, for one specific reason:
 * `?open=` is documented as a **presence** filter, so `open=false` is ignored
 * by the server and returns everything. The closed-loop panel depends on that
 * narrowing happening somewhere, and here is the only place it can.
 */
export function useFlags(filters: FlagFilters = {}) {
  const { open, student } = filters;
  return useQuery<Flag[], Error>({
    queryKey: qk.flags(filters),
    queryFn: () =>
      apiGetRows("/api/flags/", {
        query: { open: open === true ? true : undefined, student },
      }),
    select: (rows) =>
      rows
        .filter((flag) => (open === undefined ? true : flag.is_open === open))
        .filter((flag) => (student === undefined ? true : flag.student_id === student))
        .sort((a, b) => Date.parse(b.raised_at) - Date.parse(a.raised_at)),
  });
}

export function usePlan() {
  return useQuery<PlanBlock[], Error>({
    queryKey: qk.plan,
    queryFn: () => apiGetRows("/api/my/plan/"),
  });
}

/* ------------------------------------------------------------------ *
 * The reasoning layer
 *
 * Both routes are typed from the contract now. The hooks are ordinary; the
 * only thing worth arguing about is the retry policy below.
 * ------------------------------------------------------------------ */

/**
 * The diagnosis for one student on one paper.
 *
 * `retry: false`, unlike every other query here. The two failures this endpoint
 * has — 503 (no reasoning key configured) and 422 (not enough tagged evidence)
 * — are both *states the card renders on purpose*, and neither changes on a
 * second attempt. Retrying would buy nothing and delay the honest answer by a
 * round trip, in front of a buyer.
 */
export function useDiagnosis(id: number, paper: number | undefined) {
  return useQuery<Diagnosis, Error>({
    queryKey: qk.diagnosis(id, paper),
    queryFn: ({ signal }) => fetchDiagnosis(id, paper, signal),
    enabled: Number.isFinite(id) && paper !== undefined,
    retry: false,
    // A reasoning call is expensive and the answer does not move within a
    // sitting; the server's own `from_cache` flag says as much.
    staleTime: 5 * 60_000,
  });
}

/** 503: the reasoning layer is not wired up, as opposed to not having answered. */
export function isReasoningUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status === REASONING_UNAVAILABLE;
}

/** 422: it is wired up, and honestly has too little tagged evidence to reason. */
export function isNotEnoughEvidence(error: unknown): boolean {
  return error instanceof ApiError && error.status === NOT_ENOUGH_EVIDENCE;
}

/**
 * Agree / disagree on a diagnosis.
 *
 * The contract says the 200 is the whole `Diagnosis` with `human_verdict` set,
 * and the live server does exactly that — so the cache takes the response, and
 * the card shows what the server recorded rather than what the browser asked
 * for. The request body is the fallback for a server that answers 204 or with
 * a body the parser cannot make a headline out of: the one thing the UI must
 * be right about is that this teacher has now answered, and that much is known
 * before the request goes out.
 */
export function useDiagnosisVerdict(id: number, paper: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation<Diagnosis, Error, DiagnosisVerdictBody>({
    mutationFn: (body) => postDiagnosisVerdict(id, body),
    onSuccess: (result, body) => {
      queryClient.setQueryData<Diagnosis>(qk.diagnosis(id, paper), (prev) => {
        if (result?.headline) return result;
        return prev ? { ...prev, human_verdict: body.verdict } : prev;
      });
    },
  });
}

export function useIntervene() {
  const queryClient = useQueryClient();
  return useMutation<
    Intervention,
    Error,
    { flagId: number; body: InterventionRequest }
  >({
    mutationFn: ({ flagId, body }) =>
      apiPost("/api/flags/{id}/intervene/", { path: { id: flagId }, body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["flags"] });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}
