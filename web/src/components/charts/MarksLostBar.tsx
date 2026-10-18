import { useState, type CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import type { MarksLost } from "@/api/types";
import { useMeasure } from "@/hooks/use-measure";
import { num, pct } from "@/lib/format";
import {
  causeSlices,
  marksLostTotals,
  type CauseKey,
  type CauseSlice,
} from "@/lib/causes";
import { EASE_OUT_SOFT, revealViewport, transition } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Figure, FigureTable, Legend } from "./Figure";

const BAR_H = 44;
/**
 * Below this share a segment is a sliver, and a number set inside it reads as
 * a chip rather than as the segment's value — however wide the bar is.
 */
const INLINE_LABEL_MIN_PCT = 6;
/**
 * Above it, the segment's measured width decides: a number goes inside only
 * with `INLINE_INSET` clear either side. `DIGIT_W` is a rough advance for one
 * 12px semibold `tnum` digit, erring wide. Before the first measure the rule
 * falls back to a share that holds at phone width.
 */
const DIGIT_W = 7.4;
const INLINE_INSET = 8;
const UNMEASURED_INLINE_PCT = 11;
/** `w-64`. The tooltip is centred on its segment, then kept inside the bar. */
const TIP_W = 256;

/**
 * Ink for an inline number in the DARK theme, where it differs from the one in
 * `lib/causes`. The dark cause ramp is stepped lighter so it holds against the
 * dark card, and white on its two middle steps falls to 3.2:1 and 2.2:1. The
 * ramp's own near-black clears 5.5:1 and 8.0:1 on them. The darkest step keeps
 * white (4.8:1), and the two lightest already use dark ink in both themes.
 */
const DARK_INK: Partial<Record<CauseKey, string>> = {
  execution_error: "#1c1428",
  time_exhaustion: "#1c1428",
};

/**
 * The reveal. Driven from the unclipped wrapper, not the bar: Chromium counts
 * a target's own clip-path when deciding whether it is in view, so a bar that
 * starts fully clipped would never be "seen" and never be drawn.
 */
const wipe: Variants = {
  hidden: { clipPath: "inset(0 100% 0 0)" },
  show: {
    clipPath: "inset(0 0% 0 0)",
    transition: { duration: 0.7, ease: EASE_OUT_SOFT },
  },
};
/** The rail arrives once the bar has, so the argument follows the picture. */
const afterWipe: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.25, delay: 0.55 } },
};

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
 *
 * Kept as HTML rather than a Recharts stacked bar: each segment is a real
 * button that speaks its own value, and the rail must share the bar's exact
 * flex geometry to line up with the segment boundaries. Motion adds one
 * left-to-right reveal, in cause order, the first time the bar is in view.
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
  const reduce = useReducedMotion() ?? false;
  const { ref, width } = useMeasure<HTMLDivElement>();
  const slices = causeSlices(data);
  const totals = marksLostTotals(data);

  // Where the hovered segment's centre falls, in pixels, with the tooltip
  // then kept inside the bar so the end segments do not push it off the card.
  const tipLeft = (() => {
    if (!hover || width <= 0) return 0;
    let start = 0;
    for (const slice of slices) {
      if (slice.key === hover.key) break;
      start += slice.sharePct;
    }
    const centre = ((start + hover.sharePct / 2) / 100) * width;
    return Math.min(Math.max(0, centre - TIP_W / 2), Math.max(0, width - TIP_W));
  })();

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
          Cause is inferred from each answer&rsquo;s status, the time it took and
          the student&rsquo;s current mastery of the chapter — a wrong answer on a
          chapter the student knows is an execution error, not a gap in
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
          of those went to chapters where their mastery is low;{" "}
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
              are left uncalled: they have barely attempted those chapters, and a
              guess there would be worse than a blank.
            </>
          ) : null}
        </>
      }
    >
      <motion.div
        ref={ref}
        className="relative pt-1"
        initial={reduce ? false : "hidden"}
        whileInView="show"
        viewport={revealViewport}
      >
        {/* One wipe, left to right: the causes arrive in the order the ramp
            argues them — hardest to fix first — and the grey bucket last. */}
        <motion.div
          className="flex w-full gap-[2px]"
          style={{ height: BAR_H }}
          variants={wipe}
          onMouseLeave={() => setHover(null)}
        >
          {slices.map((slice, i) => {
            const segmentPx = (slice.sharePct / 100) * width - 2;
            const showInline =
              slice.sharePct >= INLINE_LABEL_MIN_PCT &&
              (width > 0
                ? segmentPx >= num(slice.marks).length * DIGIT_W + 2 * INLINE_INSET
                : slice.sharePct >= UNMEASURED_INLINE_PCT);
            return (
              <button
                key={slice.key}
                type="button"
                aria-label={`${slice.label}: ${num(slice.marks)} marks, ${pct(slice.sharePct, 1)} of all marks lost. ${slice.meaning}.`}
                onMouseEnter={() => setHover(slice)}
                onFocus={() => setHover(slice)}
                onBlur={() => setHover(null)}
                className={cn(
                  // Inset ring: the reveal clips at the bar's edge, and an
                  // outer ring there would be cut off.
                  "relative flex items-center justify-center outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  i === slices.length - 1 ? "rounded-r-[4px]" : "",
                  hover && hover.key !== slice.key ? "opacity-60" : "",
                )}
                style={{
                  flexBasis: `${slice.sharePct}%`,
                  background: slice.color,
                }}
              >
                {showInline ? (
                  <span
                    className="tnum text-xs font-semibold text-(--ink) dark:text-(--ink-dark)"
                    style={
                      {
                        "--ink": slice.ink,
                        "--ink-dark": DARK_INK[slice.key] ?? slice.ink,
                      } as CSSProperties
                    }
                  >
                    {num(slice.marks)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </motion.div>

        {/* The rail that carries the argument.
            Its first two sections span only the *explained* part of the bar,
            because that is the denominator the server divides by. The third is
            the grey bucket, given a section and a sentence of its own — it is
            the largest number on most papers and hiding it would make every
            other number on this screen less believable, not more. */}
        <motion.div
          className="mt-2.5 flex w-full gap-[2px]"
          variants={afterWipe}
        >
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
        </motion.div>

        <AnimatePresence>
          {hover ? (
            <motion.div
              key="tip"
              role="status"
              initial={{ opacity: 0, x: tipLeft, y: 4 }}
              animate={{ opacity: 1, x: tipLeft, y: 0 }}
              exit={{ opacity: 0, transition: transition.fast }}
              transition={transition.fast}
              // Lifted above the bar by its own height. Tailwind's translate is
              // the CSS `translate` property, so it composes with the transform
              // motion animates instead of being overwritten by it.
              className="pointer-events-none absolute top-0 left-0 z-10 -mt-2 -translate-y-full rounded-lg border border-border bg-popover p-3 text-xs shadow-overlay"
              style={{ width: TIP_W }}
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
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>
    </Figure>
  );
}
