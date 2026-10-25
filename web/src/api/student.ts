/**
 * The student app's data: one hook per `/api/my/…` route.
 *
 * Every route here is addressed by the session, never by an id — the server
 * reads the student from `request.user`, so there is no way to ask for anyone
 * else's data and no id to pass. Keys live under `["student", …]`, apart from
 * the console's, so nothing a student does can be served from (or invalidate)
 * a cache entry the console filled.
 *
 * Writes say what they change: ticking a block moves the next actions, marking
 * a revision done moves the revision count on the profile, and so on. Each
 * mutation invalidates exactly those keys rather than everything, so a screen
 * that did not change does not flash.
 */
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE, ApiError, apiGet, apiGetRows, apiPost, ensureCsrfToken } from "./client";
import type { paths } from "./schema";
import type {
  AskAnswer,
  ConfidenceRating,
  Guidance,
  MarksLost,
  MockScore,
  MyAttempt,
  MyProfile,
  MyQuestion,
  MyRevision,
  MyTopic,
  Onboarding,
  OnboardingUpdateRequest,
  PlanBlock,
  PlanExplain,
  PlanGeneration,
  StudyLogCreate,
  StudyLogCreateRequest,
  SubjectBreakdown,
  TopicState,
} from "./types";

export const sk = {
  all: ["student"] as const,
  profile: ["student", "profile"] as const,
  onboarding: ["student", "onboarding"] as const,
  topics: ["student", "topics"] as const,
  topicStates: (forgetting: boolean) => ["student", "topic-states", { forgetting }] as const,
  topicStatesAll: ["student", "topic-states"] as const,
  mockScores: ["student", "mock-scores"] as const,
  subjectBreakdown: ["student", "subject-breakdown"] as const,
  marksLost: (paper: number) => ["student", "marks-lost", paper] as const,
  plan: ["student", "plan", "today"] as const,
  /** The plan's gentle sentence. Only `generate` returns it, so it is kept here. */
  planNote: ["student", "plan-note", "today"] as const,
  revisions: ["student", "revisions"] as const,
  studyLogs: ["student", "study-logs"] as const,
  wrongAnswers: (paper: number | null) => ["student", "attempts", "wrong", paper] as const,
  question: (pk: number) => ["student", "question", pk] as const,
  guidance: ["student", "guidance"] as const,
};

/* ------------------------------------------------------------------ *
 * Errors, read the way the server writes them
 * ------------------------------------------------------------------ */

export function statusOf(error: unknown): number | null {
  return error instanceof ApiError ? error.status : null;
}

/**
 * DRF's field errors — `{"minutes": ["Ensure this value is …"]}` — keyed by
 * field, in the server's own words. Empty for any other failure.
 */
export function fieldErrors(error: unknown): Record<string, string[]> {
  if (!(error instanceof ApiError) || error.status !== 400) return {};
  const body = error.body;
  if (!body || typeof body !== "object") return {};
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    const messages = (Array.isArray(value) ? value : [value]).filter(
      (m): m is string => typeof m === "string",
    );
    if (messages.length && key !== "code") out[key] = messages;
  }
  return out;
}

/** The server's `detail` sentence, when it sent one. */
export function detailOf(error: unknown): string | null {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== "object") return null;
  const detail = (error.body as { detail?: unknown }).detail;
  return typeof detail === "string" && detail.trim() ? detail : null;
}

/* ------------------------------------------------------------------ *
 * PUT — the one write that is not a POST
 *
 * `client.ts` types GET and POST from the contract and has no PUT, and
 * onboarding is the only PUT a student makes. Typed from `paths` all the same,
 * so a contract change to this route still fails the build here.
 * ------------------------------------------------------------------ */

type OnboardingPut = paths["/api/my/onboarding/"]["put"];
type OnboardingPutBody = OnboardingPut["requestBody"]["content"]["application/json"];
type OnboardingPutResult = OnboardingPut["responses"][200]["content"]["application/json"];

