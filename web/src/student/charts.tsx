import { useState } from "react";
import type { MarksLost, MockScore, SubjectBreakdown } from "@/api/types";
import { CAUSES, CAUSE_KEYS, type CauseKey } from "@/lib/causes";
import { num, pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { shortDay, uniq } from "./lib";
import { SubjectLabel } from "./ui";

/**
 * The student's charts. Small, drawn in plain HTML so they reflow to a 375px
 * phone without a resize observer, and quiet: one series in the page's ink, a
 * hairline grid, a label only where the eye needs one, and every value also
 * reachable without the chart (the readout on focus, and a table).
 *
 * Subjects are whatever the exam has. Nothing here names Physics, Chemistry or
 * Maths; every per-subject view is built from the rows it is given, so a NEET
 * student's four subjects get four rows.
 */

function niceTop(value: number): number {
  if (value <= 0) return 10;
  const step = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (m * step >= value) return m * step;
  }
  return 10 * step;
}

/** Subjects in the order the rows give them: the latest paper's, then any others. */
export function subjectsOf(rows: MockScore[]): string[] {
  const latest = rows.at(-1)?.subjects.map((s) => s.subject) ?? [];
  return uniq([...latest, ...rows.flatMap((r) => r.subjects.map((s) => s.subject))]);
}

function marksIn(row: MockScore, subject: string): number | null {
  return row.subjects.find((s) => s.subject === subject)?.marks ?? null;
}

/* ------------------------------------------------------------------ *
 * Total marks per paper
 * ------------------------------------------------------------------ */

/**
 * One column per paper, oldest first. Where the paper's maximum is known the
 * column stands in a lighter track of that height, so a 134 out of 184 is
 * seen to be a better day than a 134 out of 300 — raw totals alone would draw
 * them level.
 */
