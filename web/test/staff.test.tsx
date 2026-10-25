// The DOM is installed by `scripts/run-tests.mjs` via `node --import`, before
// this module — or any of React's or Radix's — is evaluated.
import assert from "node:assert/strict";
import test, { after, afterEach, before } from "node:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import App, { queryClient } from "../src/App";
import type { MockScore, SubjectBreakdown } from "../src/api/types";
import { MockTrendChart } from "../src/components/charts/MockTrendChart";
import { NeglectChart } from "../src/components/charts/NeglectChart";
import { dashboardSummary } from "../src/mocks/fixtures/dashboard";
import { questionsOf } from "../src/mocks/fixtures/staff/papers";
import { importResults } from "../src/mocks/fixtures/staff/uploads";
import { handlers, signInDemoUser } from "../src/mocks/handlers";
import { resetStaffMocks } from "../src/mocks/staffHandlers";
import { text, waitFor } from "./dom";

/**
 * The console's staff tools: logins, a student's own activity, papers and their
 * uploads, tagging, and the answer-key review — against the mock server, which
 * reproduces each route's documented answers (and refusals).
 */

const server = setupServer(...handlers);
/** Every request, as `METHOD path?query`, so a test can say which route a screen used. */
const requested: string[] = [];

before(() => {
  server.listen({ onUnhandledRequest: "error" });
  server.events.on("request:start", ({ request }) => {
    const url = new URL(request.url);
    requested.push(`${request.method} ${url.pathname}${url.search}`);
  });
});
afterEach(() => {
  server.resetHandlers();
  signInDemoUser();
  resetStaffMocks();
  requested.length = 0;
  queryClient.clear();
});
after(() => server.close());

/* ------------------------------------------------------------------ *
 * Helpers, in the style of auth.test.tsx
 * ------------------------------------------------------------------ */

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

