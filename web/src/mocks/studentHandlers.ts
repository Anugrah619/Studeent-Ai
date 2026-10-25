import { HttpResponse, delay, http } from "msw";
import type { Me, Paginated } from "@/api/types";
import {
  addRating,
  addStudyLog,
  answerQuestion,
  attemptsOf,
  completeRevision,
  explainPlan,
  findingsOf,
  generatePlan,
  localDay,
  marksLostOf,
  mockScoresOf,
  nextActionsOf,
  onboardingOf,
  profileOf,
  questionOf,
  revisionsOf,
  subjectBreakdownOf,
  topicStatesOf,
  worldFor,
  type World,
} from "./fixtures/student/world";

/**
 * `/api/my/…` — the student app's routes — reproduced against the fixture
 * world in `fixtures/student/world.ts`.
 *
 * Who is calling decides the answer, as on the live server (`my_views.py`):
 *
 *   no session              403, as every tenant route
 *   temporary password      403 `password_change_required`
 *   a staff account         an empty page from list routes, 403 from
 *                           singletons and writes — EXCEPT the three routes the
 *                           console's own mocks already serve (`GET my/plan`,
 *                           `GET my/study-logs`, `POST my/plan/{id}/complete`),
 *                           where the request falls through to those handlers
 *                           so the console's Student 360 demo is untouched
 *   a student               their own world
 *
 * The refusals are the server's own: the 400 bodies carry DRF's field-error
 * shape and wording, the throttles answer 429 at the configured rates, and
 * `guidance/ask` answers 503 only when told to (`setGuideOffline`).
 *
 * Exported as a function of the session, because the session lives in
 * `handlers.ts` and this module must not import it back.
 */

const UNAUTHENTICATED = { detail: "Authentication credentials were not provided." };
const PASSWORD_CHANGE_REQUIRED = {
  detail: "Choose a new password before you continue.",
  code: "password_change_required",
};
const STUDENTS_ONLY = { detail: "This route is for student accounts." };
const NOT_YOUR_CHAPTER = "That chapter is not part of your syllabus.";

/** `REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]`, as configured. */
const RATES = { plan_generate: 30, onboarding: 30, guidance_ask: 20, student_write: 120 };

/** DRF's own 429 sentence. */
function throttled(seconds: number) {
  return HttpResponse.json(
    { detail: `Request was throttled. Expected available in ${seconds} seconds.` },
    { status: 429 },
  );
}

async function settle() {
  await delay(120 + Math.random() * 160);
}

/** DRF `PageNumberPagination` at a given page size. */
function paginate<T>(rows: T[], url: URL, size: number, max: number): Paginated<T> {
  const asked = Number(url.searchParams.get("page_size"));
  const pageSize = Number.isInteger(asked) && asked > 0 ? Math.min(asked, max) : size;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const start = (page - 1) * pageSize;
  const pageUrl = (n: number) => {
    const next = new URL(url);
    next.searchParams.set("page", String(n));
    return next.toString();
  };
  return {
    count: rows.length,
    next: start + pageSize < rows.length ? pageUrl(page + 1) : null,
    previous: page > 1 ? pageUrl(page - 1) : null,
    results: rows.slice(start, start + pageSize),
  };
}

/** `SubResourcePagination` (200 a page) — the @action read models. */
const subPage = <T>(rows: T[], url: URL) => paginate(rows, url, 200, 500);
/** `StandardPagination` (50 a page) — plan, study log, confidence. */
const stdPage = <T>(rows: T[], url: URL) => paginate(rows, url, 50, 200);

type Access =
  | { kind: "anonymous" }
  | { kind: "gate" }
  | { kind: "staff" }
  | { kind: "student"; world: World };

/** Whether the guide answers. Tests flip it; the demo leaves it on. */
const guide = { offline: false };
export function setGuideOffline(offline: boolean) {
  guide.offline = offline;
}

