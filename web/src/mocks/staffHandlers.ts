import { HttpResponse, delay, http } from "msw";
import type { Me, Paginated, QuestionContentUpdate, TestPaperCreateRequest } from "@/api/types";
import { RISK_BANDS } from "@/lib/severity";
import { topicStatesFor } from "./fixtures/analytics";
import { seeds, studentDetail, studentListRow } from "./fixtures/students";
import { credentialFor, loginStatusOf, resetAccounts } from "./fixtures/staff/accounts";
import {
  confidenceFor,
  fadingFor,
  interventionsFor,
  planFor,
  revisionsFor,
  studyLogsFor,
} from "./fixtures/staff/activity";
import {
  allPapers,
  applyEdit,
  createPaper,
  misconceptionsFor,
  paperFor,
  paperQuestions,
  resetPapers,
} from "./fixtures/staff/papers";
import { decide, disagreements, resetReview } from "./fixtures/staff/review";
import {
  importBlueprint,
  importResults,
  listBatches,
  listMappings,
  resetUploads,
  saveMapping,
} from "./fixtures/staff/uploads";

/**
 * The console's staff routes, for mock mode: logins, a student's own activity,
 * papers and their uploads, tagging, and the answer-key review queue.
 *
 * Spread in FRONT of the base handlers, because two base routes are answered
 * here instead: the roster and a student's detail now carry `login_status`
 * (and the detail its onboarding answers), which has to follow what the
 * "Issue login" button just did. Both delegate to the same fixtures the base
 * handlers use, so nothing else about a student changes.
 *
 * The session lives in `handlers.ts` and is not exported, so these handlers
 * ask `/api/me/` who is calling, the way a view reads `request.user`. That is
 * what lets a mentor be refused a colleague's student (403) while a director
 * is not, and keeps the password-change gate binding here too.
 */

const PAGE_SIZE = 50;

function paginate<T>(rows: T[], url: URL): Paginated<T> {
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const start = (page - 1) * PAGE_SIZE;
  const at = (n: number) => {
    const next = new URL(url);
    next.searchParams.set("page", String(n));
    return next.toString();
  };
  return {
    count: rows.length,
    next: start + PAGE_SIZE < rows.length ? at(page + 1) : null,
    previous: page > 1 ? at(page - 1) : null,
    results: rows.slice(start, start + PAGE_SIZE),
  };
}

const envelope = <T,>(rows: T[]): Paginated<T> => ({
  count: rows.length,
  next: null,
  previous: null,
  results: rows,
});

async function settle() {
  await delay(120 + Math.random() * 180);
}

const num = (value: string | readonly string[] | undefined) =>
  Number(Array.isArray(value) ? value[0] : value);

const bool = (value: string | null) =>
  value === null ? undefined : value === "true" || value === "1" || value === "True";

/** Who is calling, from the mock session — `null` when nobody is signed in. */
async function callerOf(request: Request): Promise<Me | null> {
  const response = await fetch(new URL("/api/me/", request.url));
  return response.ok ? ((await response.json()) as Me) : null;
}

/**
 * The console's permission, as the server applies it: signed in, past the
 * password-change gate, and staff. A student gets 403 from every staff route.
 */
async function staff(request: Request): Promise<{ me: Me } | { refusal: Response }> {
  const me = await callerOf(request);
  if (!me) {
    return {
      refusal: HttpResponse.json(
        { detail: "Authentication credentials were not provided." },
        { status: 403 },
      ),
    };
  }
  if (me.must_change_password) {
    return {
      refusal: HttpResponse.json(
        { detail: "Choose a new password before you continue.", code: "password_change_required" },
        { status: 403 },
      ),
    };
  }
  if (me.role !== "mentor" && me.role !== "director") {
    return {
      refusal: HttpResponse.json(
        { detail: "You do not have permission to perform this action." },
        { status: 403 },
      ),
    };
  }
  return { me };
}

const CSRF_MISSING = () =>
  HttpResponse.json({ detail: "CSRF Failed: CSRF token missing." }, { status: 403 });

/**
 * What a student said at onboarding. Only the two who have signed in and
 * chosen their own password have answered — onboarding is their first screen.
 */
const ONBOARDING: Record<number, { daily_minutes: number; target_rank: number | null; days: number }> = {
  7: { daily_minutes: 300, target_rank: 2500, days: 9 },
  11: { daily_minutes: 360, target_rank: null, days: 4 },
};

/** Between tests, back to the seeded state. */
export function resetStaffMocks() {
  resetAccounts();
  resetPapers();
  resetUploads();
  resetReview();
}

