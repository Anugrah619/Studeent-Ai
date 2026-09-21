import { useMemo, useState } from "react";
import type { MockScore } from "@/api/types";
import { useMeasure } from "@/hooks/use-measure";
import { num, shortDate, signed } from "@/lib/format";
import { SUBJECT_LIST, type SubjectKey } from "@/lib/subjects";
import { Figure, FigureTable, Legend } from "./Figure";

const PAD = { top: 14, right: 46, bottom: 26, left: 32 };
const PLOT_H = 208;
const MAX = 100;

interface Props {
  rows: MockScore[];
  /** The series the chart is arguing about — the only one direct-labelled. */
  highlight?: SubjectKey;
}

/**
 * Three subject series on ONE axis (each subject is out of 100, so no second
 * scale is ever tempting). Identity is carried by the legend plus the tooltip;
 * only the series the story is about gets a direct end-label, because Physics
 * and Maths converge at the right edge and stacked labels would detach from
 * their lines.
 */
export function MockTrendChart({ rows, highlight }: Props) {
  const { ref, width } = useMeasure<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const lead = useMemo<SubjectKey>(() => {
    if (highlight) return highlight;
    if (rows.length < 2) return "chemistry";
    let worst: SubjectKey = "physics";
    let worstDelta = Infinity;
    for (const subject of SUBJECT_LIST) {
      const delta = rows[rows.length - 1][subject.key] - rows[0][subject.key];
      if (delta < worstDelta) {
        worstDelta = delta;
        worst = subject.key;
      }
    }
    return worst;
  }, [rows, highlight]);

  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const x = (i: number) =>
    PAD.left + (rows.length <= 1 ? innerW / 2 : (innerW * i) / (rows.length - 1));
  const y = (value: number) => PAD.top + (1 - value / MAX) * PLOT_H;
  const height = PAD.top + PLOT_H + PAD.bottom;

  const last = rows[rows.length - 1];
  const first = rows[0];

  const legendItems = SUBJECT_LIST.map((subject) => ({
    color: subject.color,
    label: subject.label,
    shape: "line" as const,
    value: last
      ? `${num(last[subject.key])} (${signed(last[subject.key] - first[subject.key])})`
      : undefined,
  }));

  return (
    <Figure
      title="Mock score trend"
      subtitle={
        <>
          Each subject is marked out of 100 across {rows.length} mocks. Total{" "}
          {first && last ? (
            <>
              moved {num(first.total)} → {num(last.total)} (
              <strong className="font-semibold text-foreground">
                {signed(last.total - first.total)}
              </strong>
              ).
            </>
          ) : null}
        </>
      }
      legend={<Legend items={legendItems} />}
      table={
        <FigureTable
          head={
            <>
              <th scope="col" className="py-2 pr-4 font-medium">Mock</th>
              <th scope="col" className="py-2 pr-4 font-medium">Date</th>
              {SUBJECT_LIST.map((s) => (
                <th key={s.key} scope="col" className="py-2 pr-4 text-right font-medium">
                  {s.label}
                </th>
              ))}
              <th scope="col" className="py-2 text-right font-medium">Total</th>
            </>
          }
        >
          {rows.map((row) => (
            <tr key={row.paper_id}>
              <th scope="row" className="py-1.5 pr-4 text-left font-normal">
                {row.paper_name}
              </th>
              <td className="py-1.5 pr-4 text-muted-foreground">
                {shortDate(row.held_on)}
              </td>
              {SUBJECT_LIST.map((s) => (
                <td key={s.key} className="py-1.5 pr-4 text-right">
                  {num(row[s.key])}
                </td>
              ))}
              <td className="py-1.5 text-right font-medium">{num(row.total)}</td>
            </tr>
          ))}
        </FigureTable>
      }
    >
      <div ref={ref} className="relative w-full">
        {width > 0 ? (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`Mock score trend across ${rows.length} mocks for Physics, Chemistry and Maths.`}
            className="overflow-visible"
            onMouseLeave={() => setActive(null)}
          >
            {/* Hairline grid, solid, one step off the surface. */}
            {[0, 25, 50, 75, 100].map((tick) => (
              <g key={tick}>
                <line
                  x1={PAD.left}
                  x2={PAD.left + innerW}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke="var(--chart-grid)"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <text
                  x={PAD.left - 8}
                  y={y(tick)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="tnum fill-muted-foreground text-[10px]"
                >
                  {tick}
                </text>
              </g>
            ))}

            {rows.map((row, i) => (
              <text
                key={row.paper_id}
                x={x(i)}
                y={PAD.top + PLOT_H + 16}
                textAnchor="middle"
                className="tnum fill-muted-foreground text-[10px]"
              >
                {row.paper_name.replace(/^\D+/, "")}
              </text>
            ))}

            {active !== null ? (
              <line
                x1={x(active)}
                x2={x(active)}
                y1={PAD.top}
                y2={PAD.top + PLOT_H}
                stroke="var(--chart-axis)"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
            ) : null}

            {SUBJECT_LIST.map((subject) => {
              const d = rows
                .map((row, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(row[subject.key])}`)
                .join(" ");
              const dim = active !== null;
              return (
                <g key={subject.key}>
                  <path
                    d={d}
                    fill="none"
                    stroke={subject.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    opacity={dim && subject.key !== lead ? 0.85 : 1}
                  />
                  {/* End marker: >=8px, with a 2px surface ring. */}
                  {last ? (
                    <circle
                      cx={x(rows.length - 1)}
                      cy={y(last[subject.key])}
                      r={4}
                      fill={subject.color}
                      stroke="var(--chart-surface)"
                      strokeWidth={2}
                    />
                  ) : null}
                </g>
              );
            })}

            {/* Selective direct label: only the series the chart argues about. */}
            {last ? (
              <text
                x={x(rows.length - 1) + 10}
                y={y(last[lead])}
                dominantBaseline="middle"
                className="tnum fill-foreground text-[11px] font-semibold"
              >
                {num(last[lead])}
              </text>
            ) : null}

            {active !== null
              ? SUBJECT_LIST.map((subject) => (
                  <circle
                    key={subject.key}
                    cx={x(active)}
                    cy={y(rows[active][subject.key])}
                    r={4}
                    fill={subject.color}
                    stroke="var(--chart-surface)"
                    strokeWidth={2}
                  />
                ))
              : null}

            {/* Generous hit bands — never make the reader land on a 4px dot. */}
            {rows.map((row, i) => (
              <rect
                key={row.paper_id}
                x={x(i) - Math.max(12, innerW / (rows.length * 2))}
                y={PAD.top}
                width={Math.max(24, innerW / rows.length)}
                height={PLOT_H}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${row.paper_name}: Physics ${row.physics}, Chemistry ${row.chemistry}, Maths ${row.maths}, total ${row.total}`}
                className="cursor-pointer outline-none focus-visible:fill-foreground/5"
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              />
            ))}
          </svg>
        ) : (
          <div style={{ height }} />
        )}

        {active !== null && width > 0 ? (
          <TrendTooltip
            row={rows[active]}
            left={x(active)}
            width={width}
          />
        ) : null}
      </div>
    </Figure>
  );
}

function TrendTooltip({
  row,
  left,
  width,
}: {
  row: MockScore;
  left: number;
  width: number;
}) {
  const flip = left > width * 0.6;
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-0 z-10 w-44 rounded-lg border border-border bg-popover p-2.5 text-xs shadow-lg"
      style={
        flip
          ? { right: Math.max(0, width - left + 12) }
          : { left: Math.min(left + 12, width - 180) }
      }
    >
      <div className="font-medium text-popover-foreground">{row.paper_name}</div>
      <div className="mb-1.5 text-[11px] text-muted-foreground">
        {shortDate(row.held_on)}
      </div>
      <dl className="space-y-1">
        {SUBJECT_LIST.map((subject) => (
          <div key={subject.key} className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ background: subject.color }}
            />
            <dt className="flex-1 text-muted-foreground">{subject.label}</dt>
            <dd className="tnum font-medium text-popover-foreground">
              {num(row[subject.key])}
            </dd>
          </div>
        ))}
        <div className="flex items-center gap-2 border-t border-border pt-1">
          <dt className="flex-1 pl-4 text-muted-foreground">Total</dt>
          <dd className="tnum font-semibold text-popover-foreground">
            {num(row.total)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
