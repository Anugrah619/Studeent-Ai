import { useMemo, useState } from "react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import type { SubjectBreakdown } from "@/api/types";
import { useMeasure } from "@/hooks/use-measure";
import { num, pct, signed } from "@/lib/format";
import { EASE_OUT_SOFT, revealViewport, transition } from "@/lib/motion";
import { resolveSubject } from "@/lib/subjects";
import { cn } from "@/lib/utils";
import { Figure, FigureTable, Legend } from "./Figure";

const BAR_H = 20;
/** The fixed centre column carrying the subject name. Style and maths share it. */
const CENTRE_W = 104;
/** `gap-x-3`, in pixels. Both gaps sit between the centre column and a half. */
const GAP = 12;
/**
 * `minmax(0, 1fr)`, not `1fr`. A bare `1fr` has a min-content floor, so the
 * half holding the wider label could quietly take more of the row than the
 * other — and the two halves would stop sharing one scale. With a zero floor
 * the halves are equal by construction, which `halfWidth` below assumes.
 */
const COLUMNS = `minmax(0,1fr) ${CENTRE_W}px minmax(0,1fr)`;
/** Inset either side of a label that sits inside its own bar. */
const LABEL_INSET = 6;
/**
 * Rough advance width of one character of `tnum` at 13px. Used only to decide
 * whether a label fits inside a bar, so an estimate is enough — and erring
 * wide just moves a borderline label outside, which is the safe direction.
 */
const CHAR_W = 7.8;
/**
 * A bar shorter than this fraction of the axis stops reading as a bar once
 * there is a number inside it — it reads as a chip. The same reason as the
 * floor `INLINE_LABEL_MIN_PCT` sets on segments in `MarksLostBar`.
 */
const INLINE_MIN_AXIS_FRACTION = 0.2;

/** The input half of the comparison is deliberately un-hued. */
const TIME_FILL = "color-mix(in oklab, var(--foreground) 32%, transparent)";
/**
 * `--foreground` on `TIME_FILL` clears 6.5:1 in both themes — the fill is a 32%
 * tint of the foreground over the card, so it lands mid-scale either way.
 */
const TIME_INK = "var(--foreground)";
const SUBJECT_KEY_FILL =
  "linear-gradient(90deg, var(--subject-physics) 0 33.33%, var(--subject-chemistry) 33.33% 66.66%, var(--subject-maths) 66.66% 100%)";

/**
 * Bars grow once, outward from the centre, the first time the chart scrolls
 * into view; rows follow each other by a beat. Values arrive only after their
 * bar has, so a number is never seen sitting on a mark still in motion.
 * `MotionConfig reducedMotion="user"` turns the growth into a cut.
 */
const ROW_STEP = 0.08;
const grow: Variants = {
  hidden: { scaleX: 0 },
  show: (row: number) => ({
    scaleX: 1,
    transition: { duration: 0.55, ease: EASE_OUT_SOFT, delay: ROW_STEP * row },
  }),
};
const arrive: Variants = {
  hidden: { opacity: 0 },
  show: (row: number) => ({
    opacity: 1,
    transition: { duration: 0.2, delay: ROW_STEP * row + 0.4 },
  }),
};

interface Row extends SubjectBreakdown {
  color: string;
  ink?: string;
  label: string;
  gap: number;
}

/**
 * The neglect chart. Study-time share grows left from the centre, marks-lost
 * share grows right, on one shared scale — so a subject that takes little time
 * and costs many marks is a visibly lopsided row rather than two numbers a
 * reader has to hold in their head.
 *
 * The two bars are the same subject hue at two opacities: they are two measures
 * of one entity, not two categories, and the row labels carry which is which.
 *
 * Kept hand-built rather than moved to Recharts. A diverging pair with a text
 * column down the middle is two charts to Recharts, glued at a seam, and the
 * label placement below depends on knowing each bar's length in pixels — which
 * is exactly what a layout we own can tell us and a library's cannot.
 */
