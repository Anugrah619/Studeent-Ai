// The DOM is installed by `scripts/run-tests.mjs` via `node --import`, before
// this module — or any of React's or Radix's — is evaluated.
import assert from "node:assert/strict";
import test, { after, afterEach, before } from "node:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import App from "../src/App";
import {
  askedAboutStudent,
  chosenMisconception,
  chosenOption,
  correctOption,
  hasAttempt,
  parseQuestion,
} from "../src/api/questions";
import { handlers } from "../src/mocks/handlers";
import { questionFor } from "../src/mocks/fixtures/questions";
import { text, waitFor } from "./dom";

const server = setupServer(...handlers);

before(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
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
  /**
   * Six independent queries land in whatever order the mock latency gives them,
   * so the wait has to name something from EVERY one this test asserts on —
   * panel headings alone render from the page shell, not from the data. Waiting
   * on the headings only made this test pass or fail on query ordering: the
   * header is a skeleton until `useStudent` resolves, and "Alpha" comes from
   * that query rather than from the four panels below it.
   */
  await waitFor(() =>
    [
      "Where the time goes",
      "Mock score trend",
      "Topic mastery",
      "Open flags",
      // …and the header's own data, which arrives on a different request.
      "Alpha",
      "Coordination Compounds",
    ].every((needle) => text().includes(needle)),
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
  // The denominator is the point. 61 is quoted against the 90 marks the engine
  // will explain, not against all 166 lost — quoting it against 166 would
  // silently assert that the other 76 were understood.
  assert.ok(body.includes("61"), "recoverable marks");
  assert.ok(
    body.includes("of the 90 marks we can explain"),
    "the hero names the attributed denominator",
  );
  assert.ok(body.includes("166"), "total lost is still shown");
  assert.match(body, /68%/, "the rate is the server's, over what we can explain");
  assert.ok(
    !body.includes("37%"),
    "the old total_lost denominator appears nowhere",
  );

  // The unattributed bucket is shown and explained, never folded into the gap.
  assert.ok(body.includes("Not enough evidence"), "the fifth bucket is named");
  assert.ok(body.includes("No call made yet"), "and is neither teach nor drill");
  assert.ok(
    body.includes("are not attributed to any cause"),
    "the honest sentence is on screen",
  );
  assert.ok(body.includes("76"), "the unattributed marks are counted in public");

  for (const cause of [
    "Conceptual gap",
    "Execution error",
    "Time exhaustion",
    "Avoidable skip",
    "Not enough evidence",
  ]) {
    assert.ok(body.includes(cause), `cause card: ${cause}`);
  }

  const segments = Array.from(
    document.querySelectorAll("button[aria-label*='marks,']"),
  );
  assert.equal(segments.length, 5, "five stacked segments");
  assert.match(
    segments[0].getAttribute("aria-label") ?? "",
    /^Conceptual gap: 29 marks/,
    "each segment speaks its own value",
  );
  assert.match(
    segments[4].getAttribute("aria-label") ?? "",
    /^Not enough evidence: 76 marks/,
    "the bucket the engine declines to call is last, and speaks too",
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
  await waitFor(() => diagnosisCard().includes("MIS-ORG-EAS"), {
    timeout: 8000,
  });

  const card = diagnosisCard();

  // The claim, in one sentence, at the top.
  assert.match(
    card,
    /Reverses electrophilic aromatic substitution directing effects/,
    "the headline is the hero",
  );
  assert.ok(card.includes("AIT Mock 14"), "the paper being diagnosed");

  // The evidence is visible, not buried: code, confidence, question ids, marks.
  assert.ok(card.includes("MIS-ORG-EAS"), "misconception code");
  assert.ok(card.includes("High confidence"), "confidence is spoken, not colour");
  for (const q of ["D16", "D17", "D18", "D20", "D21"]) {
    assert.ok(card.includes(q), `evidence question ${q}`);
  }
  assert.match(card, /25\s*marks at stake/, "marks at stake on the hypothesis");
  assert.match(
    card,
    /25 marks\s*at stake/,
    "the cost is on the line under the headline",
  );

  // The line the whole pitch rests on, at body size and with its own heading.
  assert.ok(
    card.includes("Why this is a trigger, not a topic gap"),
    "counter-evidence has its own block",
  );
  assert.ok(
    card.includes("the student answered them correctly"),
    "counter-evidence text is rendered",
  );

  assert.ok(card.includes("Do this week"), "recommended action");

  // `time_to_fix` is a BAND. The enum came in because the model, asked for
  // minutes, returned 40 / 20 / 45 for the same evidence — so the card must
  // render the label and must not render a number of minutes anywhere near it.
  assert.ok(card.includes("One focused sitting".toLowerCase()), "the band label");
  assert.ok(
    !/\d+[- ]?minute/i.test(card),
    "no invented minute count survives into the card",
  );

  assert.ok(card.includes("trace #53"), "the trace id is on screen");

  // Each chip carries the option this student picked, which is what makes the
  // claim checkable against the paper in the teacher's hand.
  assert.ok(card.includes("chose C"), "the chosen option travels with the chip");

  await act(async () => root.unmount());
});

test("an unresolved citation renders as text, never as a link to nowhere", async () => {
  // Tanvi's weakest hypothesis cites D12, which is not one of her wrong answers
  // on this paper — `question_id: null`. It must still be shown (the model said
  // it) and must visibly not be openable.
  const root = await renderAt("/students/5");
  await waitFor(() => diagnosisCard().includes("MIS-KIN-RELVEL"), {
    timeout: 8000,
  });

  const card = diagnosisCard();
  assert.ok(card.includes("D12"), "the unresolved citation is still shown");
  assert.ok(
    !/D12[^A-Za-z]*chose/.test(card),
    "no chosen option is claimed for a citation that did not resolve",
  );

  // The total is the server's, over distinct questions — not a browser-side sum
  // of the four hypotheses, which is the number that can quietly drift high.
  assert.match(
    card,
    /40 marks\s*at stake across 4 findings/,
    "the total comes from total_marks_at_stake",
  );

  await act(async () => root.unmount());
});

test("agreeing with a diagnosis records the verdict", async () => {
  const root = await renderAt("/students/2");
  await waitFor(() => diagnosisCard().includes("MIS-ORG-MARKOV"), {
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
  let root = await renderAt("/students/6");
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
  root = await renderAt("/students/7");
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

/* ------------------------------------------------------------------ *
 * The question panel
 *
 * The click that turns a citation into evidence. Everything above tests that
 * the card *claims* "D16 chose C"; these test that a director can check it.
 * ------------------------------------------------------------------ */

function dialog(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[role="dialog"]');
  assert.ok(el, "a dialog is open");
  return el!;
}

/** The row of the options list holding `needle`, as text. */
function optionRow(needle: string): string {
  const items = Array.from(dialog().querySelectorAll("ol li"));
  const found = items.find((li) => li.textContent?.includes(needle));
  assert.ok(found, `an option row containing "${needle}"`);
  return found!.textContent ?? "";
}

test("an evidence chip opens the question, and marks the pick and the answer differently", async () => {
  const root = await renderAt("/students/1");
  await waitFor(() => diagnosisCard().includes("MIS-ORG-EAS"), { timeout: 8000 });

  // The resolved chip is a real control, not decorated text.
  const chip = buttons().find(
    (b) => b.textContent?.includes("D16") && b.textContent?.includes("chose C"),
  );
  assert.ok(chip, "D16 is a button");
  assert.equal(chip!.tagName, "BUTTON");

  // Reached the way a keyboard user reaches it, so the focus assertion at the
  // bottom is testing the real path rather than a mouse-only one.
  chip!.focus();
  await click(chip!);
  await waitFor(() => text().includes("Nitration of toluene"), { timeout: 8000 });

  const panel = dialog().textContent ?? "";

  // 1 — the stem, verbatim off the wire.
  assert.ok(
    panel.includes(
      "Nitration of toluene with a HNO3/H2SO4 mixture gives predominantly:",
    ),
    "the stem is the artefact under discussion",
  );
  assert.ok(panel.includes("D16"), "the label");
  assert.ok(panel.includes("Hydrocarbons"), "the chapter");
  assert.ok(panel.includes("Answered wrongly"), "what became of it for him");
  assert.ok(panel.includes("158s"), "time spent");

  // 2 — all four options, in the order the paper prints them.
  for (const option of [
    "No reaction under these conditions",
    "o- and p-nitrotoluene",
    "m-nitrotoluene",
    "An equimolar mixture of all three isomers",
  ]) {
    assert.ok(panel.includes(option), `option: ${option}`);
  }

  /**
   * The correct answer and his pick are marked DIFFERENTLY, and the correct one
   * is (B) rather than (A) — the seeder shuffles labels on purpose, so a panel
   * that inferred the answer from position would pass on a paper where every
   * answer happened to be first and fail on this one.
   */
  const answer = optionRow("o- and p-nitrotoluene");
  assert.ok(answer.includes("Correct answer"), "the right answer is named as such");
  assert.ok(!answer.includes("chose this"), "he did not pick the right answer");

  const pick = optionRow("m-nitrotoluene");
  assert.ok(pick.includes("Aarav chose this"), "his pick is named, with his name");
  assert.ok(
    !pick.includes("Correct answer"),
    "and is not also labelled correct — two facts, two markers",
  );

  // Never colour alone: both markers are words in the DOM, so they survive
  // greyscale and every colour-vision deficiency.
  assert.ok(panel.includes("Correct answer") && panel.includes("chose this"));

  // 3 — the belief, in his own voice. The reason the panel is worth opening.
  assert.ok(
    panel.includes("in Aarav's own words"),
    "the belief block says whose words these are",
  );
  assert.ok(
    panel.includes(
      "An activating group (–CH3, –OH, –NH2) sends the incoming group to meta",
    ),
    "the student's actual wrong model, stated as he holds it",
  );
  assert.ok(panel.includes("MIS-ORG-EAS"), "the code it is filed under");
  assert.ok(panel.includes("Directing effects reversed"), "and its name");

  // 4 — the remedy, as a lesson someone could run on Monday.
  assert.ok(panel.includes("What fixes it"), "the remedy has its own block");
  assert.ok(
    panel.includes("Twenty minutes at the board on nitration of toluene"),
    "the remedy text is rendered in full",
  );

  // 5 — the worked method is present but folded away: a teacher knows the
  // answer, and it must not compete with the three blocks above.
  const solution = dialog().querySelector("details");
  assert.ok(solution, "the solution is a disclosure");
  assert.equal(solution!.hasAttribute("open"), false, "closed by default");
  assert.ok(
    solution!.textContent?.includes("hyperconjugation"),
    "the worked method is in the DOM, one keypress away",
  );

  // Escape closes it and focus goes back to the chip it came from. The restore
  // lands a tick after the unmount, so it is waited for rather than asserted
  // on the same turn.
  //
  // Both assertions compare booleans on purpose: `assert.equal` on two DOM
  // nodes serialises a jsdom element graph to build its diff, which exhausts
  // the heap and reports as an OOM crash instead of a failed assertion.
  await act(async () => {
    document.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  await waitFor(() => document.querySelector('[role="dialog"]') === null, {
    timeout: 8000,
  });
  await waitFor(() => document.activeElement === chip, { timeout: 4000 });
  assert.equal(document.activeElement === chip, true, "focus returns to the chip");

  await act(async () => root.unmount());
});

test("an unresolved citation is not a control at all", async () => {
  const root = await renderAt("/students/5");
  await waitFor(() => diagnosisCard().includes("MIS-KIN-RELVEL"), {
    timeout: 8000,
  });

  // D12 did not resolve, so there is nothing behind it to open. It must be
  // shown — the model said it — and must not be clickable.
  const asButton = buttons().find((b) => b.textContent?.includes("D12"));
  assert.equal(asButton, undefined, "no button offers to open D12");
  assert.ok(diagnosisCard().includes("D12"), "but the citation is still shown");

  // Its resolved neighbour in the same hypothesis is a button, which is what
  // makes the difference visible rather than incidental.
  const resolved = buttons().find((b) => b.textContent?.includes("D15"));
  assert.ok(resolved, "D15 resolved, so D15 opens");

  await act(async () => root.unmount());
});

test("a citation with no question behind it says so, rather than spinning", async () => {
  // A 404 on the question route. Not a transient failure and not retried: the
  // panel has to say plainly that the citation does not resolve.
  server.use(
    http.get("/api/questions/928/", () =>
      HttpResponse.json(
        { detail: "No QuestionTopicMap matches the given query." },
        { status: 404 },
      ),
    ),
  );

  const root = await renderAt("/students/1");
  await waitFor(() => diagnosisCard().includes("MIS-ORG-EAS"), { timeout: 8000 });

  const chip = buttons().find((b) => b.textContent?.includes("D21"));
  assert.ok(chip, "D21 is a chip");
  await click(chip!);

  await waitFor(() => text().includes("This citation has no question behind it"), {
    timeout: 8000,
  });

  const panel = dialog().textContent ?? "";
  assert.ok(panel.includes("#928"), "the id that failed is named");
  assert.ok(
    panel.includes("Nothing is claimed for it"),
    "and the panel says what that means for the marks above",
  );
  assert.ok(
    !panel.includes("Could not load this panel"),
    "a 404 here is an answer, not the red error state",
  );

  await act(async () => root.unmount());
});

test("not asked, asked-and-unanswered, and answered are three states, not two", async () => {
  /**
   * The trap in `GET /api/questions/{id}/`, asserted where it can be asserted
   * cheaply. Three shapes, checked against the live server:
   *
   *   no `?student=`        every `chosen` is NULL      — nobody was asked
   *   `?student=` no attempt every `chosen` is FALSE    — asked, never answered
   *   `?student=` + attempt  one `chosen` is TRUE
   *
   * A client that reads `chosen` as falsy collapses the first two, and shows a
   * paper where the student appears to have answered nothing.
   */
  const anonymous = parseQuestion(questionFor(923));
  assert.equal(askedAboutStudent(anonymous), false, "no student was named");
  assert.deepEqual(
    anonymous.options.map((o) => o.chosen),
    [null, null, null, null],
    "null, not false — 'not asked' is not 'not chosen'",
  );
  assert.equal(anonymous.status, null);
  assert.equal(hasAttempt(anonymous), false);

  // 30 sat no paper 17, which the live server answers with `chosen: false`
  // across the board and a null `status`.
  const unanswered = parseQuestion(questionFor(923, 30));
  assert.equal(askedAboutStudent(unanswered), true, "a student WAS named");
  assert.deepEqual(
    unanswered.options.map((o) => o.chosen),
    [false, false, false, false],
    "false, because the question was asked and the answer is no",
  );
  assert.equal(hasAttempt(unanswered), false, "and yet there is no attempt");

  const answered = parseQuestion(questionFor(923, 1));
  assert.equal(hasAttempt(answered), true);
  assert.equal(chosenOption(answered)?.label, "C", "the option he picked");
  assert.equal(correctOption(answered)?.label, "B", "the answer is NOT (A)");
  assert.equal(
    chosenMisconception(answered)?.code,
    "MIS-ORG-EAS",
    "and his pick is the one that carries the belief",
  );
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