function idParam(params: Record<string, string | readonly string[] | undefined>): number {
  return Number(Array.isArray(params.id) ? params.id[0] : params.id);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/* ---------------------------------------- DRF field validation, as worded */

type Errors = Record<string, string[]>;

function intField(
  errors: Errors,
  body: Record<string, unknown>,
  key: string,
  { min, max, required = true, nullable = false }: { min?: number; max?: number; required?: boolean; nullable?: boolean },
): number | null | undefined {
  const raw = body[key];
  if (raw === undefined || raw === "") {
    if (required) errors[key] = ["This field is required."];
    return undefined;
  }
  if (raw === null) {
    if (!nullable) errors[key] = ["This field may not be null."];
    return null;
  }
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(value)) {
    errors[key] = ["A valid integer is required."];
    return undefined;
  }
  if (min !== undefined && value < min) {
    errors[key] = [`Ensure this value is greater than or equal to ${min}.`];
    return undefined;
  }
  if (max !== undefined && value > max) {
    errors[key] = [`Ensure this value is less than or equal to ${max}.`];
    return undefined;
  }
  return value;
}

function chapterField(errors: Errors, body: Record<string, unknown>, world: World): number | undefined {
  const raw = body.topic;
  if (raw === undefined || raw === null || raw === "") {
    errors.topic = [raw === null ? "This field may not be null." : "This field is required."];
    return undefined;
  }
  const id = Number(raw);
  if (!Number.isInteger(id) || !world.topics.some((t) => t.id === id)) {
    errors.topic = [NOT_YOUR_CHAPTER];
    return undefined;
  }
  return id;
}

const bad = (errors: Errors) => HttpResponse.json(errors, { status: 400 });