export function NeglectChart({ rows }: { rows: SubjectBreakdown[] }) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const [active, setActive] = useState<string | null>(null);

  const data = useMemo<Row[]>(
    () =>
      rows.map((row) => {
        const token = resolveSubject(row.subject);
        return {
          ...row,
          color: token.color,
          ink: token.ink,
          label: token.label,
          gap: row.marks_lost_share_pct - row.time_share_pct,
        };
      }),
    [rows],
  );

  const max = useMemo(() => {
    const peak = data.reduce(
      (acc, row) => Math.max(acc, row.time_share_pct, row.marks_lost_share_pct),
      0,
    );
    return Math.max(50, Math.ceil(peak / 10) * 10);
  }, [data]);

  const worst = useMemo(
    () => data.reduce<Row | null>((acc, row) => (!acc || row.gap > acc.gap ? row : acc), null),
    [data],
  );

  /** Pixels available to one half of the diverging axis. 0 before first paint. */
  const halfWidth = Math.max(0, (width - CENTRE_W - 2 * GAP) / 2);

  return (
    <Figure
      title="Where the time goes vs where the marks go"
      subtitle="Share of study hours against share of marks lost, on one scale. A short grey bar beside a long coloured bar is a subject being neglected."
      legend={
        <Legend
          items={[
            { color: TIME_FILL, label: "Share of study time", shape: "block" },
            {
              color: SUBJECT_KEY_FILL,
              label: "Share of marks lost, by subject",
              shape: "block",
              wide: true,
            },
          ]}
        />
      }
      table={
        <FigureTable
          head={
            <>
              <th scope="col" className="py-2 pr-4 font-medium">Subject</th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">Study time</th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">Marks lost</th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">Gap</th>
              <th scope="col" className="py-2 text-right font-medium">Accuracy</th>
            </>
          }
        >
          {data.map((row) => (
            <tr key={row.subject}>
              <th scope="row" className="py-1.5 pr-4 text-left font-normal">
                {row.label}
              </th>
              <td className="py-1.5 pr-4 text-right">{pct(row.time_share_pct, 1)}</td>
              <td className="py-1.5 pr-4 text-right">
                {pct(row.marks_lost_share_pct, 1)}
              </td>
              <td className="py-1.5 pr-4 text-right font-medium">
                {signed(row.gap, 1)} pts
              </td>
              <td className="py-1.5 text-right">{pct(row.accuracy_pct, 1)}</td>
            </tr>
          ))}
        </FigureTable>
      }
      footnote={
        worst && worst.gap > 0 ? (
          <>
            <strong className="font-semibold text-foreground">{worst.label}</strong>{" "}
            takes {pct(worst.time_share_pct)} of the study hours and accounts for{" "}
            {pct(worst.marks_lost_share_pct)} of the marks lost — a{" "}
            {num(Math.abs(worst.gap))}-point gap. That is where study time looks
            most clearly under-spent.
          </>
        ) : (
          "Effort and loss are broadly in proportion across all three subjects."
        )
      }
    >
      <div ref={ref} className="my-auto pt-1">
        <div
          className="mb-2.5 grid items-end gap-x-3"
          style={{ gridTemplateColumns: COLUMNS }}
        >
          <div className="text-right text-xs font-medium text-muted-foreground">
            ← Share of study time
          </div>
          <div />
          <div className="text-xs font-medium text-muted-foreground">
            Share of marks lost →
          </div>
        </div>

        <motion.ul
          className="space-y-2"
          initial="hidden"
          whileInView="show"
          viewport={revealViewport}
          onMouseLeave={() => setActive(null)}
        >
          {data.map((row, i) => {
            const isActive = active === row.subject;
            return (
              <li
                key={row.subject}
                tabIndex={0}
                aria-label={`${row.label}: ${pct(row.time_share_pct)} of study time, ${pct(row.marks_lost_share_pct)} of marks lost, a ${signed(row.gap)}-point gap. ${pct(row.accuracy_pct)} accuracy.`}
                onMouseEnter={() => setActive(row.subject)}
                onFocus={() => setActive(row.subject)}
                onBlur={() => setActive(null)}
                className={cn(
                  "relative grid items-center gap-x-3 rounded-md py-1 outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-ring",
                  active && !isActive ? "opacity-40" : "",
                )}
                style={{ gridTemplateColumns: COLUMNS }}
              >
                {/* Left half — grows leftward from the centre baseline. */}
                <Half
                  side="left"
                  row={i}
                  value={row.time_share_pct}
                  max={max}
                  halfWidth={halfWidth}
                  fill={TIME_FILL}
                  ink={TIME_INK}
                />

                <div className="min-w-0 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-[2px]"
                      style={{ background: row.color }}
                    />
                    <span className="truncate text-xs font-medium text-foreground">
                      {row.label}
                    </span>
                  </div>
                  <div className="tnum text-xs text-muted-foreground">
                    {pct(row.accuracy_pct)} accuracy
                  </div>
                </div>

                {/* Right half — grows rightward from the centre baseline. */}
                <Half
                  side="right"
                  row={i}
                  value={row.marks_lost_share_pct}
                  max={max}
                  halfWidth={halfWidth}
                  fill={row.color}
                  ink={row.ink}
                />

                <AnimatePresence>
                  {isActive ? <RowTooltip row={row} /> : null}
                </AnimatePresence>
              </li>
            );
          })}
        </motion.ul>

        <div
          className="mt-2.5 grid gap-x-3 text-xs text-muted-foreground"
          style={{ gridTemplateColumns: COLUMNS }}
        >
          <div className="tnum text-left">{max}%</div>
          <div className="text-center">0</div>
          <div className="tnum text-right">{max}%</div>
        </div>
      </div>
    </Figure>
  );
}

/**
 * The row's numbers side by side, with the one the chart is about — the gap —
 * set in weight. It floats above the row's name, so it covers the row before,
 * which is dimmed while this one is read.
 */
