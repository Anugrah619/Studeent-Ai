import { useState } from "react";
import type { MarksLost } from "@/api/types";
import { num, pct } from "@/lib/format";
import { causeSlices, type CauseSlice } from "@/lib/causes";
import { Figure, FigureTable, Legend } from "./Figure";

const BAR_H = 44;
/** Below this share an inline number cannot sit with padding either side. */
const INLINE_LABEL_MIN_PCT = 11;

/**
 * Marks-lost attribution for one paper, as a single stacked bar over four
 * ordered causes — one hue, darkest (needs new learning) to lightest (needs
 * none). The rail underneath is the argument: how much of the loss is
 * recoverable without teaching anything new.
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
  const total = data.total_lost || 1;
  const recoverablePct = (data.recoverable / total) * 100;

  return (
    <Figure
      title="Where the marks went"
      subtitle={
        <>
          Every lost mark attributed to one of four causes. Cause is inferred
          from status plus prior mastery — a wrong answer on a topic the student
          knows is an execution error, not a gap in understanding.
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
              <th scope="col" className="py-2 pr-4 text-right font-medium">Share</th>
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
              Total lost
            </th>
            <td className="py-1.5 pr-4 text-right font-medium">
              {num(data.total_lost)}
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
          Only{" "}
          <strong className="font-semibold text-foreground">
            {num(data.conceptual_gap)}
          </strong>{" "}
          of {num(data.total_lost)} lost marks were things he genuinely does not
          know.{" "}
          <strong className="font-semibold text-foreground">
            {num(data.recoverable)}
          </strong>{" "}
          are recoverable without learning anything new.
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
                aria-label={`${slice.label}: ${num(slice.marks)} marks, ${pct(slice.sharePct, 1)} of the loss. ${slice.meaning}.`}
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

        {/* The rail that carries the argument. */}
        <div className="mt-2.5 flex w-full gap-[2px]">
          <div style={{ flexBasis: `${100 - recoverablePct}%` }}>
            <div className="h-0.5 rounded-full bg-muted-foreground/50" />
            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
              <span className="tnum font-semibold text-foreground">
                {num(data.conceptual_gap)}
              </span>{" "}
              needs new learning
            </p>
          </div>
          <div style={{ flexBasis: `${recoverablePct}%` }}>
            <div className="h-0.5 rounded-full bg-status-good" />
            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
              <span className="tnum font-semibold text-status-good">
                {num(data.recoverable)}
              </span>{" "}
              recoverable — {pct(recoverablePct)} of the loss needs no new
              teaching, only drilling
            </p>
          </div>
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
              {hover.meaning}. {pct(hover.sharePct, 1)} of the marks lost.
            </p>
          </div>
        ) : null}
      </div>
    </Figure>
  );
}
