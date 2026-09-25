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

/* ------------------------------------------------------------------ *
 * The AI diagnosis card
 *
 * The one panel whose failure modes are load-bearing: 503 and 422 are as much
 * a part of the demo as the diagnosis itself, and `pattern_found: false` is an
 * answer rather than an empty state. Each gets its own assertion.
 * ------------------------------------------------------------------ */

function diagnosisCard(): string {
  const el = document.querySelector("section[aria-labelledby='diagnosis-eyebrow']");
  assert.ok(el, "the diagnosis card is on the page");
  return el!.textContent ?? "";
}

test("the diagnosis card leads with the headline and shows its evidence", async () => {
  const root = await renderAt("/students/1");
  await waitFor(() => diagnosisCard().includes("directing-effects"), {
    timeout: 8000,
  });

  const card = diagnosisCard();

  // The claim, in one sentence, at the top.
  assert.match(card, /one rule backwards/, "the headline is the hero");
  assert.ok(card.includes("AIT Mock 14"), "the paper being diagnosed");

  // The evidence is visible, not buried: code, confidence, question ids, marks.
  assert.ok(card.includes("MIS-ORG-EAS"), "misconception code");
  assert.ok(card.includes("High confidence"), "confidence is spoken, not colour");
  assert.ok(card.includes("Medium confidence"), "the weaker hypothesis too");
  for (const q of ["D1", "D2", "D3", "D4"]) {
    assert.ok(card.includes(q), `evidence question ${q}`);
  }
  assert.match(card, /20\s*marks at stake/, "marks at stake on the hypothesis");
  assert.match(
    card,
    /28 marks\s*at stake across 2 findings/,
    "the total is named as a total, not left to contradict the headline",
  );

  // The line the whole pitch rests on, at body size and with its own heading.
  assert.ok(
    card.includes("Why this is a trigger, not a topic gap"),
    "counter-evidence has its own block",
  );
  assert.ok(
    card.includes("he was correct both times"),
    "counter-evidence text is rendered",
  );

  assert.ok(card.includes("Do this week"), "recommended action");
  assert.ok(card.includes("one 40-minute sitting"), "time to fix");
  assert.ok(card.includes("rsn_"), "the trace id is on screen");

  await act(async () => root.unmount());
});

test("agreeing with a diagnosis records the verdict", async () => {
  const root = await renderAt("/students/2");
  await waitFor(() => diagnosisCard().includes("limiting reagent"), {
    timeout: 8000,
  });

  assert.ok(
    diagnosisCard().includes("Does this match what you see in class?"),
    "the question is asked before an answer exists",
  );
  assert.ok(
    diagnosisCard().includes("trains the system"),
    "the card says what the verdict does",
  );

  const agree = buttons().find((b) => b.textContent?.trim() === "Agree");
  assert.ok(agree, "an Agree button exists");
  await click(agree!);

  // The POST carries the CSRF header or the mock answers 403 — so reaching the
  // recorded state is also the assertion that the client sent it.
  await waitFor(() => diagnosisCard().includes("You agreed with this diagnosis"), {
    timeout: 8000,
  });

  await act(async () => root.unmount());
});

test("no systematic pattern renders as an answer, not an empty card", async () => {
  const root = await renderAt("/students/3");
  await waitFor(() => diagnosisCard().includes("No systematic pattern"), {
    timeout: 8000,
  });

  const card = diagnosisCard();
  assert.ok(card.includes("scattered carelessness"), "the honest reading");
  assert.ok(
    card.includes("invent a misconception"),
    "the card says why it is empty of hypotheses",
  );
  assert.ok(card.includes("Do this week"), "there is still an action");
  assert.ok(!card.includes("Rests on"), "no hypotheses are shown");

  await act(async () => root.unmount());
});

test("503 and 422 are told apart and neither reads as a crash", async () => {
  // 503 — the reasoning layer is not configured on this deployment.
  let root = await renderAt("/students/5");
  await waitFor(() => diagnosisCard().includes("reasoning layer"), {
    timeout: 8000,
  });
  let card = diagnosisCard();
  assert.ok(
    card.includes("The reasoning layer is not connected yet"),
    "503 explains itself",
  );
  assert.ok(
    card.includes("instead of a number it made up"),
    "503 is calm, not an error",
  );
  assert.ok(!card.includes("Could not load this panel"), "not the red error state");
  await act(async () => root.unmount());

  // 422 — it is connected, and honestly has too little to reason over.
  root = await renderAt("/students/4");
  await waitFor(() => diagnosisCard().includes("tagged evidence"), {
    timeout: 8000,
  });
  card = diagnosisCard();
  assert.ok(
    card.includes("Not enough tagged evidence on this paper"),
    "422 is its own state",
  );
  assert.ok(
    !card.includes("reasoning layer is not connected"),
    "422 does not borrow the 503 copy",
  );
  await act(async () => root.unmount());
});

test("neglect-chart value labels stay attached to short bars", async () => {
  const root = await renderAt("/students/1");
  await waitFor(() => text().includes("Where the time goes"));

  const labels = Array.from(
    document.querySelectorAll<HTMLElement>("[data-label-placement]"),
  );
  assert.equal(labels.length, 6, "two labels per subject row");

  const by = (value: string) =>
    labels.find((el) => el.textContent?.trim() === value);

  // Chemistry's 11% time share is the case that broke: at this width the bar
  // is too short to hold a number, so the label moves outside it.
  const chemTime = by("11%");
  assert.ok(chemTime, "the 11% label is rendered");
  assert.equal(
    chemTime!.getAttribute("data-label-placement"),
    "outside",
    "a short bar puts its label outside",
  );
  // And takes the ink for the surface it is now on, not the bar's.
  assert.equal(
    chemTime!.style.color,
    "var(--foreground)",
    "an outside label is inked for the card, not the fill",
  );

  // Its long neighbour keeps its label inside, in the ink verified for that
  // fill — which is the whole reason the flip has to exist.
  const chemLost = by("46%");
  assert.ok(chemLost, "the 46% label is rendered");
  assert.equal(chemLost!.getAttribute("data-label-placement"), "inside");
  assert.equal(chemLost!.style.color, "var(--subject-chemistry-ink)");

  // Whichever side it lands on, a label is a sibling of its own bar — never
  // parked at the column edge with white space between it and the mark.
  for (const label of labels) {
    const placement = label.getAttribute("data-label-placement");
    if (placement === "inside") {
      assert.ok(
        (label.parentElement?.style.width ?? "").endsWith("%"),
        "an inside label's parent is the bar itself",
      );
    } else {
      const siblings = Array.from(label.parentElement?.children ?? []);
      assert.equal(siblings.length, 2, "outside label sits next to its bar alone");
    }
  }

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
