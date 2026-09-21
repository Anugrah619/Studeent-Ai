import { HttpResponse, delay, http } from "msw";
import type { Intervention, InterventionRequest, Paginated } from "@/api/types";
import {
  attemptsFor,
  marksLostFor,
  subjectBreakdownFor,
  topicStatesFor,
} from "./fixtures/analytics";
import { dashboardSummary } from "./fixtures/dashboard";
import { flags, interventions } from "./fixtures/flags";
import { batches, mentors, papers } from "./fixtures/institute";
import { planBlocks } from "./fixtures/plan";
import {
  mockScoresFor,
  seedById,
  seeds,
  studentDetail,
  studentListRow,
} from "./fixtures/students";

const PAGE_SIZE = 100;

/** DRF PageNumberPagination, reproduced exactly so pagination bugs surface here. */
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

export const handlers = [
  http.get("/api/dashboard/summary/", async () => {
    await settle();
    return HttpResponse.json(dashboardSummary());
  }),

  http.get("/api/batches/", async ({ request }) => {
    await settle();
    return HttpResponse.json(paginate(batches, new URL(request.url)));
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
    return HttpResponse.json(paginate(papers, new URL(request.url)));
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
      // `at_risk` has no documented threshold in the contract; the backend owns
      // it. 55 is the same boundary the UI uses for its "High" risk band.
      .filter((s) => (atRisk === undefined ? true : s.risk_score >= 55 === atRisk))
      .filter((s) => (active === undefined ? true : !s.exited_at === active))
      .map(studentListRow)
      .sort((a, b) => b.risk_score - a.risk_score);

    return HttpResponse.json(paginate(rows, url));
  }),

  http.get("/api/students/:id/", async ({ params }) => {
    await settle();
    const detail = studentDetail(id(params));
    return detail
      ? HttpResponse.json(detail)
      : HttpResponse.json({ detail: "Not found." }, { status: 404 });
  }),

  http.get("/api/students/:id/mock-scores/", async ({ params, request }) => {
    await settle();
    return HttpResponse.json(
      paginate(mockScoresFor(id(params)), new URL(request.url)),
    );
  }),

  http.get("/api/students/:id/subject-breakdown/", async ({ params, request }) => {
    await settle();
    return HttpResponse.json(
      paginate(subjectBreakdownFor(id(params)), new URL(request.url)),
    );
  }),

  http.get("/api/students/:id/topic-states/", async ({ params, request }) => {
    await settle();
    return HttpResponse.json(
      paginate(topicStatesFor(id(params)), new URL(request.url)),
    );
  }),

  http.get("/api/students/:id/attempts/", async ({ params, request }) => {
    await settle();
    return HttpResponse.json(
      paginate(attemptsFor(id(params)), new URL(request.url)),
    );
  }),

  http.get("/api/students/:id/marks-lost/", async ({ params, request }) => {
    await settle();
    const paper = Number(new URL(request.url).searchParams.get("paper"));
    if (!Number.isFinite(paper)) {
      return HttpResponse.json(
        { paper: ["This query parameter is required."] },
        { status: 400 },
      );
    }
    const data = marksLostFor(id(params), paper);
    return data
      ? HttpResponse.json(data)
      : HttpResponse.json({ detail: "Not found." }, { status: 404 });
  }),

  http.get("/api/flags/", async ({ request }) => {
    await settle();
    const url = new URL(request.url);
    // `open` and `student` are not in the contract — see src/api/gaps.ts. The
    // mock honours them so the client's belt-and-braces filtering matches.
    const open = bool(url.searchParams.get("open"));
    const student = url.searchParams.get("student");

    const rows = flags
      .filter((f) => (open === undefined ? true : f.is_open === open))
      .filter((f) => (student ? f.student_id === Number(student) : true))
      .sort((a, b) => Date.parse(b.raised_at) - Date.parse(a.raised_at));

    return HttpResponse.json(paginate(rows, url));
  }),

  http.get("/api/flags/:id/", async ({ params }) => {
    await settle();
    const flag = flags.find((f) => f.id === id(params));
    return flag
      ? HttpResponse.json(flag)
      : HttpResponse.json({ detail: "Not found." }, { status: 404 });
  }),

  http.post("/api/flags/:id/intervene/", async ({ params, request }) => {
    await settle();
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

  http.get("/api/my/plan/", async ({ request }) => {
    await settle();
    return HttpResponse.json(paginate(planBlocks, new URL(request.url)));
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

  http.get("/api/my/study-logs/", async ({ request }) => {
    await settle();
    return HttpResponse.json(paginate([], new URL(request.url)));
  }),
];