async function putOnboarding(body: OnboardingPutBody): Promise<OnboardingPutResult> {
  const url = `${API_BASE}/api/my/onboarding/`;
  const token = await ensureCsrfToken();
  const response = await fetch(url, {
    method: "PUT",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { "X-CSRFToken": token } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, url, payload);
  return payload as OnboardingPutResult;
}

/* ------------------------------------------------------------------ *
 * Who I am, and what I told the planner
 * ------------------------------------------------------------------ */

export function useMyProfile() {
  return useQuery<MyProfile, Error>({
    queryKey: sk.profile,
    queryFn: () => apiGet("/api/my/profile/"),
    staleTime: 60_000,
  });
}

export function useMyOnboarding() {
  return useQuery<Onboarding, Error>({
    queryKey: sk.onboarding,
    queryFn: () => apiGet("/api/my/onboarding/"),
  });
}

export function useSaveOnboarding() {
  const queryClient = useQueryClient();
  return useMutation<Onboarding, Error, OnboardingUpdateRequest>({
    mutationFn: (body) => putOnboarding(body),
    onSuccess: async (saved) => {
      queryClient.setQueryData(sk.onboarding, saved);
      // `needs_onboarding` lives on the profile too, and the gate reads it
      // there — wait for it, so the gate opens on the answer, not a guess.
      await queryClient.invalidateQueries({ queryKey: sk.profile });
    },
  });
}

/* ------------------------------------------------------------------ *
 * My syllabus and how I stand in it
 * ------------------------------------------------------------------ */

export function useMyTopics() {
  return useQuery<MyTopic[], Error>({
    queryKey: sk.topics,
    queryFn: () => apiGetRows("/api/my/topics/"),
    // The syllabus does not move within a sitting.
    staleTime: 10 * 60_000,
  });
}

/** Per-chapter mastery; `forgetting` narrows to recall below 50%, fastest-fading first. */
export function useMyTopicStates({ forgetting = false }: { forgetting?: boolean } = {}) {
  return useQuery<TopicState[], Error>({
    queryKey: sk.topicStates(forgetting),
    queryFn: () =>
      apiGetRows("/api/my/topic-states/", {
        query: forgetting ? { forgetting: true } : undefined,
      }),
  });
}

export function useMyMockScores() {
  return useQuery<MockScore[], Error>({
    queryKey: sk.mockScores,
    queryFn: () => apiGetRows("/api/my/mock-scores/"),
    // Documented oldest first; a trend is its order, so it is sorted, not trusted.
    select: (rows) => [...rows].sort((a, b) => a.held_on.localeCompare(b.held_on)),
  });
}

export function useMySubjectBreakdown() {
  return useQuery<SubjectBreakdown[], Error>({
    queryKey: sk.subjectBreakdown,
    queryFn: () => apiGetRows("/api/my/subject-breakdown/"),
  });
}

function fetchMarksLost(paper: number, signal?: AbortSignal) {
  return apiGet("/api/my/marks-lost/", { query: { paper }, signal });
}

export function useMyMarksLost(paper: number | undefined) {
  return useQuery<MarksLost, Error>({
    queryKey: sk.marksLost(paper ?? NaN),
    queryFn: ({ signal }) => fetchMarksLost(paper as number, signal),
    enabled: paper !== undefined && Number.isFinite(paper),
    // A 404 (a paper I did not sit) will not change on a second try.
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/**
 * Each paper's maximum, read from its marks-lost row.
 *
 * `MockScore` carries no `max_marks`, and a 184-mark diagnostic beside
 * 300-mark mocks plotted as raw totals reads as a score that held steady when
 * it was really a far better day. So the trend asks each paper for its
 * maximum — the same request, and the same cache entry, "where my marks went"
 * makes for that paper.
 */
export function useMyPaperMaxima(paperIds: number[]): Map<number, number> {
  const results = useQueries({
    queries: paperIds.map((paper) => ({
      queryKey: sk.marksLost(paper),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchMarksLost(paper, signal),
      retry: false,
      staleTime: 5 * 60_000,
    })),
  });
  const maxima = new Map<number, number>();
  results.forEach((result, i) => {
    if (result.data) maxima.set(paperIds[i], result.data.max_marks);
  });
  return maxima;
}

/* ------------------------------------------------------------------ *
 * Today's plan
 * ------------------------------------------------------------------ */

export function useMyPlan() {
  return useQuery<PlanBlock[], Error>({
    queryKey: sk.plan,
    queryFn: () => apiGetRows("/api/my/plan/"),
  });
}

/**
 * The gentle sentence on a deliberately lighter day. `GET my/plan` does not
 * carry it — only `generate` does — so it is held in the cache from that
 * answer for the rest of the session. Never fetched.
 */
export function usePlanNote(): string | null {
  const query = useQuery<string | null>({
    queryKey: sk.planNote,
    queryFn: () => null,
    enabled: false,
  });
  return query.data ?? null;
}

export function useGeneratePlan() {
  const queryClient = useQueryClient();
  return useMutation<PlanGeneration, Error, void>({
    mutationFn: () => apiPost("/api/my/plan/generate/", { body: { replace: false } }),
    onSuccess: (result) => {
      queryClient.setQueryData(sk.plan, result.blocks);
      queryClient.setQueryData(sk.planNote, result.note);
      void queryClient.invalidateQueries({ queryKey: sk.guidance });
    },
  });
}

/** Every tick and untick, so the last one can be told apart from the others. */
const TICK_KEY = ["student", "plan", "tick"] as const;

/**
 * Tick a block, or untick it. Shown at once (a tick that waits on the network
 * feels broken on a phone) and put back if the server refuses.
 *
 * A quick tick-then-untick is two requests. Sent side by side they can be
 * answered in either order, and the older answer would then repaint a tick
 * the student already took back — or the server could apply them in the
 * wrong order. So ticks share one `scope`: the screen still changes on every
 * tap (`onMutate` runs straight away), but the requests go one at a time, in
 * tap order. Only the last answer is painted, and after it the plan is read
 * back from the server, so the bubbles always end on what is saved.
 */
export function useTickBlock() {
  const queryClient = useQueryClient();
  const isLastTick = () => queryClient.isMutating({ mutationKey: TICK_KEY }) === 1;
  return useMutation<
    PlanBlock,
    Error,
    { id: number; done: boolean },
    { previous: PlanBlock[] | undefined }
  >({
    mutationKey: TICK_KEY,
    scope: { id: "student-plan-ticks" },
    mutationFn: ({ id, done }) =>
      done
        ? apiPost("/api/my/plan/{id}/complete/", { path: { id } })
        : apiPost("/api/my/plan/{id}/uncomplete/", { path: { id } }),
    onMutate: async ({ id, done }) => {
      await queryClient.cancelQueries({ queryKey: sk.plan });
      const previous = queryClient.getQueryData<PlanBlock[]>(sk.plan);
      queryClient.setQueryData<PlanBlock[]>(sk.plan, (blocks) =>
        blocks?.map((b) => (b.id === id ? { ...b, completed: done } : b)),
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(sk.plan, context.previous);
    },
    onSuccess: (block) => {
      // A later tap is still on its way: its answer, not this one, is the truth.
      if (!isLastTick()) return;
      queryClient.setQueryData<PlanBlock[]>(sk.plan, (blocks) =>
        blocks?.map((b) => (b.id === block.id ? block : b)),
      );
    },
    onSettled: () => {
      if (isLastTick()) void queryClient.invalidateQueries({ queryKey: sk.plan });
      void queryClient.invalidateQueries({ queryKey: sk.guidance });
    },
  });
}

/** Why today's plan is what it is. Always a 200; `available` says whose words. */
export function useExplainPlan() {
  return useMutation<PlanExplain, Error, void>({
    mutationFn: () => apiPost("/api/my/plan/explain/", { body: {} }),
  });
}

/* ------------------------------------------------------------------ *
 * Revisions
 * ------------------------------------------------------------------ */

export function useMyRevisions() {
  return useQuery<MyRevision[], Error>({
    queryKey: sk.revisions,
    queryFn: () => apiGetRows("/api/my/revisions/", { query: { pending: true } }),
  });
}

export function useCompleteRevision() {
  const queryClient = useQueryClient();
  return useMutation<MyRevision, Error, number>({
    mutationFn: (id) => apiPost("/api/my/revisions/{id}/complete/", { path: { id } }),
    onSuccess: async () => {
      // The server schedules the next cycle in the same request; wait for the
      // list, so the screen can say when it is.
      await queryClient.invalidateQueries({ queryKey: sk.revisions });
      for (const key of [sk.profile, sk.topicStatesAll, sk.guidance]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

/* ------------------------------------------------------------------ *
 * Study log and confidence — the student's two append-only writes
 * ------------------------------------------------------------------ */

/** The most recent sessions, newest first — one page, not the whole history. */
export function useMyStudyLogs(limit = 20) {
  return useQuery<StudyLogCreate[], Error>({
    queryKey: [...sk.studyLogs, limit],
    queryFn: async () => {
      const page = await apiGet("/api/my/study-logs/", { query: { page_size: limit } });
      return page.results;
    },
  });
}

export function useLogStudy() {
  const queryClient = useQueryClient();
  return useMutation<StudyLogCreate, Error, StudyLogCreateRequest>({
    mutationFn: (body) => apiPost("/api/my/study-logs/", { body }),
    onSuccess: () => {
      // A first session on a chapter schedules its first revision.
      for (const key of [sk.studyLogs, sk.revisions, sk.topicStatesAll, sk.guidance]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useRateConfidence() {
  const queryClient = useQueryClient();
  return useMutation<ConfidenceRating, Error, { topic: number; self_rating: number }>({
    mutationFn: (body) => apiPost("/api/my/confidence/", { body }),
    onSuccess: (saved) => {
      // The latest rating is `TopicState.self_rating`. Written straight into
      // the cached rows, so the list does not reshuffle under a finger that is
      // still rating the next chapter.
      for (const forgetting of [false, true]) {
        queryClient.setQueryData<TopicState[]>(sk.topicStates(forgetting), (rows) =>
          rows?.map((row) =>
            row.topic.id === saved.topic ? { ...row, self_rating: saved.self_rating } : row,
          ),
        );
      }
      void queryClient.invalidateQueries({ queryKey: sk.guidance });
    },
  });
}

/* ------------------------------------------------------------------ *
 * Mistakes
 * ------------------------------------------------------------------ */

export function useMyWrongAnswers(paper: number | null) {
  return useQuery<MyAttempt[], Error>({
    queryKey: sk.wrongAnswers(paper),
    queryFn: () =>
      apiGetRows("/api/my/attempts/", {
        query: { status: "wrong", ...(paper === null ? {} : { paper }) },
      }),
  });
}

export function useMyQuestion(pk: number) {
  return useQuery<MyQuestion, Error>({
    queryKey: sk.question(pk),
    queryFn: ({ signal }) => apiGet("/api/my/questions/{id}/", { path: { id: pk }, signal }),
    enabled: Number.isInteger(pk) && pk > 0,
    // A 404 — a question I never answered — does not change on a retry.
    retry: false,
    staleTime: 10 * 60_000,
  });
}

/* ------------------------------------------------------------------ *
 * The guide
 * ------------------------------------------------------------------ */

export function useMyGuidance() {
  return useQuery<Guidance, Error>({
    queryKey: sk.guidance,
    queryFn: () => apiGet("/api/my/guidance/"),
  });
}

export function useAskGuide() {
  return useMutation<AskAnswer, Error, string>({
    mutationFn: (question) => apiPost("/api/my/guidance/ask/", { body: { question } }),
    // A 429 or 503 is an answer the screen words for the student; retrying
    // either would spend a question or wait on a guide that said it is away.
    retry: false,
  });
}

/* ------------------------------------------------------------------ *
 * NCERT links
 *
 * `MyTopic.ncert_ref` is typed `unknown` in the contract and described in
 * prose: a list of `{class, subject, book, chapter, title, pdf, sections?}`,
 * or null. Parsed here, defensively, so a malformed entry is dropped rather
 * than rendered — and only an `https:` link is ever made clickable.
 * ------------------------------------------------------------------ */

export interface NcertLink {
  /** "Class 11 Physics, chapter 3". */
  label: string;
  title: string;
  href: string;
  sections: string[];
}

export function ncertLinks(ref: unknown): NcertLink[] {
  if (!Array.isArray(ref)) return [];
  return ref.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const r = item as Record<string, unknown>;
    if (typeof r.pdf !== "string" || typeof r.title !== "string") return [];
    let href: URL;
    try {
      href = new URL(r.pdf);
    } catch {
      return [];
    }
    if (href.protocol !== "https:") return [];
    const cls = typeof r.class === "number" ? `Class ${r.class}` : "";
    const subject = typeof r.subject === "string" ? r.subject : "";
    const chapter = typeof r.chapter === "number" ? `chapter ${r.chapter}` : "";
    const head = [cls, subject].filter(Boolean).join(" ");
    return [
      {
        label: [head, chapter].filter(Boolean).join(", "),
        title: r.title,
        href: href.toString(),
        sections: Array.isArray(r.sections)
          ? r.sections.filter((s): s is string => typeof s === "string")
          : [],
      },
    ];
  });
}
