import { useMemo } from "react";
import type { SubjectBreakdown } from "@/api/types";
import { useMeasure } from "@/hooks/use-measure";
import { num, pct, signed } from "@/lib/format";
import { resolveSubject } from "@/lib/subjects";
import { Figure, FigureTable, Legend } from "./Figure";

const BAR_H = 18;
/** The fixed centre column carrying the subject name. Style and maths share it. */
const CENTRE_W = 104;
/** `gap-x-3`, in pixels. Both gaps sit between the centre column and a half. */
const GAP = 12;
/** Inset either side of a label that sits inside its own bar. */
const LABEL_INSET = 6;
/**
 * Rough advance width of one character of `tnum` at 11px. Used only to decide
 * whether a label fits inside a bar, so an estimate is enough — and erring
 * wide just moves a borderline label outside, which is the safe direction.
 */
const CHAR_W = 6.6;
/**
 * A bar shorter than this fraction of the axis stops reading as a bar once
 * there is a number inside it — it reads as a chip. Same rule, and the same
 * reason, as `INLINE_LABEL_MIN_PCT` in `MarksLostBar`.
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
 */
export function NeglectChart({ rows }: { rows: SubjectBreakdown[] }) {
  const { ref, width } = useMeasure<HTMLDivElement>();

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
            {num(Math.abs(worst.gap))}-point gap. That is the cheapest hour
            available on this timetable.
          </>
        ) : (
          "Effort and loss are broadly in proportion across all three subjects."
        )
      }
    >
      <div ref={ref} className="pt-1">
        <div className="mb-2 grid grid-cols-[1fr_auto_1fr] items-end gap-x-3">
          <div className="text-right text-[11px] font-medium text-muted-foreground">
            ← Share of study time
          </div>
          <div style={{ width: CENTRE_W }} />
          <div className="text-[11px] font-medium text-muted-foreground">
            Share of marks lost →
          </div>
        </div>

        <ul className="space-y-3">
          {data.map((row) => (
            <li
              key={row.subject}
              className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-3"
            >
              {/* Left half — grows leftward from the centre baseline. */}
              <Half
                side="left"
                value={row.time_share_pct}
                max={max}
                halfWidth={halfWidth}
                fill={TIME_FILL}
                ink={TIME_INK}
              />

              <div style={{ width: CENTRE_W }} className="text-center">
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
                <div className="tnum text-[10px] text-muted-foreground">
                  {pct(row.accuracy_pct)} accuracy
                </div>
              </div>

              {/* Right half — grows rightward from the centre baseline. */}
              <Half
                side="right"
                value={row.marks_lost_share_pct}
                max={max}
                halfWidth={halfWidth}
                fill={row.color}
                ink={row.ink}
              />
            </li>
          ))}
        </ul>

        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] gap-x-3 text-[10px] text-muted-foreground">
          <div className="tnum text-left">{max}%</div>
          <div style={{ width: CENTRE_W }} className="text-center">0</div>
          <div className="tnum text-right">{max}%</div>
        </div>
      </div>
    </Figure>
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
  value,
  max,
  halfWidth,
  fill,
  ink,
}: {
  side: "left" | "right";
  value: number;
  max: number;
  halfWidth: number;
  fill: string;
  /** Verified ink for this fill. Absent means the label can never go inside. */
  ink?: string;
}) {
  const text = pct(value);
  const barPx = (value / max) * halfWidth;
  const needed = text.length * CHAR_W + 2 * LABEL_INSET;
  const inside =
    ink !== undefined &&
    barPx >= needed &&
    value / max >= INLINE_MIN_AXIS_FRACTION;

  const label = (
    <span
      data-label-placement={inside ? "inside" : "outside"}
      className="tnum shrink-0 text-[11px] font-medium"
      style={{ color: inside ? ink : "var(--foreground)" }}
    >
      {text}
    </span>
  );

  const bar = (
    <div
      className={`flex shrink-0 items-center ${
        side === "left" ? "justify-start rounded-l-[4px]" : "justify-end rounded-r-[4px]"
      }`}
      style={{
        width: `${(value / max) * 100}%`,
        height: BAR_H,
        background: fill,
        paddingInline: inside ? LABEL_INSET : 0,
      }}
    >
      {inside ? label : null}
    </div>
  );

  // The outer tip is the left edge on the left half and the right edge on the
  // right half, so an outside label leads on the left and trails on the right.
  return (
    <div
      className={`flex min-w-0 items-center gap-1.5 ${
        side === "left" ? "justify-end" : ""
      }`}
    >
      {side === "left" ? (
        <>
          {inside ? null : label}
          {bar}
        </>
      ) : (
        <>
          {bar}
          {inside ? null : label}
        </>
      )}
    </div>
  );
}
