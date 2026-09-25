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
import { API_GAPS } from "./gaps";
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
 * results}` for all ten list routes; the server actually returns a bare array
 * from the four `@action` routes (see `pagination.ts`). Unwrapping inside
 * `apiGetRows` rather than in each `select` means exactly one place has to be
 * right about which shape arrived, and no component holds a value whose shape
 * depends on which endpoint filled it.
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
  flags: (open?: boolean) => ["flags", { open }] as const,
  plan: ["my", "plan"] as const,
  diagnosis: (id: number, paper?: number) =>
    ["students", id, "diagnosis", paper ?? null] as const,
};

export interface StudentFilters {
  batch?: number;
  at_risk?: boolean;
  active?: boolean;
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
 * `open` is not in the contract ({@link API_GAPS.FLAGS_OPEN_FILTER}), so it goes
 * through the undocumented-query escape hatch AND is re-applied client-side —
 * the view stays correct against a server that ignores the param.
 */
export function useFlags(open?: boolean) {
  return useQuery<Flag[], Error>({
    queryKey: qk.flags(open),
    queryFn: () => apiGetRows("/api/flags/", { undocumentedQuery: { open } }),
    select: (rows) =>
      rows
        .filter((flag) => (open === undefined ? true : flag.is_open === open))
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
 * Both routes are ahead of the contract — see API_GAPS.DIAGNOSIS_*. The hooks
 * are otherwise ordinary; the only thing worth arguing about is the retry
 * policy below.
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
 * The cached diagnosis is patched from the *request* body rather than the
 * response, because nothing in the contract says what the response carries.
 * The one thing the UI must be right about — that this teacher has now
 * answered — is known before the request goes out.
 */
export function useDiagnosisVerdict(id: number, paper: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, DiagnosisVerdictBody>({
    mutationFn: (body) => postDiagnosisVerdict(id, body),
    onSuccess: (_result, body) => {
      queryClient.setQueryData<Diagnosis>(qk.diagnosis(id, paper), (prev) =>
        prev ? { ...prev, human_verdict: body.verdict } : prev,
      );
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