/** Set a controlled field the way a browser does, so React's onChange fires. */
function typeInto(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    element instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  return act(async () => {
    set.call(element, value);
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

function selectValue(element: HTMLSelectElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
  return act(async () => {
    set.call(element, value);
    element.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}

/** Hand a file to a file input, as picking one in the dialog does. */
function chooseFile(contents: string, name: string) {
  const input = document.querySelector<HTMLInputElement>("input[type='file']");
  assert.ok(input, "a file input is on screen");
  const file = new File([contents], name, { type: "text/csv" });
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  return act(async () => {
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}

function button(match: string | RegExp, scope: ParentNode = document): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll("button")).find((b) => {
    const label = b.getAttribute("aria-label") ?? b.textContent?.trim() ?? "";
    return typeof match === "string"
      ? label === match || b.textContent?.trim() === match
      : match.test(label) || match.test(b.textContent ?? "");
  });
  assert.ok(found, `a button matching ${String(match)}`);
  return found as HTMLButtonElement;
}

function dialog(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[role="dialog"]');
  assert.ok(el, "a dialog is open");
  return el!;
}

const within = (selector: string) => document.querySelector<HTMLElement>(selector);

/* ------------------------------------------------------------------ *
 * Feature 3 — student logins
 * ------------------------------------------------------------------ */

test("issuing a login shows the password once, and closing the dialog forgets it", async () => {
  const root = await renderAt("/");
  await waitFor(() => within("[data-student-id='1']") !== null);
  const row = within("[data-student-id='1']")!;
  assert.ok(row.textContent?.includes("No login yet"), "Aarav starts with no login");

  await click(button("Issue login for Aarav Mehta", row));
  await waitFor(() => (document.querySelector('[role="dialog"]')?.textContent ?? "").includes("Issue a login for Aarav Mehta"));
  await click(button("Issue login", dialog()));

  await waitFor(() => document.querySelector("[data-temporary-password]") !== null);
  const password = document.querySelector("[data-temporary-password]")!.textContent ?? "";
  assert.match(password, /^\S{8,}$/, "a temporary password is shown");
  const slip = dialog().textContent ?? "";
  assert.ok(slip.includes("AC-27-0114"), "with the roll number the student signs in with");
  assert.ok(slip.includes("won’t be shown again"), "and says it won't be shown again");
  assert.ok(button("Copy", dialog()), "with a copy button");

  // Nowhere it could be read back: not the query cache, not the mutation
  // cache, not browser storage.
  const cached = JSON.stringify([
    queryClient.getQueryCache().getAll().map((q) => q.state.data),
    queryClient.getMutationCache().getAll().map((m) => m.state.data),
  ]);
  assert.ok(!cached.includes(password), "not in the query or mutation cache");
  for (const store of [window.localStorage, window.sessionStorage]) {
    for (let i = 0; i < store.length; i++) {
      assert.ok(!(store.getItem(store.key(i)!) ?? "").includes(password), "not in storage");
    }
  }

  await click(button("Done", dialog()));
  await waitFor(() => document.querySelector('[role="dialog"]') === null);
  assert.ok(!text().includes(password), "gone from the page once the dialog closes");
  assert.equal(document.querySelector("[data-temporary-password]"), null);

  // The roster moved on: the login is issued and waiting for its first use.
  await waitFor(
    () => within("[data-student-id='1'] [data-login-status='awaiting_first_sign_in']") !== null,
  );
  assert.ok(button("Reset password for Aarav Mehta"), "and now offers a reset instead");

  await act(async () => root.unmount());
});

test("a login refused with 409 or 403 is said in plain words, with no password", async () => {
  // 409: someone issued it a moment ago, after this page loaded.
  server.use(
    http.post("/api/students/:id/account/", () =>
      HttpResponse.json(
        { detail: "This student already has a login. To give them a new temporary password, reset it." },
        { status: 409 },
      ),
    ),
  );
  let root = await renderAt("/students/1");
  await waitFor(() => text().includes("Student app login"));
  await click(button("Issue login for Aarav Mehta"));
  await click(button("Issue login", dialog()));
  await waitFor(() => dialog().textContent?.includes("Aarav Mehta already has a login.") ?? false);
  assert.ok(dialog().textContent?.includes("use Reset password instead"), "and what to do instead");
  assert.equal(document.querySelector("[data-temporary-password]"), null, "no password shown");
  assert.ok(
    !Array.from(dialog().querySelectorAll("button")).some((b) => b.textContent?.includes("Try again")),
    "a 409 does not offer the same request again",
  );
  await act(async () => root.unmount());
  server.resetHandlers();
  queryClient.clear();

  // 403, from the mock's own rule: Ishita is Prof. Nagarajan's student, not the
  // signed-in mentor's.
  root = await renderAt("/students/2");
  await waitFor(() => text().includes("Student app login"));
  await click(button("Issue login for Ishita Rao"));
  await click(button("Issue login", dialog()));
  await waitFor(() => dialog().textContent?.includes("Ishita Rao is not one of your students.") ?? false);
  assert.ok(dialog().textContent?.includes("Prof. R. Nagarajan"), "names who can");
  await act(async () => root.unmount());
});

/* ------------------------------------------------------------------ *
 * Student 360
 * ------------------------------------------------------------------ */

test("the day plan is the student's own, read by student id — not /api/my/plan/", async () => {
  const root = await renderAt("/students/1");
  await waitFor(() => text().includes("Aarav’s plan today"));
  assert.ok(text().includes("Coordination Compounds"), "the plan's blocks are shown");

  const plan = requested.filter((r) => r.startsWith("GET /api/students/1/plan/"));
  assert.ok(plan.length >= 1, "asked the mentor route");
  assert.match(plan[0], /\?date=\d{4}-\d{2}-\d{2}$/, "for a day");
  assert.ok(!requested.some((r) => r.includes("/api/my/plan/")), "never the student's own route");

  // The compact panels read the same student's routes.
  await waitFor(() => text().includes("Onboarding answers") && text().includes("Fading chapters"));
  for (const route of ["study-logs/", "confidence/", "revisions/?pending=true", "topic-states/?forgetting=true"]) {
    assert.ok(
      requested.some((r) => r === `GET /api/students/1/${route}`),
      `asked GET /api/students/1/${route}`,
    );
  }
  assert.ok(text().includes("Not set yet"), "an unanswered onboarding is 'not set yet', not 0");
  await act(async () => root.unmount());
});

/* ------------------------------------------------------------------ *
 * Feature 3 / 11 — the paper's blueprint and results
 * ------------------------------------------------------------------ */

test("a blueprint is checked, every refused row listed at once, then imported", async () => {
  const root = await renderAt("/papers/31?tab=blueprint");
  await waitFor(() => text().includes("Blueprint file"));

  await chooseFile(
    [
      "question_id,chapter,correct_option",
      "Q1,Kinematics,A",
      "Q2,Rotational Dynamics,B",
      "Q3,Electrostatics,E",
      ",Gravitation,C",
    ].join("\n"),
    "mock16-blueprint.csv",
  );
  await click(button("Check file"));
  await waitFor(() => text().includes("This file would be refused: 3 problems."));
  const rows = Array.from(document.querySelectorAll("[data-error-row]")).map((tr) =>
    tr.getAttribute("data-error-row"),
  );
  assert.deepEqual(rows, ["3", "4", "5"], "every problem at once, by line");
  assert.ok(text().includes("is not a chapter of your JEE Main syllabus"), "in the server's words");
  assert.equal(button("Import").disabled, true, "nothing to import from a refused file");
  assert.equal(questionsOf(31).length, 20, "and nothing was written");

  await chooseFile(
    ["question_id,chapter,correct_option", "Q1,Kinematics,A", "Q2,Gravitation,2", "Q21,Ray Optics,D"].join("\n"),
    "mock16-blueprint-fixed.csv",
  );
  await click(button("Check file"));
  await waitFor(() => text().includes("This file is ready to import."));
  assert.equal(questionsOf(31).length, 20, "a check writes nothing");
  assert.equal(button("Import").disabled, false);

  await click(button("Import"));
  await waitFor(() => text().includes("Imported. 3 questions applied."));
  assert.equal(questionsOf(31).length, 21, "the new question is on the paper");
  assert.ok(requested.filter((r) => r === "POST /api/papers/31/blueprint/").length === 3);
  await act(async () => root.unmount());
});

test("a results file is checked, its bad rows listed by line and roll number, then imported", async () => {
  const root = await renderAt("/papers/31?tab=results");
  await waitFor(() => text().includes("Results file"));

  await chooseFile(
    [
      "roll_no,Q1,Q2,Q3",
      "AC-27-0114,A,B,C",
      "AC-27-0231,B,B,X",
      "AC-99-0001,A,A,A",
      "AC-27-0158,C,,D",
    ].join("\n"),
    "mock16-results.csv",
  );
  await click(button("Check file"));
  await waitFor(() => text().includes("Ready to import: 2 students"));

  const errors = Array.from(document.querySelectorAll("[data-error-row]")).map(
    (tr) => tr.textContent ?? "",
  );
  assert.equal(errors.length, 2, "both bad rows");
  assert.match(errors[0], /^3AC-27-0231.*not an option/, "line 3, its roll number, and why");
  assert.match(errors[1], /^4AC-99-0001.*No student with roll number/, "line 4 likewise");
  assert.ok(text().includes("Students in the file"), "students counted");
  assert.ok(text().includes("this file does not mention"), "the paper's other questions are a warning");

  await click(button("Import"));
  await waitFor(() => text().includes("Imported: 2 students, 5 answers."));

  // …and the receipt is in the upload history.
  const history = Array.from(document.querySelectorAll("a")).find(
    (a) => a.textContent?.trim() === "Upload history",
  );
  assert.ok(history, "the history is one link away");
  await click(history!);
  await waitFor(() => document.querySelector("[data-batch-id]") !== null);
  assert.ok(within("[data-batch-id]")!.textContent?.includes("mock16-results.csv"));
  await act(async () => root.unmount());
});

test("the same file twice is a duplicate — on the check, and as a 409 on import", async () => {
  // A file whose roll-number column is the scanner's own name for it.
  const csv = ["Candidate No,Seat,Q1,Q2", "AC-27-0114,12,A,B", "AC-27-0158,14,C,D"].join("\n");
  const root = await renderAt("/papers/31?tab=results");
  await waitFor(() => text().includes("Results file"));

  // Without a mapping the server cannot find the roll numbers.
  await chooseFile(csv, "scanner.csv");
  await click(button("Check file"));
  await waitFor(() => text().includes("No roll number column"));

  // With the saved scanner mapping it can.
  await waitFor(() => text().includes("OMR scanner export"));
  await selectValue(document.querySelector<HTMLSelectElement>("select")!, "1");
  await click(button("Check file"));
  await waitFor(() => text().includes("Ready to import: 2 students"));
  assert.ok(
    requested.filter((r) => r === "POST /api/ingest/results/").length >= 2,
    "both checks went to the server",
  );

  // Someone else imports the very same file in the meantime…
  const other = await importResults({
    paperId: 31,
    file: new File([csv], "scanner.csv"),
    dryRun: false,
    mappingProfile: 1,
  });
  assert.equal(other.status, 201);

  // …so this import is the second copy: 409, with the batch it duplicates.
  await click(button("Import"));
  await waitFor(() => text().includes("This exact file was already imported."));
  assert.ok(text().includes("students ingested"), "the server's sentence");
  const link = Array.from(document.querySelectorAll("a")).find((a) =>
    a.textContent?.includes("See upload #1"),
  );
  assert.ok(link, "and a way to the batch it repeats");
  assert.match(link!.getAttribute("href") ?? "", /tab=history&batch=1$/);

  // Checked again, the file is flagged before anyone tries to import it.
  await chooseFile(csv, "scanner.csv");
  await click(button("Check file"));
  await waitFor(() => text().includes("Importing it again would change nothing."));
  assert.equal(button("Import").disabled, true, "a duplicate cannot be imported");
  await act(async () => root.unmount());
});

/* ------------------------------------------------------------------ *
 * Feature 11 — questions and tagging
 * ------------------------------------------------------------------ */

test("a wrong option is tagged from the taxonomy; the correct one cannot be", async () => {
  const root = await renderAt("/papers/17?tab=questions");
  await waitFor(() => within("[data-question='D01']") !== null);
  assert.ok(text().includes("63 of 138"), "the paper's tagging progress, from the server");

  await click(button("Edit D01"));
  await waitFor(() => within("[data-question='D01'] [data-option='B']") !== null);

  // The correct option says why it cannot be tagged, and offers no picker.
  const correct = within("[data-question='D01'] [data-option='C']")!;
  assert.ok(correct.textContent?.includes("can’t carry a misconception"));
  assert.equal(
    correct.querySelector("button[aria-label^='Choose a misconception']"),
    null,
    "no way to tag the correct option",
  );

  // Option B is wrong and untagged: pick a belief from Physics' taxonomy.
  await click(button("Choose a misconception for option B of D01"));
  await waitFor(() => text().includes("Search Physics misconceptions for option B"));
  // The picker's own list (option D already carries "Wrong body's formula", so
  // the name alone would be found before the list has loaded).
  const optionB = () => within("[data-question='D01'] [data-option='B']")!.textContent ?? "";
  await waitFor(() => optionB().includes("Average and instantaneous treated as the same"));
  assert.ok(!optionB().includes("Directing effects reversed"), "only Physics is offered");
  const search = document.querySelector<HTMLInputElement>(
    "[data-option='B'] input[type='search']",
  )!;
  await typeInto(search, "body");
  await waitFor(() => !optionB().includes("Average and instantaneous treated as the same"));
  assert.ok(optionB().includes("MIS-ROT-SHAPE"), "the search keeps what matches");
  await click(button(/Wrong body's formula/, within("[data-question='D01'] [data-option='B']")!));
  await waitFor(() => optionB().includes("saved when you save"));
  assert.ok(optionB().includes("MIS-ROT-SHAPE"), "the pick is shown on the option");

  await click(button("Save D01"));
  await waitFor(() => text().includes("Saved D01."));
  const saved = questionsOf(17).find((q) => q.label === "D01")!;
  assert.equal(saved.options.find((o) => o.label === "B")?.misconception?.code, "MIS-ROT-SHAPE");
  assert.ok(
    requested.includes(`PATCH /api/papers/17/questions/${saved.id}/`),
    "one PATCH, to this question",
  );
  await act(async () => root.unmount());
});

test("a refused tag shows the server's reason beside the option it is about", async () => {
  server.use(
    http.patch("/api/papers/:id/questions/:question_pk/", () =>
      HttpResponse.json(
        {
          options: [
            {
              misconception_code: [
                "MIS-KIN-AVG is a Physics misconception; this is a Chemistry question.",
              ],
            },
          ],
        },
        { status: 400 },
      ),
    ),
  );
  const root = await renderAt("/papers/17?tab=questions");
  await waitFor(() => within("[data-question='D01']") !== null);
  await click(button("Edit D01"));
  await waitFor(() => within("[data-question='D01'] [data-option='A']") !== null);

  await click(button("Choose a misconception for option A of D01"));
  await waitFor(() => text().includes("Average and instantaneous treated as the same"));
  await click(button(/Average and instantaneous treated as the same/));
  await click(button("Save D01"));

  await waitFor(() => text().includes("Nothing was saved."));
  const optionA = within("[data-question='D01'] [data-option='A']")!;
  assert.ok(
    optionA.textContent?.includes("this is a Chemistry question"),
    "the error sits under option A, the one it was about",
  );
  assert.ok(
    !within("[data-question='D01'] [data-option='B']")!.textContent?.includes("Chemistry question"),
    "and nowhere else",
  );
  await act(async () => root.unmount());
});

/* ------------------------------------------------------------------ *
 * Feature 6 — answer-key review
 * ------------------------------------------------------------------ */

test("a review decision is recorded, explained, and moves the question out of the queue", async () => {
  const root = await renderAt("/review");
  await waitFor(() => within("[data-disagreement='1030']") !== null);
  assert.ok(text().includes("5 questions where the AI's answer differs from the official key."));
  for (const meaning of [
    "The published answer is right",
    "The answer as stored is wrong",
    "It needs a subject expert",
  ]) {
    assert.ok(text().includes(meaning), `explains: ${meaning}`);
  }

  const card = within("[data-disagreement='1030']")!;
  assert.ok(card.textContent?.includes("Official key"), "the official answer is marked");
  assert.ok(card.textContent?.includes("The AI’s answer"), "and the AI's");
  assert.equal(button("Record decision", card).disabled, true, "nothing to record yet");

  await click(card.querySelector("input[value='key_stands']")!);
  await typeInto(card.querySelector("textarea")!, "NCERT normal adjustment gives 125.");
  await click(button("Record decision", card));

  await waitFor(() => text().includes("Recorded for Q2"));
  await waitFor(() => within("[data-disagreement='1030']") === null);
  assert.ok(text().includes("4 questions where"), "one fewer waiting");

  await click(button("Reviewed"));
  await waitFor(() => within("[data-disagreement='1030']") !== null);
  const decided = within("[data-disagreement='1030']")!.textContent ?? "";
  assert.ok(decided.includes("Official key stands, by aarambh.bhatia"), "who decided, and what");
  await act(async () => root.unmount());
});

/* ------------------------------------------------------------------ *
 * Feature 4 — the nightly refresh, visible
 * ------------------------------------------------------------------ */

test("the console says when its data was last refreshed, and 'never' when it was not", async () => {
  let root = await renderAt("/");
  await waitFor(() => document.querySelector("[data-refreshed]") !== null);
  assert.match(
    document.querySelector("[data-refreshed]")!.textContent ?? "",
    /^Data refreshed today at 2:00\s?am$/i,
  );
  await act(async () => root.unmount());
  queryClient.clear();

  server.use(
    http.get("/api/dashboard/summary/", () =>
      HttpResponse.json({ ...dashboardSummary(), last_refreshed_at: null }),
    ),
  );
  root = await renderAt("/");
  await waitFor(() => document.querySelector("[data-refreshed]") !== null);
  assert.match(document.querySelector("[data-refreshed]")!.textContent ?? "", /Data refreshed: never/);
  await act(async () => root.unmount());
});

/* ------------------------------------------------------------------ *
 * Feature 5 — NEET's four subjects
 * ------------------------------------------------------------------ */

const NEET = ["Physics", "Chemistry", "Botany", "Zoology"];

function neetRow(id: number, marks: [number, number, number, number]): MockScore {
  return {
    paper_id: id,
    paper_name: `NEET Mock ${id}`,
    held_on: `2026-0${id}-10`,
    physics: marks[0],
    chemistry: marks[1],
    maths: 0,
    total: marks.reduce((a, b) => a + b, 0),
    subjects: NEET.map((subject, i) => ({ subject, marks: marks[i] })),
  };
}

test("a four-subject NEET series is charted as four series, in the order given", async () => {
  const rows = [
    neetRow(1, [96, 120, 150, 138]),
    neetRow(2, [104, 112, 160, 142]),
    neetRow(3, [-8, 118, 172, 150]),
  ];
  const breakdown: SubjectBreakdown[] = NEET.map((subject, i) => ({
    subject,
    time_share_pct: [30, 20, 25, 25][i],
    marks_lost_share_pct: [45, 25, 15, 15][i],
    accuracy_pct: [52, 61, null, 70][i],
  }));

  document.body.innerHTML = "<div id='root'></div>";
  const root = createRoot(document.getElementById("root")!);
  await act(async () => {
    root.render(
      <>
        <MockTrendChart rows={rows} />
        <NeglectChart rows={breakdown} />
      </>,
    );
  });
  await waitFor(() => document.querySelector("[data-slot='chart'] svg") !== null);

  const lines = Array.from(document.querySelectorAll("svg path[stroke-width='2']"));
  assert.equal(lines.length, 4, "one line per subject");
  // The subject past the three validated hues is grey and dashed — keyed as a
  // dashed swatch — so it is never told apart from the others by colour alone.
  const swatch = (label: string) =>
    Array.from(document.querySelectorAll("li"))
      .find((li) => li.textContent?.startsWith(label))
      ?.querySelector<HTMLElement>("span[aria-hidden]")?.style.background ?? "";
  assert.match(swatch("Zoology"), /repeating-linear-gradient/, "Zoology is keyed dashed");
  assert.doesNotMatch(swatch("Botany"), /repeating-linear-gradient/, "Botany has a hue of its own");
  assert.doesNotMatch(swatch("Physics"), /repeating-linear-gradient/);

  const body = text();
  assert.ok(body.includes("Physics, Chemistry, Botany and Zoology across 3 mocks"), "named in order");
  // NEET subjects are out of 180, and negative marking can go below zero.
  const ticks = Array.from(
    document.querySelectorAll(".recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value"),
  ).map((t) => t.textContent);
  assert.equal(ticks[0], "-50", "the axis reaches below zero for a negative subject total");
  assert.equal(ticks.at(-1), "200", "and above NEET's 180");
  const spoken = Array.from(document.querySelectorAll("svg rect[data-mock][role='img']")).map((r) =>
    r.getAttribute("aria-label"),
  );
  assert.equal(
    spoken[2],
    "NEET Mock 3: Physics -8, Chemistry 118, Botany 172, Zoology 150, total 432",
    "each mock spoken with every subject",
  );

  // The neglect chart: four rows, two labels each, an honest null accuracy.
  assert.equal(document.querySelectorAll("[data-label-placement]").length, 8, "four subject rows");
  assert.ok(body.includes("Botany") && body.includes("Zoology"));
  assert.ok(body.includes("— accuracy"), "a null accuracy is a dash, never 0%");

  await act(async () => root.unmount());
});
