// The DOM is installed by `scripts/run-tests.mjs` via `node --import`, before
// this module — or any of React's or Radix's — is evaluated.
import assert from "node:assert/strict";
import test, { after, afterEach, before } from "node:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import App, { queryClient } from "../src/App";
import type { Me } from "../src/api/types";
import { handlers, signInAs, signInDemoUser } from "../src/mocks/handlers";
import { setGuideOffline } from "../src/mocks/studentHandlers";
import { JEE_CHAPTERS } from "../src/mocks/fixtures/student/syllabi";
import { resetStudentWorlds, worldFor } from "../src/mocks/fixtures/student/world";
import { text, waitFor } from "./dom";

/**
 * The student's own app, end to end against the mock server.
 *
 * Every test signs in as a student and drives the screens the way a student
 * would — taps, typing, submitting — and then checks two things: what the
 * screen says, and what the mock server's world now holds. The second half is
 * what makes these fail when a feature breaks rather than when a sentence is
 * reworded: a tick that only repainted the bubble, or a log that never left
 * the browser, passes the first check and fails the second.
 */

const server = setupServer(...handlers);
const requested: string[] = [];

before(() => {
  server.listen({ onUnhandledRequest: "error" });
  server.events.on("request:start", ({ request }) => {
    requested.push(`${request.method} ${new URL(request.url).pathname}`);
  });
});
afterEach(() => {
  server.resetHandlers();
  signInDemoUser();
  resetStudentWorlds();
  setGuideOffline(false);
  requested.length = 0;
  queryClient.clear();
});
after(() => server.close());

const INSTITUTE = { id: 1, name: "Aarambh Classes", city: "Kota", slug: "aarambh" };

const AARAV: Me = {
  id: 501,
  username: "A-1041",
  name: "Aarav Mehta",
  email: "",
  role: "student",
  institute: INSTITUTE,
  mentor_id: null,
  student_id: 1,
  is_staff: false,
  is_superuser: false,
  must_change_password: false,
};

const DIYA: Me = { ...AARAV, id: 502, username: "N-5012", name: "Diya Sharma", student_id: 901 };

/** Sign in as a student who has already answered the onboarding questions. */
function signInOnboarded(me: Me = AARAV) {
  signInAs(me);
  worldFor(me).onboarding = {
    dailyMinutes: 240,
    targetRank: null,
    onboardedAt: new Date().toISOString(),
  };
}

async function renderAt(path: string): Promise<Root> {
  window.history.pushState({}, "", path);
  document.body.innerHTML = "<div id='root'></div>";
  const root = createRoot(document.getElementById("root")!);
  await act(async () => {
    root.render(<App />);
  });
  return root;
}

