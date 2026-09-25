import { useState } from "react";
import type { MarksLost } from "@/api/types";
import { num, pct } from "@/lib/format";
import { causeSlices, marksLostTotals, type CauseSlice } from "@/lib/causes";
import { Figure, FigureTable, Legend } from "./Figure";

const BAR_H = 44;
/** Below this share an inline number cannot sit with padding either side. */
const INLINE_LABEL_MIN_PCT = 11;

/**
 * Marks-lost attribution for one paper, as a single stacked bar.
 *
 * Four ordered causes on one hue, darkest (needs new learning) to lightest
 * (needs none) — and then a grey bucket that is not a cause at all. The grey is
 * the marks the engine will not attribute, because the student has barely
 * attempted those chapters.
 *
 * The rail underneath carries the argument, and it now spans only the coloured
 * part of the bar: "of the loss we can explain, this much is recoverable". The
 * grey gets its own rail section and its own sentence rather than being hidden,
 * because a system that shows what it will not claim is the one a director can
 * believe about what it does claim.
 */
export function MarksLostBar({
  data,
  maxMarks,
  scored,
}: {
  data: MarksLost;
  maxMarks?: number;
  scored?: number;
}) {
  const [hover, setHover] = useState<CauseSlice | null>(null);
  const slices = causeSlices(data);
  const totals = marksLostTotals(data);

  // Rail geometry. `recoverablePct` is the server's share OF THE ATTRIBUTED
  // loss, so it is scaled into the attributed span rather than the whole bar —
  // which is also what makes the rail line up with the segment boundaries.
  const recoverableWidth =
    totals.recoverablePct === null
      ? 0
      : totals.attributedPct * (totals.recoverablePct / 100);
  const conceptualWidth = totals.attributedPct - recoverableWidth;
  const unattributedWidth = 100 - totals.attributedPct;

  return (
    <Figure
      title="Where the marks went"
      subtitle={
        <>
          Cause is inferred from status plus prior mastery — a wrong answer on a
          topic the student knows is an execution error, not a gap in
          understanding. Where there are too few attempts to infer anything, the
          marks go to the grey bucket rather than to a guess.
        </>
      }
      legend={
        <Legend
          items={slices.map((slice) => ({
            color: slice.color,
            label: slice.label,
            value: num(slice.marks),
            shape: "block" as const,
          }))}
        />
      }
      table={
        <FigureTable
          head={
            <>
              <th scope="col" className="py-2 pr-4 font-medium">Cause</th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">Marks</th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                Share of all lost
              </th>
              <th scope="col" className="py-2 font-medium">What it means</th>
            </>
          }
        >
          {slices.map((slice) => (
            <tr key={slice.key}>
              <th scope="row" className="py-1.5 pr-4 text-left font-normal">
                {slice.label}
              </th>
              <td className="py-1.5 pr-4 text-right font-medium">
                {num(slice.marks)}
              </td>
              <td className="py-1.5 pr-4 text-right">{pct(slice.sharePct, 1)}</td>
              <td className="py-1.5 text-muted-foreground">{slice.meaning}</td>
            </tr>
          ))}
          <tr>
            <th scope="row" className="py-1.5 pr-4 text-left font-medium">
              Explained
            </th>
            <td className="py-1.5 pr-4 text-right font-medium">
              {num(totals.attributed)}
            </td>
            <td className="py-1.5 pr-4 text-right">
              {pct(totals.attributedPct, 1)}
            </td>
            <td className="py-1.5 text-muted-foreground">
              The denominator for every rate quoted on this screen
            </td>
          </tr>
          <tr>
            <th scope="row" className="py-1.5 pr-4 text-left font-medium">
              Total lost
            </th>
            <td className="py-1.5 pr-4 text-right font-medium">
              {num(totals.totalLost)}
            </td>
            <td className="py-1.5 pr-4 text-right">100%</td>
            <td className="py-1.5 text-muted-foreground">
              {maxMarks && scored !== undefined
                ? `Scored ${num(scored)} of ${num(maxMarks)}`
                : ""}
            </td>
          </tr>
        </FigureTable>
      }
      footnote={
        <>
          Of the {num(totals.totalLost)} marks lost,{" "}
          <strong className="font-semibold text-foreground">
            {num(totals.attributed)}
          </strong>{" "}
          can be explained.{" "}
          <strong className="font-semibold text-foreground">
            {num(data.conceptual_gap)}
          </strong>{" "}
          of those were things he genuinely does not know;{" "}
          <strong className="font-semibold text-foreground">
            {num(data.recoverable)}
          </strong>
          {totals.recoverablePct === null
            ? ""
            : ` — ${pct(totals.recoverablePct)} of the explained loss — `}
          need drilling, not teaching.
          {totals.unattributed > 0 ? (
            <>
              {" "}
              The remaining{" "}
              <strong className="font-semibold text-foreground">
                {num(totals.unattributed)}
              </strong>{" "}
              are left uncalled: he has barely attempted those chapters, and a
              guess there would be worse than a blank.
            </>
          ) : null}
        </>
      }
    >
      <div className="relative pt-1">
        <div
          className="flex w-full gap-[2px]"
          style={{ height: BAR_H }}
          onMouseLeave={() => setHover(null)}
        >
          {slices.map((slice, i) => {
            const showInline = slice.sharePct >= INLINE_LABEL_MIN_PCT;
            return (
              <button
                key={slice.key}
                type="button"
                aria-label={`${slice.label}: ${num(slice.marks)} marks, ${pct(slice.sharePct, 1)} of all marks lost. ${slice.meaning}.`}
                onMouseEnter={() => setHover(slice)}
                onFocus={() => setHover(slice)}
                onBlur={() => setHover(null)}
                className={`relative flex items-center justify-center outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring ${
                  i === slices.length - 1 ? "rounded-r-[4px]" : ""
                } ${hover && hover.key !== slice.key ? "opacity-70" : ""}`}
                style={{
                  flexBasis: `${slice.sharePct}%`,
                  background: slice.color,
                }}
              >
                {showInline ? (
                  <span
                    className="tnum text-xs font-semibold"
                    style={{ color: slice.ink }}
                  >
                    {num(slice.marks)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* The rail that carries the argument.
            Its first two sections span only the *explained* part of the bar,
            because that is the denominator the server divides by. The third is
            the grey bucket, given a section and a sentence of its own — it is
            the largest number on most papers and hiding it would make every
            other number on this screen less believable, not more. */}
        <div className="mt-2.5 flex w-full gap-[2px]">
          <div style={{ flexBasis: `${conceptualWidth}%` }}>
            <div className="h-0.5 rounded-full bg-muted-foreground/50" />
            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
              <span className="tnum font-semibold text-foreground">
                {num(data.conceptual_gap)}
              </span>{" "}
              needs new learning
            </p>
          </div>
          {totals.recoverablePct === null ? null : (
            <div style={{ flexBasis: `${recoverableWidth}%` }}>
              <div className="h-0.5 rounded-full bg-status-good" />
              <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                <span className="tnum font-semibold text-status-good">
                  {num(data.recoverable)}
                </span>{" "}
                recoverable — {pct(totals.recoverablePct)} of what we can
                explain needs drilling, not teaching
              </p>
            </div>
          )}
          {unattributedWidth > 0 ? (
            <div style={{ flexBasis: `${unattributedWidth}%` }}>
              <div
                className="h-0.5 rounded-full"
                style={{ background: "var(--cause-unattributed)" }}
              />
              <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                <span className="tnum font-semibold text-foreground">
                  {num(totals.unattributed)}
                </span>{" "}
                not attributed — too few attempts on those chapters to call it
                anything
              </p>
            </div>
          ) : null}
        </div>

        {hover ? (
          <div
            role="status"
            className="pointer-events-none absolute -top-2 left-1/2 z-10 w-64 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-popover p-3 text-xs shadow-lg"
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ background: hover.color }}
              />
              <span className="font-medium text-popover-foreground">
                {hover.label}
              </span>
              <span className="tnum ml-auto font-semibold text-popover-foreground">
                {num(hover.marks)}
              </span>
            </div>
            <p className="mt-1.5 leading-relaxed text-muted-foreground">
              {hover.meaning}. {pct(hover.sharePct, 1)} of all marks lost.
            </p>
          </div>
        ) : null}
      </div>
    </Figure>
  );
}