export function studentHandlers(currentMe: () => Me | null) {
  function access(): Access {
    const me = currentMe();
    if (me === null) return { kind: "anonymous" };
    if (me.must_change_password) return { kind: "gate" };
    if (me.role !== "student") return { kind: "staff" };
    return { kind: "student", world: worldFor(me) };
  }

  /** The refusal for anything that is not a signed-in student, or null. */
  function refuse(a: Access, { list }: { list?: URL } = {}) {
    if (a.kind === "anonymous") return HttpResponse.json(UNAUTHENTICATED, { status: 403 });
    if (a.kind === "gate") return HttpResponse.json(PASSWORD_CHANGE_REQUIRED, { status: 403 });
    if (a.kind === "staff") {
      return list
        ? HttpResponse.json(subPage([], list))
        : HttpResponse.json(STUDENTS_ONLY, { status: 403 });
    }
    return null;
  }

  /** Django's CSRF middleware, for every unsafe request. */
  function csrf(request: Request) {
    return request.headers.get("X-CSRFToken")
      ? null
      : HttpResponse.json({ detail: "CSRF Failed: CSRF token missing." }, { status: 403 });
  }

  return [
    /* ------------------------------------------------------- singletons */

    http.get("/api/my/profile/", async () => {
      await settle();
      const a = access();
      return refuse(a) ?? HttpResponse.json(profileOf((a as { world: World }).world));
    }),

    http.get("/api/my/onboarding/", async () => {
      await settle();
      const a = access();
      return refuse(a) ?? HttpResponse.json(onboardingOf((a as { world: World }).world));
    }),

    http.put("/api/my/onboarding/", async ({ request }) => {
      await settle();
      const a = access();
      const refused = refuse(a) ?? csrf(request);
      if (refused) return refused;
      const world = (a as { world: World }).world;
      world.counters.onboarding += 1;
      if (world.counters.onboarding > RATES.onboarding) return throttled(1800);

      const body = await readJson(request);
      const errors: Errors = {};
      const minutes = intField(errors, body, "daily_minutes", { min: 45, max: 720 });
      const rank = intField(errors, body, "target_rank", { min: 1, required: false, nullable: true });
      if (Object.keys(errors).length) return bad(errors);

      world.onboarding.dailyMinutes = minutes as number;
      // A PUT replaces both answers: leaving the rank out clears it.
      world.onboarding.targetRank = rank ?? null;
      world.onboarding.onboardedAt ??= new Date().toISOString();
      return HttpResponse.json(onboardingOf(world));
    }),

    http.get("/api/my/marks-lost/", async ({ request }) => {
      await settle();
      const a = access();
      const refused = refuse(a);
      if (refused) return refused;
      const raw = new URL(request.url).searchParams.get("paper") ?? "";
      if (!/^\d+$/.test(raw)) {
        return HttpResponse.json({ detail: "A numeric ?paper=<id> is required." }, { status: 400 });
      }
      const data = marksLostOf((a as { world: World }).world, Number(raw));
      return data
        ? HttpResponse.json(data)
        : HttpResponse.json({ detail: "You have no answers recorded on that paper." }, { status: 404 });
    }),

    http.get("/api/my/questions/:id/", async ({ params }) => {
      await settle();
      const a = access();
      const refused = refuse(a);
      if (refused) return refused;
      const question = questionOf((a as { world: World }).world, idParam(params));
      // One body for "no such question" and "not yours", as the live route.
      return question
        ? HttpResponse.json(question)
        : HttpResponse.json({ detail: "No such question." }, { status: 404 });
    }),

    /* ------------------------------------------------------- read models */

    http.get("/api/my/topics/", async ({ request }) => {
      await settle();
      const url = new URL(request.url);
      const a = access();
      return refuse(a, { list: url }) ?? HttpResponse.json(subPage((a as { world: World }).world.topics, url));
    }),

    http.get("/api/my/topic-states/", async ({ request }) => {
      await settle();
      const url = new URL(request.url);
      const a = access();
      const refused = refuse(a, { list: url });
      if (refused) return refused;
      const rows = topicStatesOf((a as { world: World }).world, {
        // Presence filters: only the literal `true` narrows.
        weak: url.searchParams.get("weak") === "true",
        forgetting: url.searchParams.get("forgetting") === "true",
      });
      return HttpResponse.json(subPage(rows, url));
    }),

    http.get("/api/my/mock-scores/", async ({ request }) => {
      await settle();
      const url = new URL(request.url);
      const a = access();
      return refuse(a, { list: url }) ?? HttpResponse.json(subPage(mockScoresOf((a as { world: World }).world), url));
    }),

    http.get("/api/my/subject-breakdown/", async ({ request }) => {
      await settle();
      const url = new URL(request.url);
      const a = access();
      return (
        refuse(a, { list: url }) ??
        HttpResponse.json(subPage(subjectBreakdownOf((a as { world: World }).world), url))
      );
    }),

    http.get("/api/my/attempts/", async ({ request }) => {
      await settle();
      const url = new URL(request.url);
      const a = access();
      const refused = refuse(a, { list: url });
      if (refused) return refused;
      const paper = url.searchParams.get("paper");
      const status = url.searchParams.get("status");
      if (paper && !/^\d+$/.test(paper)) {
        return bad({ paper: ["Use the numeric id of a paper."] });
      }
      if (status && !["correct", "wrong", "blank", "not_reached"].includes(status)) {
        return bad({ status: ["One of: correct, wrong, blank, not_reached."] });
      }
      const rows = attemptsOf((a as { world: World }).world, {
        paper: paper ? Number(paper) : undefined,
        status: status ?? undefined,
      });
      return HttpResponse.json(subPage(rows, url));
    }),

    http.get("/api/my/revisions/", async ({ request }) => {
      await settle();
      const url = new URL(request.url);
      const a = access();
      const refused = refuse(a, { list: url });
      if (refused) return refused;
      const rows = revisionsOf((a as { world: World }).world, url.searchParams.get("pending") === "true");
      return HttpResponse.json(subPage(rows, url));
    }),

    http.get("/api/my/guidance/", async () => {
      await settle();
      const a = access();
      const refused = refuse(a);
      if (refused) return refused;
      const world = (a as { world: World }).world;
      return HttpResponse.json({ next_actions: nextActionsOf(world), findings: findingsOf(world) });
    }),

    /* -------------------------------------------- the day plan and its why */

    http.get("/api/my/plan/", async ({ request }) => {
      const a = access();
      // A mentor's `my/plan` is the console's demo plan: leave it to that mock.
      if (a.kind === "staff") return undefined;
      await settle();
      const refused = refuse(a);
      if (refused) return refused;
      const url = new URL(request.url);
      const date = url.searchParams.get("date");
      if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return bad({ date: ["Date has wrong format. Use one of these formats instead: YYYY-MM-DD."] });
      }
      const world = (a as { world: World }).world;
      const blocks = date && date !== localDay() ? [] : world.plan;
      return HttpResponse.json(stdPage(blocks, url));
    }),

    http.post("/api/my/plan/generate/", async ({ request }) => {
      await settle();
      const a = access();
      const refused = refuse(a) ?? csrf(request);
      if (refused) return refused;
      const world = (a as { world: World }).world;
      world.counters.generate += 1;
      if (world.counters.generate > RATES.plan_generate) return throttled(2400);

      const body = await readJson(request);
      if (body.date !== undefined && body.date !== localDay()) {
        // The fixtures plan today only; a later day gets the server's refusal
        // for the past and an empty answer for the future.
        const date = String(body.date);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return bad({ date: ["Date has wrong format. Use one of these formats instead: YYYY-MM-DD."] });
        }
        if (date < localDay()) return bad({ date: ["A plan is for today or a day to come."] });
        if (date > localDay(7)) return bad({ date: ["Plans go at most 7 days ahead."] });
        return HttpResponse.json({ date, generated: false, blocks: [], note: null });
      }
      const result = generatePlan(world, { replace: body.replace === true });
      return HttpResponse.json(result.body, { status: result.status });
    }),

    http.post("/api/my/plan/explain/", async ({ request }) => {
      await settle();
      const a = access();
      const refused = refuse(a) ?? csrf(request);
      if (refused) return refused;
      const world = (a as { world: World }).world;
      world.counters.explain += 1;
      // Always a 200: over budget, or with the guide offline, the summary is
      // the fixed one and `available` is false.
      const result = explainPlan(world);
      if (guide.offline && result.available) {
        const blocks = world.plan;
        return HttpResponse.json({
          ...result,
          summary: `Today's plan has ${blocks.length} block${blocks.length === 1 ? "" : "s"}, ${blocks.reduce((s, b) => s + b.minutes, 0)} minutes in all. First, ${blocks[0].mode === "practice" ? "practise" : blocks[0].mode === "learn" ? "start" : "revise"} ${blocks[0].topic_name}.`,
          available: false,
          from_cache: false,
        });
      }
      return HttpResponse.json(result);
    }),

    http.post("/api/my/plan/:id/complete/", async ({ params, request }) => {
      const a = access();
      if (a.kind === "staff") return undefined;
      await settle();
      const refused = refuse(a) ?? csrf(request);
      if (refused) return refused;
      const block = (a as { world: World }).world.plan.find((b) => b.id === idParam(params));
      if (!block) return HttpResponse.json({ detail: "No such plan block." }, { status: 404 });
      block.completed = true;
      return HttpResponse.json(block);
    }),

    http.post("/api/my/plan/:id/uncomplete/", async ({ params, request }) => {
      await settle();
      const a = access();
      const refused = refuse(a) ?? csrf(request);
      if (refused) return refused;
      const block = (a as { world: World }).world.plan.find((b) => b.id === idParam(params));
      if (!block) return HttpResponse.json({ detail: "No such plan block." }, { status: 404 });
      block.completed = false;
      return HttpResponse.json(block);
    }),

    /* -------------------------------------------------------- the writes */

    http.get("/api/my/study-logs/", async ({ request }) => {
      const a = access();
      if (a.kind === "staff") return undefined;
      await settle();
      const refused = refuse(a);
      if (refused) return refused;
      return HttpResponse.json(stdPage((a as { world: World }).world.logs, new URL(request.url)));
    }),

    http.post("/api/my/study-logs/", async ({ request }) => {
      await settle();
      const a = access();
      const refused = refuse(a) ?? csrf(request);
      if (refused) return refused;
      const world = (a as { world: World }).world;
      const body = await readJson(request);
      const errors: Errors = {};
      const topic = chapterField(errors, body, world);
      const minutes = intField(errors, body, "minutes", { min: 1, max: 720 });
      const mode = body.mode;
      if (mode === undefined || mode === "") errors.mode = ["This field is required."];
      else if (!["learn", "practice", "revise"].includes(String(mode))) {
        errors.mode = [`"${String(mode)}" is not a valid choice.`];
      }
      const ts = body.ts;
      if (ts === undefined || ts === "") errors.ts = ["This field is required."];
      else if (Number.isNaN(Date.parse(String(ts)))) {
        errors.ts = [
          "Datetime has wrong format. Use one of these formats instead: YYYY-MM-DDThh:mm[:ss[.uuuuuu]][+HH:MM|-HH:MM|Z].",
        ];
      } else if (Date.parse(String(ts)) > Date.now() + 5 * 60_000) {
        errors.ts = ["That time has not happened yet. Log study time after you have done it."];
      }
      if (Object.keys(errors).length) return bad(errors);
      const row = addStudyLog(world, {
        topic: topic as number,
        minutes: minutes as number,
        mode: mode as "learn" | "practice" | "revise",
        ts: String(ts),
      });
      return HttpResponse.json(row, { status: 201 });
    }),

    http.get("/api/my/confidence/", async ({ request }) => {
      await settle();
      const url = new URL(request.url);
      const a = access();
      return refuse(a, { list: url }) ?? HttpResponse.json(stdPage((a as { world: World }).world.ratings, url));
    }),

    http.post("/api/my/confidence/", async ({ request }) => {
      await settle();
      const a = access();
      const refused = refuse(a) ?? csrf(request);
      if (refused) return refused;
      const world = (a as { world: World }).world;
      const body = await readJson(request);
      const errors: Errors = {};
      const topic = chapterField(errors, body, world);
      const rating = intField(errors, body, "self_rating", { min: 1, max: 5 });
      if (Object.keys(errors).length) return bad(errors);
      return HttpResponse.json(addRating(world, topic as number, rating as number), { status: 201 });
    }),

    http.post("/api/my/revisions/:id/complete/", async ({ params, request }) => {
      await settle();
      const a = access();
      const refused = refuse(a) ?? csrf(request);
      if (refused) return refused;
      const revision = completeRevision((a as { world: World }).world, idParam(params));
      return revision
        ? HttpResponse.json(revision)
        : HttpResponse.json({ detail: "No such revision." }, { status: 404 });
    }),

    /* ---------------------------------------------------------- the guide */

    http.post("/api/my/guidance/ask/", async ({ request }) => {
      await settle();
      const a = access();
      const refused = refuse(a) ?? csrf(request);
      if (refused) return refused;
      const world = (a as { world: World }).world;
      const body = await readJson(request);
      const question = typeof body.question === "string" ? body.question : "";
      if (body.question === undefined) return bad({ question: ["This field is required."] });
      if (!question.trim()) return bad({ question: ["This field may not be blank."] });
      if (question.length > 500) {
        return bad({ question: ["Ensure this field has no more than 500 characters."] });
      }
      if (guide.offline) {
        return HttpResponse.json(
          {
            detail:
              "The guide can't answer right now — it's busy or offline. Your plan, revisions and results all still work, and you can ask again in a few minutes or ask your mentor.",
          },
          { status: 503 },
        );
      }
      // Counted only when a question needs a fresh answer, as the server
      // counts it: a repeat is free.
      const normalised = question.replace(/\s+/g, " ").trim().toLowerCase();
      if (!world.asked.has(normalised)) {
        world.counters.ask += 1;
        if (world.counters.ask > RATES.guidance_ask) return throttled(41_760);
      }
      const { answer, fromCache } = answerQuestion(world, question);
      return HttpResponse.json({ answer, available: true, from_cache: fromCache });
    }),
  ];
}