export const staffHandlers = [
  /* ------------------------------------------------- the roster, with logins */

  http.get("/api/students/", async ({ request }) => {
    await settle();
    const gate = await staff(request);
    if ("refusal" in gate) return gate.refusal;
    const url = new URL(request.url);
    const batch = url.searchParams.get("batch");
    const atRisk = bool(url.searchParams.get("at_risk"));
    const active = bool(url.searchParams.get("active"));
    const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();

    const rows = seeds
      .filter((s) => (batch ? s.batchId === Number(batch) : true))
      .filter((s) => (atRisk === undefined ? true : s.risk_score >= RISK_BANDS.high === atRisk))
      .filter((s) => (active === undefined ? true : !s.exited_at === active))
      .filter((s) =>
        search ? s.name.toLowerCase().includes(search) || s.roll_no.toLowerCase().includes(search) : true,
      )
      .map((s) => ({ ...studentListRow(s), login_status: loginStatusOf(s.id) }))
      .sort((a, b) => b.risk_score - a.risk_score);
    return HttpResponse.json(paginate(rows, url));
  }),

  http.get("/api/students/:id/", async ({ params, request }) => {
    await settle();
    const gate = await staff(request);
    if ("refusal" in gate) return gate.refusal;
    const id = num(params.id);
    const detail = studentDetail(id);
    if (!detail) return HttpResponse.json({ detail: "Not found." }, { status: 404 });
    const onboarding = ONBOARDING[id];
    return HttpResponse.json({
      ...detail,
      login_status: loginStatusOf(id),
      daily_minutes: onboarding?.daily_minutes ?? null,
      target_rank: onboarding?.target_rank ?? null,
      onboarded_at: onboarding
        ? new Date(Date.now() - onboarding.days * 86_400_000).toISOString()
        : null,
    });
  }),

  /* ------------------------------------------------------------- logins */

  ...(["issue", "reset"] as const).map((action) =>
    http.post(
      action === "issue"
        ? "/api/students/:id/account/"
        : "/api/students/:id/account/reset-password/",
      async ({ params, request }) => {
        await settle();
        if (!request.headers.get("X-CSRFToken")) return CSRF_MISSING();
        const gate = await staff(request);
        if ("refusal" in gate) return gate.refusal;
        const result = credentialFor(action, num(params.id), gate.me);
        if ("status" in result) {
          return HttpResponse.json({ detail: result.detail }, { status: result.status });
        }
        // Shown once: the live route sends this, and so does the mock.
        return HttpResponse.json(result, {
          status: action === "issue" ? 201 : 200,
          headers: { "Cache-Control": "no-store" },
        });
      },
    ),
  ),

  /* -------------------------------------- a student's activity, for a mentor */

  http.get("/api/students/:id/plan/", async ({ params, request }) => {
    await settle();
    const gate = await staff(request);
    if ("refusal" in gate) return gate.refusal;
    const date = new URL(request.url).searchParams.get("date");
    if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return HttpResponse.json({ date: ["Use YYYY-MM-DD."] }, { status: 400 });
    }
    return HttpResponse.json(envelope(planFor(num(params.id), date)));
  }),

  http.get("/api/students/:id/study-logs/", async ({ params }) => {
    await settle();
    return HttpResponse.json(envelope(studyLogsFor(num(params.id))));
  }),

  http.get("/api/students/:id/confidence/", async ({ params }) => {
    await settle();
    return HttpResponse.json(envelope(confidenceFor(num(params.id))));
  }),

  // `?pending=true` is the route's only filter, and every fixture revision is
  // pending, so the answer is the same with or without it.
  http.get("/api/students/:id/revisions/", async ({ params }) => {
    await settle();
    return HttpResponse.json(envelope(revisionsFor(num(params.id))));
  }),

  http.get("/api/students/:id/topic-states/", async ({ params, request }) => {
    await settle();
    const forgetting = new URL(request.url).searchParams.get("forgetting") === "true";
    const id = num(params.id);
    return HttpResponse.json(envelope(forgetting ? fadingFor(id) : topicStatesFor(id)));
  }),

  http.get("/api/flags/:id/interventions/", async ({ params, request }) => {
    await settle();
    return HttpResponse.json(paginate(interventionsFor(num(params.id)), new URL(request.url)));
  }),

  /* --------------------------------------------------------------- papers */

  http.get("/api/papers/", async ({ request }) => {
    await settle();
    return HttpResponse.json(paginate(allPapers(), new URL(request.url)));
  }),

  http.post("/api/papers/", async ({ request }) => {
    await settle();
    if (!request.headers.get("X-CSRFToken")) return CSRF_MISSING();
    const body = (await request.json()) as Partial<TestPaperCreateRequest>;
    const result = createPaper(body);
    return result.ok
      ? HttpResponse.json(result.paper, { status: 201 })
      : HttpResponse.json(result.errors, { status: 400 });
  }),

  http.get("/api/papers/:id/", async ({ params }) => {
    await settle();
    const paper = paperFor(num(params.id));
    return paper
      ? HttpResponse.json(paper)
      : HttpResponse.json({ detail: "No TestPaper matches the given query." }, { status: 404 });
  }),

  http.post("/api/papers/:id/blueprint/", async ({ params, request }) => {
    await settle();
    if (!request.headers.get("X-CSRFToken")) return CSRF_MISSING();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return HttpResponse.json({ file: ["No file was submitted."] }, { status: 400 });
    }
    const answer = await importBlueprint(num(params.id), file, form.get("dry_run") === "true");
    return HttpResponse.json(answer.body, { status: answer.status });
  }),

  http.get("/api/papers/:id/questions/", async ({ params }) => {
    await settle();
    const body = paperQuestions(num(params.id));
    return body
      ? HttpResponse.json(body)
      : HttpResponse.json({ detail: "No such paper." }, { status: 404 });
  }),

  http.patch("/api/papers/:id/questions/:question_pk/", async ({ params, request }) => {
    await settle();
    if (!request.headers.get("X-CSRFToken")) return CSRF_MISSING();
    const body = (await request.json()) as QuestionContentUpdate;
    const outcome = applyEdit(num(params.id), num(params.question_pk), body);
    return outcome.status === 200
      ? HttpResponse.json(outcome.question)
      : HttpResponse.json(outcome.body, { status: outcome.status });
  }),

  http.get("/api/misconceptions/", async ({ request }) => {
    await settle();
    const url = new URL(request.url);
    return HttpResponse.json(paginate(misconceptionsFor(url.searchParams.get("subject")), url));
  }),

  /* -------------------------------------------------------------- results */

  http.post("/api/ingest/results/", async ({ request }) => {
    await settle();
    if (!request.headers.get("X-CSRFToken")) return CSRF_MISSING();
    const form = await request.formData();
    const file = form.get("file");
    const paper = Number(form.get("paper"));
    if (!(file instanceof File)) {
      return HttpResponse.json({ file: ["No file was submitted."] }, { status: 400 });
    }
    if (!Number.isInteger(paper)) {
      return HttpResponse.json({ paper: ["A valid integer is required."] }, { status: 400 });
    }
    const profile = form.get("mapping_profile");
    const answer = await importResults({
      paperId: paper,
      file,
      dryRun: form.get("dry_run") === "true",
      mappingProfile: profile === null ? undefined : Number(profile),
      columnMap: (form.get("column_map") as string | null) ?? undefined,
      saveMappingAs: (form.get("save_mapping_as") as string | null) ?? undefined,
    });
    return HttpResponse.json(answer.body, { status: answer.status });
  }),

  http.get("/api/ingest/batches/", async ({ request }) => {
    await settle();
    return HttpResponse.json(paginate(listBatches(), new URL(request.url)));
  }),

  http.get("/api/ingest/mappings/", async ({ request }) => {
    await settle();
    return HttpResponse.json(paginate(listMappings(), new URL(request.url)));
  }),

  http.post("/api/ingest/mappings/", async ({ request }) => {
    await settle();
    if (!request.headers.get("X-CSRFToken")) return CSRF_MISSING();
    const body = (await request.json()) as { name?: string; mapping?: Record<string, string> };
    if (!body?.name?.trim()) {
      return HttpResponse.json({ name: ["This field may not be blank."] }, { status: 400 });
    }
    return HttpResponse.json(
      saveMapping(body.name.trim(), (body.mapping ?? {}) as never),
      { status: 201 },
    );
  }),

  /* --------------------------------------------------- answer-key review */

  http.get("/api/review/disagreements/", async ({ request }) => {
    await settle();
    const url = new URL(request.url);
    const paper = url.searchParams.get("paper");
    const rows = disagreements(url.searchParams.get("status")).filter((row) =>
      paper ? row.paper_id === Number(paper) : true,
    );
    return HttpResponse.json(paginate(rows, url));
  }),

  http.post("/api/review/disagreements/:question_pk/", async ({ params, request }) => {
    await settle();
    if (!request.headers.get("X-CSRFToken")) return CSRF_MISSING();
    const gate = await staff(request);
    if ("refusal" in gate) return gate.refusal;
    const body = (await request.json()) as { decision?: unknown; note?: unknown };
    const outcome = decide(num(params.question_pk), body?.decision, body?.note, gate.me.username);
    return HttpResponse.json(outcome.body, { status: outcome.status });
  }),
];