export function ScoreColumns({ rows, maxima }: { rows: MockScore[]; maxima: Map<number, number> }) {
  const [focus, setFocus] = useState<number | null>(null);
  const tracks = rows.every((r) => maxima.has(r.paper_id));
  const top = niceTop(Math.max(...rows.map((r) => Math.max(r.total, tracks ? maxima.get(r.paper_id)! : 0)), 1));
  const ticks = [0, top / 2, top];
  const focused = focus === null ? null : rows[focus];

  return (
    <figure>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[2px] bg-foreground/80" />
            Your marks
          </span>
          {tracks ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-[2px] bg-foreground/[0.09]" />
              The paper&rsquo;s total
            </span>
          ) : null}
        </span>
        <span aria-live="polite" className="tnum truncate text-right text-foreground">
          {focused
            ? `${focused.paper_name}: ${num(focused.total)}${maxima.has(focused.paper_id) ? ` of ${num(maxima.get(focused.paper_id))}` : ""}`
            : ""}
        </span>
      </div>

      <div className="relative mt-3 h-44 pl-9">
        {ticks.map((t) => (
          <div
            key={t}
            aria-hidden
            className="absolute right-0 left-9 border-t border-[var(--chart-grid)]"
            style={{ bottom: `${(t / top) * 100}%` }}
          >
            <span className="tnum absolute -top-2 -left-9 w-7 text-right text-xs leading-none text-muted-foreground">
              {num(t)}
            </span>
          </div>
        ))}
        <ol className="relative flex h-full items-end gap-1.5" aria-label="Marks on each paper, oldest first">
          {rows.map((row, i) => {
            const max = maxima.get(row.paper_id);
            const last = i === rows.length - 1;
            const label = `${row.paper_name}, ${shortDay(row.held_on)}: ${num(row.total)} marks${max ? ` of ${num(max)}` : ""}`;
            return (
              <li
                key={row.paper_id}
                tabIndex={0}
                aria-label={label}
                onFocus={() => setFocus(i)}
                onBlur={() => setFocus(null)}
                onMouseEnter={() => setFocus(i)}
                onMouseLeave={() => setFocus(null)}
                className="relative flex h-full min-w-0 flex-1 justify-center rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <div className="relative h-full w-full max-w-6">
                  {tracks && max ? (
                    <div
                      aria-hidden
                      className="absolute inset-x-0 bottom-0 rounded-t-[4px] bg-foreground/[0.09]"
                      style={{ height: `${(max / top) * 100}%` }}
                    />
                  ) : null}
                  <div
                    aria-hidden
                    className={cn(
                      "absolute inset-x-0 bottom-0 rounded-t-[4px]",
                      focus === i || (focus === null && last) ? "bg-foreground" : "bg-foreground/70",
                    )}
                    style={{ height: `${(Math.max(row.total, 0) / top) * 100}%` }}
                  />
                  {last || i === 0 ? (
                    <span
                      aria-hidden
                      className="tnum absolute left-1/2 -translate-x-1/2 text-xs font-semibold text-foreground"
                      style={{ bottom: `calc(${(Math.max(row.total, 0) / top) * 100}% + 4px)` }}
                    >
                      {num(row.total)}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <div aria-hidden className="mt-1.5 flex gap-1.5 pl-9">
        {rows.map((row, i) => (
          <span key={row.paper_id} className="tnum min-w-0 flex-1 truncate text-center text-[0.6875rem] text-muted-foreground">
            {i === 0 || i === rows.length - 1 || rows.length <= 6 ? shortDay(row.held_on).split(" ").slice(1).join(" ") : ""}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** Per subject, one small strip of columns on a shared scale, latest emphasised. */
export function SubjectStrips({ rows }: { rows: MockScore[] }) {
  const subjects = subjectsOf(rows);
  const top = Math.max(1, ...rows.flatMap((r) => r.subjects.map((s) => s.marks)));
  return (
    <ul className="divide-y divide-border">
      {subjects.map((subject) => {
        const series = rows.map((r) => marksIn(r, subject));
        const latest = series.at(-1);
        const first = series.find((v) => v !== null);
        return (
          <li key={subject} className="flex items-center gap-3 py-3" data-subject={subject}>
            <SubjectLabel subject={subject} className="w-24 shrink-0 text-sm font-medium text-foreground" />
            <span aria-hidden className="flex h-8 min-w-0 flex-1 items-end gap-1">
              {series.map((v, i) => (
                <span
                  key={rows[i].paper_id}
                  className={cn(
                    "max-w-3 min-w-0 flex-1 rounded-t-[2px]",
                    i === series.length - 1 ? "bg-foreground" : "bg-foreground/45",
                  )}
                  style={{ height: `${(Math.max(v ?? 0, 0) / top) * 100}%`, minHeight: v ? 2 : 0 }}
                />
              ))}
            </span>
            <span className="w-24 shrink-0 text-right">
              <span className="tnum block text-sm font-semibold text-foreground">
                {latest === null || latest === undefined ? "—" : num(latest)}
                <span className="sr-only"> marks on the latest paper</span>
              </span>
              {first !== null && first !== undefined && series.length > 1 ? (
                <span className="tnum block text-xs text-muted-foreground">first paper {num(first)}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Every paper and subject as numbers — the chart's table twin. */
export function ScoresTable({ rows, maxima }: { rows: MockScore[]; maxima: Map<number, number> }) {
  const subjects = subjectsOf(rows);
  return (
    <div className="overflow-x-auto">
      <table className="tnum w-full min-w-[28rem] text-left text-sm">
        <caption className="sr-only">Marks on each paper, by subject</caption>
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b border-border">
            <th scope="col" className="py-2 pr-3 font-medium">Paper</th>
            {subjects.map((s) => (
              <th key={s} scope="col" className="px-2 py-2 text-right font-medium">{s}</th>
            ))}
            <th scope="col" className="py-2 pl-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((row) => (
            <tr key={row.paper_id} className="border-b border-border last:border-b-0">
              <th scope="row" className="py-2 pr-3 font-medium text-foreground">
                {row.paper_name}
                <span className="block text-xs font-normal text-muted-foreground">{shortDay(row.held_on)}</span>
              </th>
              {subjects.map((s) => (
                <td key={s} className="px-2 py-2 text-right">{num(marksIn(row, s))}</td>
              ))}
              <td className="py-2 pl-2 text-right font-semibold">
                {num(row.total)}
                {maxima.has(row.paper_id) ? (
                  <span className="font-normal text-muted-foreground"> of {num(maxima.get(row.paper_id))}</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Time against marks, per subject
 * ------------------------------------------------------------------ */

export function BalanceBars({ rows }: { rows: SubjectBreakdown[] }) {
  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[2px] bg-foreground/80" />
          Share of your study time
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[2px] bg-foreground/30" />
          Share of the marks you lose
        </span>
      </div>
      <ul className="mt-3 divide-y divide-border">
        {rows.map((row) => (
          <li key={row.subject} className="py-3" data-subject={row.subject}>
            <div className="flex items-baseline justify-between gap-3">
              <SubjectLabel subject={row.subject} className="text-sm font-semibold text-foreground" />
              <span className="text-xs text-muted-foreground">
                {row.accuracy_pct === null
                  ? "Not enough answers yet to show how many you get right"
                  : `You get ${pct(row.accuracy_pct)} of questions right`}
              </span>
            </div>
            <Bar value={row.time_share_pct} tone="strong" label="Study time" />
            <Bar value={row.marks_lost_share_pct} tone="light" label="Marks lost" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Bar({ value, tone, label }: { value: number; tone: "strong" | "light"; label: string }) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <span className="sr-only">{label}:</span>
      <span aria-hidden className="relative h-2.5 flex-1">
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-r-[4px]",
            tone === "strong" ? "bg-foreground/80" : "bg-foreground/30",
          )}
          style={{ width: `${width}%`, minWidth: width > 0 ? 2 : 0 }}
        />
      </span>
      <span className="tnum w-11 shrink-0 text-right text-xs text-foreground">{pct(value)}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Where the marks went on one paper
 * ------------------------------------------------------------------ */

/**
 * The five buckets, in the student's words. The engine's names are written for
 * a mentor; these say the same thing to the person who lost the marks, and
 * none of them is a verdict about that person.
 */
export const CAUSE_WORDS: Record<CauseKey, { label: string; meaning: string }> = {
  conceptual_gap: {
    label: "Ideas to go back over",
    meaning: "Wrong or skipped in chapters that are still hard for you",
  },
  execution_error: { label: "Slips", meaning: "Wrong in chapters you usually get right" },
  time_exhaustion: { label: "Ran out of time", meaning: "Questions you didn't reach" },
  avoidable_skip: { label: "Left blank", meaning: "Skipped in chapters you can do" },
  insufficient_evidence: {
    label: "Too early to say",
    meaning: "In chapters with too few of your answers to tell yet",
  },
};

/** One stacked bar — the causes' own ramp, the unattributed bucket grey — and its key. */
export function CauseBar({ data }: { data: MarksLost }) {
  const total = data.total_lost || 1;
  const parts = CAUSE_KEYS.map((key) => ({ key, marks: data[key] ?? 0 })).filter((p) => p.marks > 0);
  return (
    <div>
      <div aria-hidden className="flex h-4 w-full gap-[2px]">
        {parts.map((p, i) => (
          <span
            key={p.key}
            className={cn("h-full", i === 0 && "rounded-l-[4px]", i === parts.length - 1 && "rounded-r-[4px]")}
            style={{ width: `${(p.marks / total) * 100}%`, background: CAUSES[p.key].color }}
          />
        ))}
      </div>
      <ul className="mt-4 space-y-2.5">
        {CAUSE_KEYS.map((key) => {
          const marks = data[key] ?? 0;
          return (
            <li key={key} className={cn("flex items-start gap-3", marks === 0 && "opacity-60")}>
              <span aria-hidden className="mt-1 size-3 shrink-0 rounded-[3px]" style={{ background: CAUSES[key].color }} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{CAUSE_WORDS[key].label}</span>
                <span className="block text-sm leading-snug text-muted-foreground">{CAUSE_WORDS[key].meaning}</span>
              </span>
              <span className="tnum shrink-0 text-sm font-semibold text-foreground">
                {num(marks)}
                <span className="sr-only"> marks</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A 0–100% measure on a light track of the same ink. */
export function Meter({ value, label }: { value: number; label: string }) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <span className="flex items-center gap-2">
      <span
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(width)}
        className="relative h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-foreground/10 sm:w-32"
      >
        <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/75" style={{ width: `${width}%` }} />
      </span>
      <span className="tnum text-sm text-foreground">{pct(width)}</span>
    </span>
  );
}
