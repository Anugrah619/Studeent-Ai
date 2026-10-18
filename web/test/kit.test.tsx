// The design kit's contracts: what every screen relies on when it renders a
// number, a formula or a reveal. The DOM is installed by `scripts/run-tests.mjs`.
import assert from "node:assert/strict";
import test from "node:test";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { AnimatedNumber, formatNumber } from "../src/components/kit/AnimatedNumber";
import { KpiCard } from "../src/components/kit/KpiCard";
import { MathText, parseMath } from "../src/components/kit/MathText";
import { Reveal, RevealItem } from "../src/components/kit/Reveal";
import { FlowCanvas } from "../src/components/kit/FlowCanvas";
import { StatTile } from "../src/components/common/StatTile";
import { num, pct, signed } from "../src/lib/format";
import { ThemeProvider } from "../src/theme/theme-provider";
import { waitFor } from "./dom";

async function mount(node: ReactNode): Promise<HTMLElement> {
  document.body.innerHTML = "<div id='root'></div>";
  const host = document.getElementById("root")!;
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <ThemeProvider>
        <MemoryRouter>{node}</MemoryRouter>
      </ThemeProvider>,
    );
  });
  return host;
}

test("an animated figure prints exactly what the static formatters print", () => {
  for (const value of [0, 7, 312, 123456, -37, 98.25]) {
    assert.equal(formatNumber(value, "int"), num(value));
    assert.equal(formatNumber(value, "decimal", 2), num(value, 2));
    assert.equal(formatNumber(value, "percent", 1), pct(value, 1));
    assert.equal(formatNumber(value, "signed"), signed(value));
  }
  assert.equal(formatNumber(31.2, "percent", 1), "31.2%", "percent is 0–100, never x100");
  assert.equal(formatNumber(123456, "int"), "1,23,456", "Indian grouping");
  assert.equal(formatNumber(-37, "signed"), "\u221237", "a true minus sign");
});

test("an animated figure reads once as text, and a missing one as a dash", async () => {
  const host = await mount(
    <>
      <AnimatedNumber value={98.3} format="decimal" />|
      <AnimatedNumber value={null} />|
      <AnimatedNumber value={Number.NaN} />
    </>,
  );
  assert.equal(host.textContent, "98.3|—|—");
});

test("a KPI card shows its tone in words, not colour alone", async () => {
  const host = await mount(
    <>
      <KpiCard label="Students flagged" value={6} unit="of 298 active" tone="critical" toneLabel="2 critical" />
      <KpiCard label="Revision debt" value={31.2} format="percent" digits={1} tone="warn" />
      <StatTile label="Mock trend" value="−37" delta={{ text: "falling", tone: "bad", caption: "" }} />
    </>,
  );
  const text = host.textContent ?? "";
  assert.ok(text.includes("6of 298 active"), text);
  assert.ok(text.includes("2 critical"), "the tone label is visible");
  assert.ok(text.includes("needs attention"), "an unlabelled tone still has a name");
  assert.ok(text.includes("31.2%"));
  assert.ok(text.includes("−37falling"), "StatTile keeps its API and its delta word");
});

test("maths is found only between real delimiters", () => {
  const kinds = (s: string) =>
    parseMath(s).map((seg) => (seg.kind === "math" ? `[${seg.display ? "D" : "I"}:${seg.value}]` : seg.value));

  assert.deepEqual(kinds("Energy $E=mc^2$ here"), ["Energy ", "[I:E=mc^2]", " here"]);
  assert.deepEqual(kinds("$$\\frac12$$"), ["[D:\\frac12]"]);
  assert.deepEqual(kinds("\\(x\\) and \\[y\\]"), ["[I:x]", " and ", "[D:y]"]);
  assert.deepEqual(kinds("costs $5 and $10 today"), ["costs $5 and $10 today"], "prose stays prose");
  assert.deepEqual(kinds("a \\$ sign"), ["a $ sign"]);
  assert.deepEqual(kinds("unclosed $x"), ["unclosed $x"]);
  assert.deepEqual(kinds("$\\ce{H2O}$"), ["[I:\\ce{H2O}]"]);
});

test("formulas are typeset and everything else stays text, never markup", async () => {
  const host = await mount(
    <MathText as="p">{"<b>bold</b> water is $\\ce{H2O}$ and $x^2$"}</MathText>,
  );
  assert.equal(host.querySelector("b"), null, "text outside a formula is never parsed as HTML");
  assert.ok((host.textContent ?? "").includes("<b>bold</b>"));
  assert.equal(host.querySelectorAll(".katex").length, 2, "both formulas typeset, \\ce included");
  assert.ok(host.querySelector("math"), "MathML for screen readers");
  assert.equal(host.querySelector(".katex-error"), null, "mhchem is registered");
});

test("revealed content and a flow diagram render in the test DOM", async () => {
  const host = await mount(
    <>
      <Reveal stagger={0.05}>
        <RevealItem>First step</RevealItem>
        <RevealItem>Second step</RevealItem>
      </Reveal>
      <FlowCanvas
        label="Pipeline"
        nodes={[
          { id: "a", position: { x: 0, y: 0 }, data: { label: "Answer sheet" } },
          { id: "b", position: { x: 200, y: 0 }, data: { label: "Diagnosis" } },
        ]}
        edges={[{ id: "e", source: "a", target: "b" }]}
      />
    </>,
  );
  await waitFor(() => (host.textContent ?? "").includes("Diagnosis"));
  const text = host.textContent ?? "";
  assert.ok(text.includes("First step") && text.includes("Second step"));
  assert.ok(text.includes("Answer sheet"));
  assert.ok(host.querySelector("[role='figure'][aria-label='Pipeline']"));
});
