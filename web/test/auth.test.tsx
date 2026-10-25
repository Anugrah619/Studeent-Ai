// The DOM is installed by `scripts/run-tests.mjs` via `node --import`, before
// this module — or any of React's or Radix's — is evaluated.
import assert from "node:assert/strict";
import test, { after, afterEach, before } from "node:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setupServer } from "msw/node";
import App, { queryClient } from "../src/App";
import type { Me } from "../src/api/types";
import { handlers, signInAs, signInDemoUser } from "../src/mocks/handlers";
import { text, waitFor } from "./dom";

/**
 * A new account's first sign-in: roll number, temporary password, and a
 * password change before anything else.
 *
 * What is under test is the *gate*, not the form: while an account is on a
 * temporary password the app shows the change screen and nothing else, never
 * touches a console route, and lets the person through to the right place once
 * they have chosen their own. The server enforces the same rule on its own
 * (403 `password_change_required`); the mock server here does too, so a gate
 * that leaked would be caught as a failed request as well as a wrong screen.
 */

const server = setupServer(...handlers);
const requested: string[] = [];

before(() => {
  server.listen({ onUnhandledRequest: "error" });
  server.events.on("request:start", ({ request }) => {
    requested.push(new URL(request.url).pathname);
  });
});
afterEach(() => {
  server.resetHandlers();
  signInDemoUser();
  requested.length = 0;
  // `me` is cached for good; without this the next test starts as the last one.
  queryClient.clear();
});
after(() => server.close());

const STUDENT_ON_TEMPORARY: Me = {
  id: 77,
  username: "stu-12",
  name: "Aarav Mehta",
  email: "",
  role: "student",
  institute: { id: 1, name: "Aarambh Classes", city: "Kota", slug: "aarambh" },
  mentor_id: null,
  student_id: 12,
  is_staff: false,
  is_superuser: false,
  must_change_password: true,
};

const MENTOR_ON_TEMPORARY: Me = {
  id: 1,
  username: "aarambh.bhatia",
  name: "Dr. S. Bhatia",
  email: "bhatia@aarambh.example",
  role: "mentor",
  institute: { id: 1, name: "Aarambh Classes", city: "Kota", slug: "aarambh" },
  mentor_id: 1,
  student_id: null,
  is_staff: false,
  is_superuser: false,
  must_change_password: true,
};

async function renderApp(): Promise<Root> {
  window.history.pushState({}, "", "/");
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

/** Set a controlled input the way a browser does, so React's onChange fires. */
function typeInto(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement | null;
  assert.ok(input, `#${id} is on screen`);
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  return act(async () => {
    set.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

function submitButton(): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Save and continue"),
  );
  assert.ok(found, "the Save button is on screen");
  return found as HTMLButtonElement;
}

async function fillAndSubmit(current: string, next: string, again = next) {
  await typeInto("current-password", current);
  await typeInto("new-password", next);
  await typeInto("confirm-password", again);
  await click(submitButton());
}

test("a temporary password sees the change screen and nothing else", async () => {
  signInAs(STUDENT_ON_TEMPORARY);
  const root = await renderApp();
  await waitFor(() => text().includes("Choose your own password"));

  const body = text();
  assert.ok(body.includes("Aarav Mehta"), "greets them by name");
  assert.ok(!body.includes("Director console"), "the console is not mounted");

  // Nothing but identity was asked of the server: not one console route.
  const asked = requested.filter((p) => p.startsWith("/api/"));
  assert.deepEqual([...new Set(asked)], ["/api/me/"]);
  await act(async () => root.unmount());
});

test("the gate binds a mentor on a temporary password as well", async () => {
  signInAs(MENTOR_ON_TEMPORARY);
  const root = await renderApp();
  await waitFor(() => text().includes("Choose your own password"));
  assert.ok(!text().includes("Director console"));
  await act(async () => root.unmount());
});

test("the Save button stays off until the two new passwords agree", async () => {
  signInAs(STUDENT_ON_TEMPORARY);
  const root = await renderApp();
  await waitFor(() => text().includes("Choose your own password"));

  await typeInto("current-password", "demo12345");
  await typeInto("new-password", "a-much-better-one");
  assert.equal(submitButton().disabled, true, "off while the confirmation is empty");

  await typeInto("confirm-password", "a-much-better-on");
  assert.ok(text().includes("do not match"), "says so");
  assert.equal(submitButton().disabled, true);

  await typeInto("confirm-password", "a-much-better-one");
  assert.equal(submitButton().disabled, false);
  await act(async () => root.unmount());
});

test("the server's own reason is shown, in its own words", async () => {
  signInAs(STUDENT_ON_TEMPORARY);
  const root = await renderApp();
  await waitFor(() => text().includes("Choose your own password"));

  await fillAndSubmit("demo12345", "short");
  await waitFor(() => text().includes("too short"));
  // The sentence, not the client's flattened `new_password: …` form of it.
  assert.ok(!text().includes("new_password:"), "no field name leaked into the copy");
  assert.ok(text().includes("Choose your own password"), "still on the change screen");
  await act(async () => root.unmount());
});

test("a wrong temporary password is refused and says which one", async () => {
  signInAs(STUDENT_ON_TEMPORARY);
  const root = await renderApp();
  await waitFor(() => text().includes("Choose your own password"));

  await fillAndSubmit("not-it", "a-much-better-one");
  await waitFor(() => text().includes("not your current password"));
  await act(async () => root.unmount());
});

test("a student who chooses a password lands in the student app, not the console", async () => {
  signInAs(STUDENT_ON_TEMPORARY);
  const root = await renderApp();
  await waitFor(() => text().includes("Choose your own password"));

  await fillAndSubmit("demo12345", "a-much-better-one");
  // A new student has not onboarded, so the student app opens on that. The
  // facts arrive on their own request, a moment after the heading.
  await waitFor(
    () =>
      text().includes("Let's fit your plan to your day.") &&
      text().includes("Your institute set these"),
  );

  const body = text();
  assert.ok(body.includes("Your institute set these"), "the institute's facts, to confirm");
  assert.ok(body.includes("How many minutes a day can you study?"));
  assert.ok(!body.includes("Director console"));
  assert.ok(!body.includes("Choose your own password"), "the gate is open");
  // Still no console traffic: a student's console routes are all 403.
  assert.ok(!requested.some((p) => p.startsWith("/api/students") || p.startsWith("/api/dashboard")));
  assert.ok(requested.includes("/api/my/profile/"), "the student app asked who they are");
  await act(async () => root.unmount());
});

test("a mentor who chooses a password goes straight into the console", async () => {
  signInAs(MENTOR_ON_TEMPORARY);
  const root = await renderApp();
  await waitFor(() => text().includes("Choose your own password"));

  await fillAndSubmit("demo12345", "a-much-better-one");
  await waitFor(() => text().includes("Aarav Mehta"));
  assert.ok(text().includes("Director console"));
  await act(async () => root.unmount());
});

test("a student past the first sign-in gets the student app, not a screen of 403s", async () => {
  signInAs({ ...STUDENT_ON_TEMPORARY, must_change_password: false });
  const root = await renderApp();
  await waitFor(() => text().includes("Let's fit your plan to your day."));
  assert.ok(!text().includes("Director console"));
  assert.ok(!requested.some((p) => p.startsWith("/api/students")));
  await act(async () => root.unmount());
});

test("a mentor who is not on a temporary password never sees the change screen", async () => {
  const root = await renderApp();
  await waitFor(() => text().includes("Aarav Mehta"));
  assert.ok(!text().includes("Choose your own password"));
  await act(async () => root.unmount());
});