function click(element: Element) {
  return act(async () => {
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
}

/** Set a controlled input or textarea the way a browser does, so onChange fires. */
function typeInto(target: string | Element, value: string) {
  const el = (typeof target === "string" ? document.getElementById(target) : target) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | null;
  assert.ok(el, `${String(target)} is on screen`);
  const proto =
    el instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  return act(async () => {
    set.call(el, value);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

function button(label: string | RegExp, scope: ParentNode = document): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll("button")).find((b) => {
    const name = `${b.getAttribute("aria-label") ?? ""} ${b.textContent ?? ""}`;
    return typeof label === "string" ? name.includes(label) : label.test(name);
  });
  assert.ok(found, `a button "${String(label)}" is on screen`);
  return found as HTMLButtonElement;
}

function planCheckboxes(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("[data-block-id] button[role='checkbox']"));
}

/* ------------------------------------------------------------------ *
 * Onboarding
 * ------------------------------------------------------------------ */

test("onboarding comes first, saves both answers, and is not shown again", async () => {
  signInAs(AARAV);
  let root = await renderAt("/");
  await waitFor(() => text().includes("Let's fit your plan to your day.") && text().includes("Your institute set these"));

  let body = text();
  assert.ok(body.includes("JEE Main"), "the exam, as the institute set it");
  assert.ok(body.includes("Alpha"), "the batch");
  assert.ok(body.includes("6 April 2027"), "the exam date");
  assert.ok(!body.includes("Make today's plan"), "nothing else is mounted before onboarding");
  assert.equal(document.querySelector("nav[aria-label='Primary']"), null, "no tab bar yet");
  // Read-only: the facts are text, not fields.
  assert.equal(document.querySelectorAll("input").length, 3, "minutes slider, exact minutes and rank only");

  await click(button("4 h"));
  assert.equal((document.getElementById("daily-minutes") as HTMLInputElement).value, "240", "a preset fills the exact field");
  await typeInto("daily-minutes", "200");
  await typeInto("target-rank", "4500");
  await click(button("Save and see today"));

  // The gate opens on the server's answer: today's screen, under the shell.
  await waitFor(() => text().includes("Make today's plan"), { timeout: 8000 });
  assert.ok(text().includes("Aarav."), "greets them by first name");
  const world = worldFor(AARAV);
  assert.equal(world.onboarding.dailyMinutes, 200, "the exact minutes reached the server");
  assert.equal(world.onboarding.targetRank, 4500);
  assert.ok(requested.includes("PUT /api/my/onboarding/"));
  await act(async () => root.unmount());

  // A fresh visit goes straight to today, never back through onboarding.
  queryClient.clear();
  root = await renderAt("/");
  await waitFor(() => text().includes("Make today's plan"));
  assert.ok(!text().includes("Let's fit your plan to your day."), "onboarding is not shown again");
  await act(async () => root.unmount());

  // …and stays reachable, as the student's own settings, with their answers.
  root = await renderAt("/onboarding");
  await waitFor(() => text().includes("Your study time and target.") && document.getElementById("daily-minutes") !== null);
  body = text();
  assert.equal((document.getElementById("daily-minutes") as HTMLInputElement).value, "200");
  assert.equal((document.getElementById("target-rank") as HTMLInputElement).value, "4500");
  assert.ok(body.includes("Sign out"));
  await act(async () => root.unmount());
});

test("onboarding shows the server's own reason for refusing an answer", async () => {
  signInAs(AARAV);
  server.use(
    http.put("/api/my/onboarding/", () =>
      HttpResponse.json({ target_rank: ["Ensure this value is greater than or equal to 1."] }, { status: 400 }),
    ),
  );
  const root = await renderAt("/");
  await waitFor(() => document.getElementById("daily-minutes") !== null);
  await click(button("Save and see today"));
  await waitFor(() => text().includes("Ensure this value is greater than or equal to 1."));
  assert.ok(text().includes("Let's fit your plan to your day."), "still on onboarding");
  await act(async () => root.unmount());
});

/* ------------------------------------------------------------------ *
 * Today: making and ticking a plan, the note and the why
 * ------------------------------------------------------------------ */

test("making today's plan, then ticking a block and taking the tick back", async () => {
  signInOnboarded();
  const root = await renderAt("/");
  await waitFor(() => text().includes("Nothing planned for today yet."));
  assert.equal(planCheckboxes().length, 0);

  await click(button("Make today's plan"));
  await waitFor(() => planCheckboxes().length > 0, { timeout: 8000 });

  const world = worldFor(AARAV);
  const n = world.plan.length;
  assert.ok(n >= 3, "the plan has blocks");
  assert.equal(planCheckboxes().length, n, "one bubble per block");
  assert.ok(requested.includes("POST /api/my/plan/generate/"));

  // Every block says what, which subject, how long, and why.
  const first = document.querySelector("[data-block-id]")!.textContent ?? "";
  assert.ok(first.includes("Revise"), "the mode");
  assert.ok(first.includes("Chemical Bonding and Molecular Structure"), "the chapter");
  assert.ok(first.includes("Chemistry"), "the subject");
  assert.ok(first.includes("30 min"), "the minutes");
  assert.ok(first.includes("Revision 1 was due 3 days ago"), "the reason, as the server wrote it");
  assert.match(text(), new RegExp(`0 of ${n} done`));

  await click(planCheckboxes()[0]);
  await waitFor(() => world.plan[0].completed === true && text().includes(`1 of ${n} done`), { timeout: 8000 });
  assert.equal(planCheckboxes()[0].getAttribute("aria-checked"), "true");
  assert.ok(requested.some((r) => r === `POST /api/my/plan/${world.plan[0].id}/complete/`));

  // A mis-tap is undone with the same tap.
  await click(planCheckboxes()[0]);
  await waitFor(() => world.plan[0].completed === false && text().includes(`0 of ${n} done`), { timeout: 8000 });
  assert.equal(planCheckboxes()[0].getAttribute("aria-checked"), "false");
  assert.ok(requested.some((r) => r === `POST /api/my/plan/${world.plan[0].id}/uncomplete/`));
  await act(async () => root.unmount());
});

test("a lighter day's note is shown, and 'Why this plan?' explains the day", async () => {
  signInOnboarded();
  const root = await renderAt("/");
  await waitFor(() => text().includes("Make today's plan"));
  await click(button("Make today's plan"));
  await waitFor(() => planCheckboxes().length > 0, { timeout: 8000 });

  // The note comes only with `generate`, and is shown as it came.
  assert.ok(
    text().includes("We've kept today a little lighter than usual"),
    "the server's gentle sentence is on screen",
  );

  await click(button("Why this plan?"));
  await waitFor(() => text().includes("Written by the guide"), { timeout: 8000 });
  assert.ok(text().includes("Today opens by asking you to revise Chemical Bonding"), "the summary");
  assert.ok(requested.includes("POST /api/my/plan/explain/"));
  await act(async () => root.unmount());
});

test("an explanation the guide could not write is shown quietly, not as an error", async () => {
  signInOnboarded();
  server.use(
    http.post("/api/my/plan/explain/", () =>
      HttpResponse.json({
        date: "2026-10-24",
        summary: "Today's plan has 4 blocks, 165 minutes in all. First, revise Chemical Bonding.",
        available: false,
        from_cache: false,
      }),
    ),
  );
  const root = await renderAt("/");
  await waitFor(() => text().includes("Make today's plan"));
  await click(button("Make today's plan"));
  await waitFor(() => planCheckboxes().length > 0, { timeout: 8000 });
  await click(button("Why this plan?"));
  await waitFor(() => text().includes("Today's plan has 4 blocks, 165 minutes in all."));
  assert.ok(text().includes("A short summary put together from the reasons"), "says what it is");
  assert.ok(!text().includes("Written by the guide"), "and does not claim the guide wrote it");
  assert.equal(document.querySelector("[role='alert']"), null, "no error state");
  await act(async () => root.unmount());
});

/* ------------------------------------------------------------------ *
 * Log study
 * ------------------------------------------------------------------ */

test("logging study shows the server's field errors, then logs and lists the session", async () => {
  signInOnboarded();
  const kinematics = JEE_CHAPTERS.find((c) => c.name === "Kinematics")!;
  const root = await renderAt("/log");
  await waitFor(() => document.querySelector(`input[data-chapter-id='${kinematics.id}']`) !== null);

  // The search narrows the list to what matches.
  const search = document.querySelector<HTMLInputElement>("input[type='search']")!;
  await typeInto(search, "kinem");
  assert.equal(document.querySelectorAll("input[data-chapter-id]").length, 1, "only Kinematics matches");

  await click(document.querySelector(`input[data-chapter-id='${kinematics.id}']`)!);
  await waitFor(() => text().includes("Chosen: Kinematics"));
  await typeInto("log-minutes", "800");
  await click(document.querySelector("input[name='log-mode'][value='revise']")!);
  await click(button("Log 13 h 20 min"));

  // The server's refusal, under its own field, in its own words.
  await waitFor(() => (document.getElementById("log-minutes-errors")?.textContent ?? "").includes(
    "Ensure this value is less than or equal to 720.",
  ));
  assert.equal(worldFor(AARAV).logs.some((l) => l.topic === kinematics.id && l.minutes === 800), false);

  await typeInto("log-minutes", "45");
  const before = worldFor(AARAV).logs.length;
  await click(button("Log 45 min"));
  await waitFor(() => text().includes("Logged 45 min of Kinematics."), { timeout: 8000 });
  const world = worldFor(AARAV);
  assert.equal(world.logs.length, before + 1, "one session was written");
  assert.equal(world.logs[0].topic, kinematics.id);
  assert.equal(world.logs[0].mode, "revise");
  assert.equal(world.logs[0].minutes, 45);
  await waitFor(() => text().includes("Revise, 45 min"), { timeout: 8000 });
  await act(async () => root.unmount());
});

test("a chapter the server refuses is reported against the chapter picker", async () => {
  signInOnboarded();
  server.use(
    http.post("/api/my/study-logs/", () =>
      HttpResponse.json({ topic: ["That chapter is not part of your syllabus."] }, { status: 400 }),
    ),
  );
  const root = await renderAt("/log");
  await waitFor(() => document.querySelector("input[data-chapter-id]") !== null);
  await click(document.querySelector("input[data-chapter-id]")!);
  await click(button("30 min"));
  await click(button("Log 30 min"));
  await waitFor(() =>
    (document.getElementById("log-topic-errors")?.textContent ?? "").includes(
      "That chapter is not part of your syllabus.",
    ),
  );
  await act(async () => root.unmount());
});

/* ------------------------------------------------------------------ *
 * Revisions
 * ------------------------------------------------------------------ */

test("marking a revision done records it and says when the next one is", async () => {
  signInOnboarded();
  const root = await renderAt("/revisions");
  await waitFor(() => text().includes("3 revisions are waiting."));
  assert.ok(text().includes("Was due 3 days ago"), "overdue reads as a plain fact");
  assert.ok(!/overdue/i.test(text()), "and never as 'overdue'");

  const world = worldFor(AARAV);
  const target = world.revisions.find(
    (r) => r.topic.name === "Chemical Bonding and Molecular Structure" && r.cycle === 1,
  )!;
  await click(button("Mark Chemical Bonding and Molecular Structure, revision 1, done"));

  await waitFor(() => text().includes("Marked done."), { timeout: 8000 });
  assert.ok(target.done_at, "the server recorded it");
  assert.ok(
    text().includes("Revision 2 of Chemical Bonding and Molecular Structure is set for"),
    "the next cycle, scheduled by the server, is named",
  );
  await waitFor(() => text().includes("2 revisions are waiting."));
  assert.equal(
    document.querySelector(`[data-revision-id='${target.id}']`),
    null,
    "the done revision leaves the list",
  );
  await act(async () => root.unmount());
});

/* ------------------------------------------------------------------ *
 * Mistakes
 * ------------------------------------------------------------------ */

test("opening a mistake shows the question, my choice, the right answer and the working", async () => {
  signInOnboarded();
  let root = await renderAt("/mistakes");
  await waitFor(() => text().includes("Mock 15 — Diagnostic") && text().includes("AIT Mock 14"));

  // A paper imported as scores only has nothing to open, and says so.
  const noQuestion = document.querySelectorAll("li[data-question-pk='none']");
  assert.ok(noQuestion.length > 0, "rows without a question are listed");
  assert.ok(noQuestion[0].textContent?.includes("No question on file"));
  assert.equal(noQuestion[0].querySelector("a"), null, "and are not links");

  const open = document.querySelector<HTMLAnchorElement>("a[aria-label='Open D16, Hydrocarbons']");
  assert.ok(open, "D16 opens");
  await click(open!);
  await waitFor(() => text().includes("Nitration of toluene"), { timeout: 8000 });

  const page = text();
  assert.ok(page.includes("You chose (C). The right answer is (B)."));
  const rows = Array.from(document.querySelectorAll("ol[aria-label='Options'] li"));
  const rowFor = (needle: string) => rows.find((li) => li.textContent?.includes(needle))!;
  const right = rowFor("o- and p-nitrotoluene");
  const mine = rowFor("m-nitrotoluene");
  assert.ok(right.textContent?.includes("Right answer"));
  assert.ok(right.querySelector("[data-ringed]") !== null, "the right answer is circled");
  assert.ok(mine.textContent?.includes("Your answer"));
  assert.ok(mine.querySelector("[data-filled]") !== null, "my choice is filled in");
  assert.ok(!page.includes("MIS-"), "no misconception code reaches a student");

  const working = document.querySelector("details");
  assert.ok(working, "the working is there");
  assert.equal(working!.hasAttribute("open"), false, "folded, so the student can try again first");
  assert.ok(working!.textContent?.includes("hyperconjugation"));
  await act(async () => root.unmount());

  // Maths in a stem is typeset.
  root = await renderAt("/mistakes/961");
  await waitFor(() => text().includes("Two point charges"), { timeout: 8000 });
  assert.ok(document.querySelector(".katex"), "TeX is rendered by KaTeX");
  await act(async () => root.unmount());

  // A question this student never answered does not open.
  root = await renderAt("/mistakes/999");
  await waitFor(() => text().includes("This question can’t be opened."), { timeout: 8000 });
  assert.ok(requested.includes("GET /api/my/questions/999/"), "the server was asked, and said no");
  await act(async () => root.unmount());
});

/* ------------------------------------------------------------------ *
 * Guide
 * ------------------------------------------------------------------ */

test("the guide shows the findings it is given, exactly those, and asks for no diagnosis", async () => {
  signInOnboarded();
  server.use(
    http.get("/api/my/guidance/", () =>
      HttpResponse.json({
        next_actions: [
          { kind: "revisions_due", title: "Revise Equilibrium", detail: "Revision 2 was due yesterday.", target: "revisions" },
        ],
        findings: [
          {
            paper_id: 17,
            paper_name: "Mock 15 — Diagnostic",
            title: "One rule about where the next group goes",
            explanation: "On D16 and D17 you sent the new group to the wrong place.",
            what_to_do: "Redo D16 without looking at your old answer.",
            questions: [
              { question_pk: 923, label: "D16" },
              { question_pk: 924, label: "D17" },
            ],
            approved_at: "2026-10-22T11:30:00Z",
            reworded: true,
          },
        ],
      }),
    ),
  );
  let root = await renderAt("/guide");
  await waitFor(() => text().includes("One rule about where the next group goes"));

  assert.equal(document.querySelectorAll("[data-finding-paper]").length, 1, "one finding, as returned");
  assert.ok(text().includes("Redo D16 without looking at your old answer."), "what to do");
  assert.ok(text().includes("agreed by your teacher"));
  assert.ok(document.querySelector("a[href='/mistakes/923']"), "D16 opens its question");
  assert.ok(document.querySelector("a[href='/mistakes/924']"), "D17 too");
  // The fixture's own finding is not invented in on top of what the server said.
  assert.ok(!text().includes("Which way a group on the ring sends the next one"));
  const action = Array.from(document.querySelectorAll("main a")).find((a) =>
    a.textContent?.includes("Revise Equilibrium"),
  );
  assert.equal(action?.getAttribute("href"), "/revisions", "a next action leads to its screen");
  assert.ok(!requested.some((r) => r.includes("diagnosis")), "the console's diagnosis is never asked");
  await act(async () => root.unmount());

  // None yet: said kindly, with what has to happen first.
  server.use(http.get("/api/my/guidance/", () => HttpResponse.json({ next_actions: [], findings: [] })));
  queryClient.clear();
  root = await renderAt("/guide");
  await waitFor(() => text().includes("it appears here once they agree with it"));
  assert.equal(document.querySelectorAll("[data-finding-paper]").length, 0);
  await act(async () => root.unmount());
});

test("the ask box answers, and words a 503 and a 429 for the student", async () => {
  signInOnboarded();
  const root = await renderAt("/guide");
  await waitFor(() => document.getElementById("guide-question") !== null);
  assert.ok(text().includes("doesn't solve exam questions"), "says up front what it won't do");

  await typeInto("guide-question", "What should I focus on this week?");
  await click(button("Ask the guide"));
  await waitFor(() => text().includes("The guide says"), { timeout: 8000 });
  assert.ok(text().includes("Start with the"), "an answer from the student's own data");

  // 503: the server's sentence, shown as it is.
  setGuideOffline(true);
  await typeInto("guide-question", "Which revision should I do first?");
  await click(button("Ask the guide"));
  await waitFor(() => text().includes("The guide can't answer right now — it's busy or offline."), { timeout: 8000 });
  assert.ok(!text().includes("503"), "no status code");
  assert.ok(text().includes("Your plan, revisions and results all still work"));

  // 429: the day's questions are used up — said kindly, not as DRF says it.
  setGuideOffline(false);
  server.use(
    http.post("/api/my/guidance/ask/", () =>
      HttpResponse.json({ detail: "Request was throttled. Expected available in 41760 seconds." }, { status: 429 }),
    ),
  );
  await typeInto("guide-question", "How should I split my time?");
  await click(button("Ask the guide"));
  await waitFor(() => text().includes("That's all the questions the guide can take today."), { timeout: 8000 });
  assert.ok(!text().includes("Request was throttled"), "the throttle's own wording stays out");
  await act(async () => root.unmount());
});

/* ------------------------------------------------------------------ *
 * The student app, as a whole
 * ------------------------------------------------------------------ */

test("a student never sees the console, not even at a console address", async () => {
  signInOnboarded();
  let root = await renderAt("/students/1");
  await waitFor(() => text().includes("This page isn't part of your app."));
  let body = text();
  for (const console of ["Director console", "Student 360", "How it works", "Data & trust"]) {
    assert.ok(!body.includes(console), `no "${console}"`);
  }
  await act(async () => root.unmount());

  root = await renderAt("/");
  await waitFor(() => text().includes("Make today's plan"));
  body = text();
  assert.ok(!body.includes("Director console"));
  const hrefs = new Set(
    Array.from(document.querySelectorAll("nav[aria-label='Primary'] a")).map((a) => a.getAttribute("href")),
  );
  assert.deepEqual([...hrefs].sort(), ["/", "/guide", "/log", "/progress", "/revisions"]);
  assert.ok(
    !requested.some((r) => /\/api\/(students|dashboard|flags|batches|papers|questions)\b/.test(r)),
    `no console route was asked: ${requested.filter((r) => !r.includes("/api/my/")).join(", ")}`,
  );
  assert.ok(!/risk|critical|severity/i.test(body), "no risk, flag or severity words");
  await act(async () => root.unmount());
});

test("a roll number signs in as that student, through the first-sign-in gate", async () => {
  // Start signed out: the fixture session opens signed in as the mentor.
  await fetch("/api/auth/logout/", { method: "POST" });
  const again = await renderAt("/");
  await waitFor(() => document.getElementById("username") !== null);
  assert.ok(text().includes("A-1041"), "the demo hint names a student roll number");
  await typeInto("username", "N-5012");
  await typeInto("password", "demo12345");
  await click(button("Sign in"));
  // A first sign-in is on the temporary password, so the gate comes first…
  await waitFor(() => text().includes("Choose your own password"), { timeout: 8000 });
  await typeInto("current-password", "demo12345");
  await typeInto("new-password", "a-much-better-one");
  await typeInto("confirm-password", "a-much-better-one");
  await click(button("Save and continue"));
  // …then the student app, for the NEET student the roll number names.
  await waitFor(() => text().includes("NEET (UG)") && text().includes("Neev"), { timeout: 8000 });
  assert.ok(!text().includes("Director console"));
  await act(async () => again.unmount());
});

test("progress draws every subject the exam has — four for NEET — and never a null as zero", async () => {
  signInOnboarded(DIYA);
  const root = await renderAt("/progress");
  await waitFor(
    () =>
      document.querySelectorAll("[data-subject]").length >= 8 &&
      text().includes("You scored 533 of 720.") &&
      document.querySelector("[data-topic-id]") !== null,
    { timeout: 10000 },
  );

  const strips = Array.from(document.querySelectorAll("li[data-subject]")).map((li) => li.getAttribute("data-subject"));
  for (const subject of ["Physics", "Chemistry", "Botany", "Zoology"]) {
    assert.equal(strips.filter((s) => s === subject).length, 2, `${subject} in the scores and the balance`);
  }
  assert.ok(!strips.includes("Maths"), "no subject the exam does not have");

  // A chapter never answered says so; it gets no meter and no 0%.
  const unseen = Array.from(document.querySelectorAll("li[data-topic-id]")).find((li) =>
    li.textContent?.includes("Electronic Devices"),
  )!;
  assert.ok(unseen.textContent?.includes("No answers yet"));
  assert.equal(unseen.querySelector("[role='meter']"), null);
  assert.ok(!unseen.textContent?.includes("0%"));

  // A measured chapter does get one, and its NCERT chapter is linked.
  const measured = Array.from(document.querySelectorAll("li[data-topic-id]")).find((li) =>
    li.textContent?.includes("Current Electricity"),
  )!;
  assert.equal(measured.querySelector("[role='meter']")?.getAttribute("aria-valuenow"), "31");
  assert.ok(measured.querySelector("a[href^='https://ncert.nic.in/']"), "Read in NCERT");
  await act(async () => root.unmount());
});
