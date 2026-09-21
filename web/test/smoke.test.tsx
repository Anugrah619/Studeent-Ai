// The DOM is installed by `scripts/run-tests.mjs` via `node --import`, before
// this module — or any of React's or Radix's — is evaluated.
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setupServer } from "msw/node";
import App from "../src/App";
import { handlers } from "../src/mocks/handlers";
import { text, waitFor } from "./dom";

const server = setupServer(...handlers);

before(() => server.listen({ onUnhandledRequest: "error" }));
after(() => server.close());

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

function buttons(scope: ParentNode = document): HTMLButtonElement[] {
  return Array.from(scope.querySelectorAll("button"));
}

test("director console renders the KPI strip and the triage table", async () => {
  const root = await renderAt("/");
  await waitFor(() => text().includes("Aarav Mehta"));

  const body = text();
  assert.ok(body.includes("Director console"), "page heading");
  assert.ok(body.includes("Students flagged this week"), "hero tile");
  assert.ok(body.includes("Students who need you this week"), "triage heading");

  // The six names from the concept note's triage list.
  for (const name of [
    "Aarav Mehta",
    "Ishita Rao",
    "Md. Faizan Ali",
    "Kunal Deshpande",
    "Tanvi Shah",
    "Priya Nair",
  ]) {
    assert.ok(body.includes(name), `triage row for ${name}`);
  }

  // Severity is never colour alone — the word is in the DOM.
  for (const word of ["Critical", "Watch", "Improving"]) {
    assert.ok(body.includes(word), `${word} label present`);
  }

  const firstRow = document.querySelector("tbody tr")?.textContent ?? "";
  assert.match(firstRow, /Critical/, `worst severity first, got: ${firstRow}`);
  assert.ok(body.includes("Recently closed"), "closed-loop panel");

  await act(async () => root.unmount());
});

test("student 360 renders the header, both charts and the mastery grid", async () => {
  const root = await renderAt("/students/1");
  // Six independent queries land in whatever order the mock latency gives them.
  await waitFor(() =>
    ["Where the time goes", "Mock score trend", "Topic mastery", "Open flags"].every(
      (needle) => text().includes(needle),
    ),
  );

  const body = text();
  assert.ok(body.includes("Aarav Mehta"), "student name");
  assert.ok(body.includes("Alpha"), "batch");
  assert.ok(body.includes("Dr. S. Bhatia"), "mentor");
  assert.ok(body.includes("Mock score trend"), "trend figure");
  assert.ok(body.includes("Topic mastery"), "mastery grid");
  assert.ok(body.includes("Coordination Compounds"), "a real chapter name");

  // The trend chart took its real SVG branch.
  assert.equal(
    document.querySelectorAll("svg path[stroke-width='2']").length,
    3,
    "three subject series",
  );
  assert.equal(
    document.querySelectorAll("svg line[stroke='var(--chart-grid)']").length,
    5,
    "five hairline gridlines",
  );

  const bands = Array.from(document.querySelectorAll("svg rect[role='button']"));
  assert.equal(bands.length, 7, "one hit target per mock");
  assert.match(
    bands[6].getAttribute("aria-label") ?? "",
    /total 134$/,
    "last mock is spoken in full",
  );

  // The neglect chart's argument, in text.
  assert.match(body, /11%/, "chemistry time share");
  assert.match(body, /46%/, "chemistry marks-lost share");

  await act(async () => root.unmount());
});

test("mock intelligence renders the attribution and the recoverable line", async () => {
  const root = await renderAt("/students/1/mock/14");
  await waitFor(() => text().includes("Where the marks went"));

  const body = text();
  assert.ok(body.includes("AIT Mock 14"), "paper name");
  assert.ok(
    body.includes("Recoverable without learning anything new"),
    "hero label",
  );
  assert.ok(body.includes("98"), "recoverable marks");
  assert.ok(body.includes("166"), "total lost");

  for (const cause of [
    "Conceptual gap",
    "Execution error",
    "Time exhaustion",
    "Avoidable skip",
  ]) {
    assert.ok(body.includes(cause), `cause card: ${cause}`);
  }

  const segments = Array.from(
    document.querySelectorAll("button[aria-label*='marks,']"),
  );
  assert.equal(segments.length, 4, "four stacked segments");
  assert.match(
    segments[0].getAttribute("aria-label") ?? "",
    /^Conceptual gap: 68 marks/,
    "each segment speaks its own value",
  );

  await act(async () => root.unmount());
});

test("every chart offers a table view", async () => {
  const root = await renderAt("/students/1");
  await waitFor(() => text().includes("Mock score trend"));

  const toggles = buttons().filter((b) => b.textContent?.trim() === "Table");
  assert.ok(toggles.length >= 2, "a table toggle per figure");

  await click(toggles[0]);
  await waitFor(() => text().includes("AIT Mock 08"));
  assert.ok(text().includes("171"), "values reachable without the chart");

  await act(async () => root.unmount());
});

test("logging an intervention closes the flag and drops the row", async () => {
  const root = await renderAt("/");
  await waitFor(() => text().includes("Kunal Deshpande"));

  const before = document.querySelectorAll("tbody tr").length;
  assert.equal(before, 10, "ten open flags");

  const open = buttons().find((b) => b.textContent?.trim() === "Log intervention");
  assert.ok(open, "an intervene button exists");
  await click(open!);
  await waitFor(() => text().includes("What did you do?"));

  const dialog = document.querySelector('[role="dialog"]');
  assert.ok(dialog, "the dialog is in the DOM");
  assert.ok(
    dialog!.querySelector("#intervention-action"),
    "the action field is present",
  );

  const quick = buttons(dialog!).find(
    (b) => b.textContent?.trim() === "Called the parent",
  );
  await click(quick!);

  const submit = buttons(dialog!).find((b) =>
    b.textContent?.includes("Log intervention"),
  );
  assert.ok(submit && !submit.disabled, "submit is enabled once an action is set");
  await click(submit!);

  await waitFor(
    () => document.querySelectorAll("tbody tr").length === before - 1,
    { timeout: 8000 },
  );

  await act(async () => root.unmount());
});
