import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { apiGet, apiPost } from "./client";
import { API_GAPS } from "./gaps";
import type {
  Batch,
  DashboardSummary,
  Flag,
  Intervention,
  InterventionRequest,
  MarksLost,
  MockScore,
  Paginated,
  PlanBlock,
  StudentDetail,
  StudentList,
  SubjectBreakdown,
  TestPaper,
  TopicState,
} from "./types";

export const qk = {
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
};

export interface StudentFilters {
  batch?: number;
  at_risk?: boolean;
  active?: boolean;
}

type ListOpts<T> = Omit<
  UseQueryOptions<Paginated<T>, Error, Paginated<T>>,
  "queryKey" | "queryFn"
>;

export function useDashboardSummary() {
  return useQuery<DashboardSummary, Error>({
    queryKey: qk.dashboard,
    queryFn: () => apiGet("/api/dashboard/summary/"),
  });
}

export function useBatches() {
  return useQuery<Paginated<Batch>, Error>({
    queryKey: qk.batches,
    queryFn: () => apiGet("/api/batches/"),
  });
}

export function usePapers() {
  return useQuery<Paginated<TestPaper>, Error>({
    queryKey: qk.papers,
    queryFn: () => apiGet("/api/papers/"),
  });
}

export function useStudents(filters: StudentFilters = {}, opts?: ListOpts<StudentList>) {
  return useQuery<Paginated<StudentList>, Error>({
    queryKey: qk.students(filters),
    queryFn: () => apiGet("/api/students/", { query: filters }),
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
  return useQuery<Paginated<MockScore>, Error, MockScore[]>({
    queryKey: qk.mockScores(id),
    queryFn: () => apiGet("/api/students/{id}/mock-scores/", { path: { id } }),
    enabled: Number.isFinite(id),
    // API_GAPS.MOCK_SCORES_ORDER — sort defensively rather than trusting order.
    select: (page) =>
      [...page.results].sort((a, b) => a.held_on.localeCompare(b.held_on)),
  });
}

export function useSubjectBreakdown(id: number) {
  return useQuery<Paginated<SubjectBreakdown>, Error, SubjectBreakdown[]>({
    queryKey: qk.subjectBreakdown(id),
    queryFn: () =>
      apiGet("/api/students/{id}/subject-breakdown/", { path: { id } }),
    enabled: Number.isFinite(id),
    select: (page) => page.results,
  });
}

export function useTopicStates(id: number) {
  return useQuery<Paginated<TopicState>, Error, TopicState[]>({
    queryKey: qk.topicStates(id),
    queryFn: () => apiGet("/api/students/{id}/topic-states/", { path: { id } }),
    enabled: Number.isFinite(id),
    select: (page) => page.results,
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
  return useQuery<Paginated<Flag>, Error, Flag[]>({
    queryKey: qk.flags(open),
    queryFn: () => apiGet("/api/flags/", { undocumentedQuery: { open } }),
    select: (page) =>
      page.results
        .filter((flag) => (open === undefined ? true : flag.is_open === open))
        .sort((a, b) => Date.parse(b.raised_at) - Date.parse(a.raised_at)),
  });
}

export function usePlan() {
  return useQuery<Paginated<PlanBlock>, Error, PlanBlock[]>({
    queryKey: qk.plan,
    queryFn: () => apiGet("/api/my/plan/"),
    select: (page) => page.results,
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
