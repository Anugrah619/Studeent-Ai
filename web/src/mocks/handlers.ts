import { HttpResponse, delay, http } from "msw";
import type {
  Intervention,
  InterventionRequest,
  Me,
  Paginated,
} from "@/api/types";
import { RISK_BANDS } from "@/lib/severity";
import {
  attemptsFor,
  marksLostFor,
  subjectBreakdownFor,
  topicStatesFor,
} from "./fixtures/analytics";
import { dashboardSummary } from "./fixtures/dashboard";
import { diagnosisFor, recordVerdict } from "./fixtures/diagnosis";
import { flags, interventions } from "./fixtures/flags";
import { INSTITUTE, batches, mentors, papers } from "./fixtures/institute";
import { planBlocks } from "./fixtures/plan";
import {
  mockScoresFor,
  seedById,
  seeds,
  studentDetail,
  studentListRow,
} from "./fixtures/students";

/**
 * The mock server exists to run the *same client code* the live API runs, so
 * every place it differs from Django is a bug this file is hiding.
 *
 * Three of those differences have been checked against a running server rather
 * than inferred, and are reproduced faithfully:
 *
 *   1. `PAGE_SIZE` is 50, matching `REST_FRAMEWORK["PAGE_SIZE"]` — not the 100
 *      this file used to invent. A page size the server does not have is a
 *      page-boundary bug you cannot reproduce until a demo. Only `/api/flags/`
 *      actually crosses it on the seeded institute: 81 rows, two pages.
 *
 *   2. The four `@action` routes DO return an envelope. They used to return
 *      bare arrays and this file reproduced that, because the server was right
 *      and drf-spectacular's inferred `Paginated…List` was wrong. That has
 *      flipped: `mock-scores`, `subject-breakdown`, `topic-states` and
 *      `attempts` each answer `{count, next, previous, results}` with every
 *      row on one page — `count === results.length`, `next: null`, even at 56
 *      topic states. `envelope()` reproduces that; `paginate()` is for the
 *      router list routes that really do page. `rowsOf` still accepts both
 *      shapes, which is what made the earlier disagreement survivable and
 *      costs one `Array.isArray` to keep.
 *
 *   3. `?open=` on `/api/flags/` is a presence filter. See that handler.
 */
const PAGE_SIZE = 50;

/** DRF `PageNumberPagination`, reproduced exactly. Router list routes only. */
function paginate<T>(rows: T[], url: URL): Paginated<T> {
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  const start = (page - 1) * PAGE_SIZE;
  const slice = rows.slice(start, start + PAGE_SIZE);

  const pageUrl = (n: number) => {
    const next = new URL(url);
    next.searchParams.set("page", String(n));
    return next.toString();
  };

  return {
    count: rows.length,
    next: start + PAGE_SIZE < rows.length ? pageUrl(page + 1) : null,
    previous: page > 1 ? pageUrl(page - 1) : null,
    results: slice,
  };
}

/**
 * One page holding everything — what the `@action` detail routes return.
 *
 * Not `paginate()`: that would split 56 topic states across two pages and the
 * live server does not, so the mock would be exercising a code path the
 * console never actually meets on this data.
 */
function envelope<T>(rows: T[]): Paginated<T> {
  return { count: rows.length, next: null, previous: null, results: rows };
}

/** A touch of latency so loading states are real rather than theoretical. */
async function settle() {
  await delay(120 + Math.random() * 180);
}

function id(
  params: Record<string, string | readonly string[] | undefined>,
): number {
  return Number(Array.isArray(params.id) ? params.id[0] : params.id);
}

function bool(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  return value === "true" || value === "1" || value === "True";
}

/* ------------------------------------------------------------------ *
 * Session
 *
 * The fixture session starts signed in. A demo that opens on a login form
 * nobody has credentials for is a worse first five seconds than one that opens
 * on the console — but the whole flow is real: sign out, and the login screen,
 * the CSRF priming call and `/api/me/` all run exactly as they do live.
 * ------------------------------------------------------------------ */