function RowTooltip({ row }: { row: Row }) {
  return (
    <motion.div
      aria-hidden
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: transition.fast }}
      transition={transition.fast}
      className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 w-48 -translate-x-1/2 rounded-lg border border-border bg-popover p-2.5 text-xs shadow-overlay"
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className="size-2.5 shrink-0 rounded-[2px]"
          style={{ background: row.color }}
        />
        <span className="font-medium text-popover-foreground">{row.label}</span>
      </div>
      <dl className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="size-2 shrink-0 rounded-[2px]" style={{ background: TIME_FILL }} />
          <dt className="flex-1 text-muted-foreground">Study time</dt>
          <dd className="tnum font-medium text-popover-foreground">
            {pct(row.time_share_pct, 1)}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <span className="size-2 shrink-0 rounded-[2px]" style={{ background: row.color }} />
          <dt className="flex-1 text-muted-foreground">Marks lost</dt>
          <dd className="tnum font-medium text-popover-foreground">
            {pct(row.marks_lost_share_pct, 1)}
          </dd>
        </div>
        <div className="flex items-center gap-2 border-t border-border pt-1">
          <dt className="flex-1 pl-4 text-muted-foreground">Gap</dt>
          <dd className="tnum font-semibold text-popover-foreground">
            {signed(row.gap, 1)} pts
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="flex-1 pl-4 text-muted-foreground">Accuracy</dt>
          <dd className="tnum font-medium text-popover-foreground">
            {pct(row.accuracy_pct, 1)}
          </dd>
        </div>
      </dl>
    </motion.div>
  );
}

/**
 * One bar plus its value label.
 *
 * The label sits **inside** the bar, at the bar's outer tip, whenever the bar
 * is long enough to hold it — and moves **outside**, immediately beyond that
 * same tip, when it is not. Chemistry at an 11% time share is the case that
 * forces the branch: at most real widths that bar is about thirty pixels long,
 * and a number set inside it either overflows the fill or is clipped by it.
 *
 * Both placements are measured from the tip itself, not left to flow layout:
 * the bar is positioned against the centre edge of a full-width track, and an
 * outside label is positioned at `bar length + inset` on that same track. A
 * label therefore cannot drift from a short bar whatever the row's width, the
 * text's width or the other half are doing — which is how it used to detach.
 *
 * Two things make the flip invisible rather than jarring:
 *
 *   - the label moves by `LABEL_INSET` pixels, not across the row, because both
 *     placements are anchored to the same tip. It stays attached to its bar.
 *   - the ink changes with the surface underneath it. Inside, it is the ink
 *     verified against that fill (`--subject-*-ink`, or `--foreground` on the
 *     un-hued time fill). Outside, it is `--foreground` on the card. A label
 *     that kept its on-fill ink after moving off the fill is the actual bug —
 *     `--subject-chemistry-ink` is near-black, and near-black on the card in
 *     dark mode is invisible.
 *
 * `halfWidth` of 0 (before the first measure) puts every label outside, which
 * is the branch that is always legible.
 */
function Half({
  side,
  row,
  value,
  max,
  halfWidth,
  fill,
  ink,
}: {
  side: "left" | "right";
  /** Position in the list; staggers the entrance. */
  row: number;
  value: number;
  max: number;
  halfWidth: number;
  fill: string;
  /** Verified ink for this fill. Absent means the label can never go inside. */
  ink?: string;
}) {
  const text = pct(value);
  const fraction = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const barPx = fraction * halfWidth;
  const needed = text.length * CHAR_W + 2 * LABEL_INSET;
  const inside =
    ink !== undefined &&
    barPx >= needed &&
    fraction >= INLINE_MIN_AXIS_FRACTION;
  const left = side === "left";
  const length = `${fraction * 100}%`;

  const label = (
    <motion.span
      data-label-placement={inside ? "inside" : "outside"}
      variants={arrive}
      custom={row}
      className={cn(
        "tnum text-xs leading-none font-medium whitespace-nowrap",
        // Inside: in flow, above the absolutely-placed fill. Outside: placed
        // on the track at the tip, centred on the bar's own midline.
        inside ? "relative" : "absolute top-1/2 -translate-y-1/2",
      )}
      style={{
        color: inside ? ink : "var(--foreground)",
        ...(inside
          ? null
          : left
            ? { right: `calc(${length} + ${LABEL_INSET}px)` }
            : { left: `calc(${length} + ${LABEL_INSET}px)` }),
      }}
    >
      {text}
    </motion.span>
  );

  // The outer tip is the left edge on the left half and the right edge on the
  // right half, so an inside label is pinned to that end of its bar.
  return (
    <div className="relative min-w-0" style={{ height: BAR_H }}>
      <div
        className={cn(
          "absolute inset-y-0 flex items-center",
          left ? "right-0 justify-start" : "left-0 justify-end",
        )}
        style={{ width: length, paddingInline: inside ? LABEL_INSET : 0 }}
      >
        <motion.div
          aria-hidden
          variants={grow}
          custom={row}
          className={cn(
            "absolute inset-0",
            left ? "origin-right rounded-l-[4px]" : "origin-left rounded-r-[4px]",
          )}
          style={{ background: fill }}
        />
        {inside ? label : null}
      </div>
      {inside ? null : label}
    </div>
  );
}