const DEMO_ME: Me = {
  id: 1,
  username: "aarambh.bhatia",
  name: "Dr. S. Bhatia",
  email: "bhatia@aarambh.example",
  role: "mentor",
  institute: { id: 1, name: INSTITUTE.name, city: INSTITUTE.city, slug: "aarambh" },
  mentor_id: 1,
  student_id: null,
  is_staff: false,
  is_superuser: false,
};

const session: { me: Me | null } = { me: DEMO_ME };

const MOCK_CSRF = "mock-csrf-token";

/** Reset between tests that care. */
export function signInDemoUser() {
  session.me = DEMO_ME;
}

const UNAUTHENTICATED = HttpResponse.json(
  { detail: "Authentication credentials were not provided." },
  { status: 403 },
);

/** Every tenant route is behind the session, exactly as `IsAuthenticated` is. */
function guard<T>(body: () => T): T | typeof UNAUTHENTICATED {
  return session.me === null ? UNAUTHENTICATED : body();
}

export const handlers = [
  /* ---------------------------------------------------------------- auth */

  http.get("/api/auth/csrf/", () => {
    // Django sets this cookie *without* HttpOnly, precisely so the client can
    // read it back and echo it in `X-CSRFToken`.
    //
    // The `Set-Cookie` header below is what lands it in a real browser. Under
    // jsdom + `msw/node` the response is served by an interceptor that never
    // reaches jsdom's cookie jar, so the mock writes the cookie directly too.
    // The client code under test is identical either way, and the
    // `X-CSRFToken` assertion on `/intervene/` is what proves it works.
    if (typeof document !== "undefined") {
      document.cookie = `csrftoken=${MOCK_CSRF}; Path=/; SameSite=Lax`;
    }
    return HttpResponse.json(
      { detail: "CSRF cookie set." },
      { headers: { "Set-Cookie": `csrftoken=${MOCK_CSRF}; Path=/; SameSite=Lax` } },
    );
  }),

  http.post("/api/auth/login/", async ({ request }) => {
    await settle();
    const body = (await request.json()) as { username?: string; password?: string };
    if (!body?.username || !body?.password) {
      return HttpResponse.json(
        { username: ["This field is required."] },
        { status: 400 },
      );
    }
    // The fixture accepts the seeded password and nothing else, so the error
    // path is reachable from the login screen without a backend.
    if (body.password !== "demo12345") {
      return HttpResponse.json(
        { detail: "Incorrect username or password." },
        { status: 400 },
      );
    }
    session.me = { ...DEMO_ME, username: body.username };
    return HttpResponse.json(session.me);
  }),

  http.post("/api/auth/logout/", async () => {
    await settle();
    session.me = null;
    return new HttpResponse(null, { status: 204 });
  }),

  http.get("/api/me/", async () => {
    await settle();
    return session.me ? HttpResponse.json(session.me) : UNAUTHENTICATED;
  }),

  /* ----------------------------------------------------------- dashboard */

  http.get("/api/dashboard/summary/", async () => {
    await settle();
    return guard(() => HttpResponse.json(dashboardSummary()));
  }),

  /* ------------------------------------------- router lists — PAGINATED */

  http.get("/api/batches/", async ({ request }) => {
    await settle();
    return guard(() => HttpResponse.json(paginate(batches, new URL(request.url))));
  }),

  http.get("/api/batches/:id/", async ({ params }) => {
    await settle();
    const batch = batches.find((b) => b.id === id(params));
    return batch
      ? HttpResponse.json(batch)
      : HttpResponse.json({ detail: "Not found." }, { status: 404 });
  }),

  http.get("/api/papers/", async ({ request }) => {
    await settle();
    return guard(() => HttpResponse.json(paginate(papers, new URL(request.url))));
  }),

  http.get("/api/papers/:id/", async ({ params }) => {
    await settle();
    const paper = papers.find((p) => p.id === id(params));
    return paper
      ? HttpResponse.json(paper)
      : HttpResponse.json({ detail: "Not found." }, { status: 404 });
  }),

  http.get("/api/students/", async ({ request }) => {
    await settle();
    const url = new URL(request.url);
    const batch = url.searchParams.get("batch");
    const atRisk = bool(url.searchParams.get("at_risk"));
    const active = bool(url.searchParams.get("active"));

    const rows = seeds
      .filter((s) => (batch ? s.batchId === Number(batch) : true))
      // The contract documents this threshold now: `?at_risk=true` is
      // `risk_score >= 0.55`, which is also `RISK_BANDS.high`. One constant,
      // so a student the API calls at-risk and a student the console chips
      // "High" are the same student by construction.
      .filter((s) =>
        atRisk === undefined
          ? true
          : s.risk_score >= RISK_BANDS.high === atRisk,
      )
      .filter((s) => (active === undefined ? true : !s.exited_at === active))
      .map(studentListRow)
      .sort((a, b) => b.risk_score - a.risk_score);

    return guard(() => HttpResponse.json(paginate(rows, url)));
  }),

  http.get("/api/students/:id/", async ({ params }) => {
    await settle();
    const detail = studentDetail(id(params));
    return detail
      ? HttpResponse.json(detail)
      : HttpResponse.json({ detail: "Not found." }, { status: 404 });
  }),

  http.get("/api/flags/", async ({ request }) => {
    await settle();
    const url = new URL(request.url);
    // `?open=` is a PRESENCE filter, not a boolean field: the contract says
    // `true` narrows to unresolved and any other value, `false` included, is
    // ignored and returns everything. Reproduced exactly, because a mock that
    // helpfully honours `open=false` lets the client stop filtering for the
    // closed-loop panel and the bug only appears against the real server.
    const openOnly = url.searchParams.get("open") === "true";
    const student = url.searchParams.get("student");

    const rows = flags
      .filter((f) => (openOnly ? f.is_open : true))
      .filter((f) => (student ? f.student_id === Number(student) : true))
      .sort((a, b) => Date.parse(b.raised_at) - Date.parse(a.raised_at));

    return guard(() => HttpResponse.json(paginate(rows, url)));
  }),

  http.get("/api/flags/:id/", async ({ params }) => {
    await settle();
    const flag = flags.find((f) => f.id === id(params));
    return flag
      ? HttpResponse.json(flag)
      : HttpResponse.json({ detail: "Not found." }, { status: 404 });
  }),

  http.get("/api/my/plan/", async ({ request }) => {
    await settle();
    return guard(() => HttpResponse.json(paginate(planBlocks, new URL(request.url))));
  }),

  http.get("/api/my/study-logs/", async ({ request }) => {
    await settle();
    return guard(() => HttpResponse.json(paginate([], new URL(request.url))));
  }),

  /* ------------------- @action detail routes — ENVELOPE, ONE PAGE (see 2.) */

  http.get("/api/students/:id/mock-scores/", async ({ params }) => {
    await settle();
    return guard(() => HttpResponse.json(envelope(mockScoresFor(id(params)))));
  }),

  http.get("/api/students/:id/subject-breakdown/", async ({ params }) => {
    await settle();
    return guard(() =>
      HttpResponse.json(envelope(subjectBreakdownFor(id(params)))),
    );
  }),

  http.get("/api/students/:id/topic-states/", async ({ params }) => {
    await settle();
    return guard(() => HttpResponse.json(envelope(topicStatesFor(id(params)))));
  }),

  http.get("/api/students/:id/attempts/", async ({ params }) => {
    await settle();
    return guard(() => HttpResponse.json(envelope(attemptsFor(id(params)))));
  }),

  /* -------------------------------- marks-lost: a single object, not a list */

  http.get("/api/students/:id/marks-lost/", async ({ params, request }) => {
    await settle();
    const paper = Number(new URL(request.url).searchParams.get("paper"));
    if (!Number.isFinite(paper)) {
      return HttpResponse.json(
        { detail: "A numeric ?paper=<id> is required." },
        { status: 400 },
      );
    }
    const data = marksLostFor(id(params), paper);
    return data
      ? HttpResponse.json(data)
      : HttpResponse.json(
          { detail: "No attempts recorded for that student on that paper." },
          { status: 404 },
        );
  }),

  /* ------------------------------------------------- the reasoning layer
   *
   * Both routes are in `openapi.yaml` now and the fixtures are transcripts of
   * real responses, so this mock's job is no longer to invent a shape — it is
   * to reproduce one. It serves all three of the endpoint's real answers, not
   * just the happy one —
   *
   *   200  a diagnosis (pattern found, or honestly not found)
   *   422  wired up, but nothing on this paper it can reason over
   *   503  not wired up at all — no reasoning key on this deployment
   *
   * — and which one a student gets is fixed per student, so every state is one
   * click away during a demo. */

  http.get("/api/students/:id/diagnosis/", async ({ params, request }) => {
    await settle();
    if (session.me === null) return UNAUTHENTICATED;

    const paper = Number(new URL(request.url).searchParams.get("paper"));
    if (!Number.isFinite(paper)) {
      return HttpResponse.json(
        { detail: "A numeric ?paper=<id> is required." },
        { status: 400 },
      );
    }

    const outcome = diagnosisFor(id(params), paper);
    if (outcome.kind === "unavailable") {
      return HttpResponse.json({ detail: outcome.detail }, { status: 503 });
    }
    if (outcome.kind === "insufficient") {
      return HttpResponse.json({ detail: outcome.detail }, { status: 422 });
    }
    return HttpResponse.json(outcome.body);
  }),

  http.post("/api/students/:id/diagnosis/verdict/", async ({ params, request }) => {
    await settle();
    if (session.me === null) return UNAUTHENTICATED;

    // Same assertion as `/intervene/`: an unsafe request without this header is
    // a 403 from Django, and the mock is only worth having if it says so too.
    if (!request.headers.get("X-CSRFToken")) {
      return HttpResponse.json(
        { detail: "CSRF Failed: CSRF token missing." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as { verdict?: string; note?: string };
    if (body?.verdict !== "agreed" && body?.verdict !== "disagreed") {
      return HttpResponse.json(
        { verdict: ['Must be "agreed" or "disagreed".'] },
        { status: 400 },
      );
    }

    const updated = recordVerdict(id(params), body.verdict);
    if (!updated) {
      return HttpResponse.json(
        { detail: "No diagnosis on file for that student." },
        { status: 404 },
      );
    }

    // 200 with the whole diagnosis, `human_verdict` set — which is what the
    // live route answers with. The old mock returned a 201 and a little
    // `{verdict, note, recorded_at}` receipt of its own invention, so the
    // client had no choice but to patch its cache from the request body.
    return HttpResponse.json(updated);
  }),

  /* ------------------------------------------------------------ mutations */

  http.post("/api/flags/:id/intervene/", async ({ params, request }) => {
    await settle();
    if (session.me === null) return UNAUTHENTICATED;

    // Django's `CsrfViewMiddleware` rejects an unsafe request without this
    // header. Asserting it here is what makes the mock path prove the client
    // really sends it, rather than discovering it at the live API.
    if (!request.headers.get("X-CSRFToken")) {
      return HttpResponse.json(
        { detail: "CSRF Failed: CSRF token missing." },
        { status: 403 },
      );
    }

    const flagId = id(params);
    const flag = flags.find((f) => f.id === flagId);
    if (!flag) {
      return HttpResponse.json({ detail: "Not found." }, { status: 404 });
    }

    const body = (await request.json()) as InterventionRequest;
    if (!body?.action?.trim()) {
      return HttpResponse.json(
        { action: ["This field may not be blank."] },
        { status: 400 },
      );
    }

    const student = seedById.get(flag.student_id);
    const mentor =
      mentors.find((m) => m.id === body.mentor) ??
      mentors.find((m) => m.id === student?.mentorId) ??
      mentors[0];

    const record: Intervention = {
      id: 900 + interventions.length + 1,
      flag: flagId,
      mentor: mentor.id,
      mentor_name: mentor.name,
      action: body.action,
      taken_at: new Date().toISOString(),
    };
    interventions.push(record);

    // Logging an intervention closes the loop: the flag leaves the triage list.
    flag.is_open = false;
    flag.resolved_at = record.taken_at;
    flag.outcome = "unknown";

    return HttpResponse.json(record, { status: 201 });
  }),

  http.post("/api/my/plan/:id/complete/", async ({ params }) => {
    await settle();
    const block = planBlocks.find((b) => b.id === id(params));
    if (!block) {
      return HttpResponse.json({ detail: "Not found." }, { status: 404 });
    }
    block.completed = true;
    return HttpResponse.json(block);
  }),
];
