import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
  usePlotArea,
  useXAxisScale,
} from "recharts";
import type { MockScore } from "@/api/types";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { useMeasure } from "@/hooks/use-measure";
import { num, shortDate, signed } from "@/lib/format";
import { SUBJECT_LIST, type SubjectKey } from "@/lib/subjects";
import { Figure, FigureTable, Legend } from "./Figure";

/** The floor. In a two-up row the plot grows to fill whatever its neighbour sets. */
const PLOT_H = 248;
const TICKS = [0, 25, 50, 75, 100];
/**
 * One draw, left to right, on mount. Longer than a UI transition on purpose: a
 * line that arrives in 200 ms reads as a flicker, and the eye should travel the
 * series once in the direction time runs. It never replays.
 */
const DRAW_MS = 650;

/**
 * Subject identity comes from the same tokens as every other subject mark, so
 * the lines can never drift from the legend, the neglect chart or a swatch.
 * Never the brand: it is chrome-only and must not read as a series.
 */
const CONFIG = Object.fromEntries(
  SUBJECT_LIST.map((subject) => [
    subject.key,
    { label: subject.label, color: subject.color },
  ]),
) satisfies ChartConfig;

interface Props {
  rows: MockScore[];
  /** The series the chart is arguing about — the only one direct-labelled. */
  highlight?: SubjectKey;
}

/** "AIT Mock 08" → "08": the axis carries the mock number, the tooltip the name. */
const tickLabel = (row: MockScore) => row.paper_name.replace(/^\D+/, "") || row.paper_name;

const spoken = (row: MockScore) =>
  `${row.paper_name}: Physics ${row.physics}, Chemistry ${row.chemistry}, Maths ${row.maths}, total ${row.total}`;

/**
 * Three subject series on ONE axis (each subject is out of 100, so no second
 * scale is ever tempting). Identity is carried by the legend plus the tooltip;
 * only the series the story is about gets a direct end-label, because Physics
 * and Maths converge at the right edge and stacked labels would detach from
 * their lines.
 *
 * Drawn with Recharts (shadcn's chart wrapper) for the crosshair tooltip, the
 * keyboard layer — focus the plot and the arrow keys step mock by mock — and a
 * single left-to-right draw on mount, which is skipped under reduced motion.
 */
export function MockTrendChart({ rows, highlight }: Props) {
  const reduce = useReducedMotion() ?? false;
  // Measured before paint so the first frame is drawn at the real width. The
  // container's default 320px guess would otherwise flash, then morph.
  const { ref, width } = useMeasure<HTMLDivElement>();
  // The chart sits below the fold on Student 360. Drawn on mount, its one
  // animation would play to an empty viewport; drawn on arrival, it is seen.
  const [seen, setSeen] = useState(false);

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

  const byId = useMemo(
    () => new Map(rows.map((row) => [row.paper_id, row])),
    [rows],
  );

  const last = rows[rows.length - 1];
  const first = rows[0];
  const lastIndex = rows.length - 1;

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
          Physics, Chemistry and Maths across {rows.length} mocks. Total{" "}
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
      {/* The plot is absolutely positioned inside a box that flexes to fill
          the figure. Out of flow, its measured pixel height can never hold the
          box open, so the row it shares can shrink again as well as grow. */}
      <motion.div
        ref={ref}
        className="relative w-full flex-1"
        style={{ minHeight: PLOT_H }}
        viewport={{ once: true, amount: 0.3 }}
        onViewportEnter={() => setSeen(true)}
      >
        {width > 0 && seen ? (
          <ChartContainer
            config={CONFIG}
            initialDimension={{ width, height: PLOT_H }}
            // shadcn's container hides the surface's outline outright, which
            // would leave a keyboard user on the plot with no sign of focus.
            className="absolute inset-0 aspect-auto [font-variant-numeric:tabular-nums] [&_.recharts-surface:focus-visible]:rounded-sm [&_.recharts-surface:focus-visible]:outline-2 [&_.recharts-surface:focus-visible]:outline-solid [&_.recharts-surface:focus-visible]:outline-offset-2 [&_.recharts-surface:focus-visible]:outline-ring"
          >
            <LineChart
              data={rows}
              margin={{ top: 12, right: 34, bottom: 0, left: 0 }}
              role="group"
              aria-label={`Mock score trend across ${rows.length} mocks for Physics, Chemistry and Maths. Focus the chart and use the arrow keys to step through the mocks; the table view lists every value.`}
            >
              {/* Hairline grid, solid, one step off the surface. Horizontal
                  only: the mocks are discrete events, not a time grid. */}
              <CartesianGrid
                vertical={false}
                stroke="var(--chart-grid)"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <XAxis
                dataKey="paper_id"
                type="category"
                interval={0}
                tickLine={false}
                axisLine={false}
                tickMargin={10}
                padding={{ left: 10, right: 10 }}
                tick={{ fontSize: 10 }}
                tickFormatter={(id: number) => {
                  const row = byId.get(id);
                  return row ? tickLabel(row) : "";
                }}
              />
              <YAxis
                domain={[0, 100]}
                ticks={TICKS}
                interval={0}
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                width={30}
                tick={{ fontSize: 10 }}
              />
              <ChartTooltip
                cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
                isAnimationActive={!reduce}
                animationDuration={150}
                offset={14}
                content={({ active, payload }) => (
                  <TrendTooltip
                    active={active}
                    row={payload?.[0]?.payload as MockScore | undefined}
                  />
                )}
              />

              {SUBJECT_LIST.map((subject) => (
                <Line
                  key={subject.key}
                  dataKey={subject.key}
                  name={subject.label}
                  type="linear"
                  stroke={`var(--color-${subject.key})`}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  isAnimationActive={!reduce}
                  animationDuration={DRAW_MS}
                  animationEasing="ease-out"
                  // End marker only: >=8px, with a 2px surface ring. A dot on
                  // every mock would compete with the line for the eye.
                  dot={(props: { cx?: number; cy?: number; index?: number }) =>
                    props.index === lastIndex && props.cx != null && props.cy != null ? (
                      <circle
                        key={`end-${subject.key}`}
                        cx={props.cx}
                        cy={props.cy}
                        r={4}
                        fill={subject.color}
                        stroke="var(--chart-surface)"
                        strokeWidth={2}
                      />
                    ) : (
                      <g key={`dot-${subject.key}-${props.index}`} />
                    )
                  }
                  activeDot={{
                    r: 4.5,
                    fill: subject.color,
                    stroke: "var(--chart-surface)",
                    strokeWidth: 2,
                  }}
                  // Selective direct label: only the series the chart argues about.
                  label={
                    subject.key === lead
                      ? (props: { x?: number | string; y?: number | string; index?: number; value?: unknown }) =>
                          props.index === lastIndex ? (
                            <text
                              key={`label-${subject.key}`}
                              x={Number(props.x) + 10}
                              y={Number(props.y)}
                              dominantBaseline="middle"
                              className="fill-foreground text-[11px] font-semibold"
                            >
                              {num(Number(props.value))}
                            </text>
                          ) : null
                      : false
                  }
                />
              ))}

              <MockTargets rows={rows} />
            </LineChart>
          </ChartContainer>
        ) : null}
      </motion.div>
    </Figure>
  );
}

/**
 * One labelled region per mock, so a screen reader in browse mode meets each
 * paper spoken in full rather than a single opaque picture. Transparent and
 * not focusable: hover and the arrow keys are Recharts' job, and they reach
 * the same values through the tooltip.
 */
function MockTargets({ rows }: { rows: MockScore[] }) {
  const xScale = useXAxisScale();
  const plot = usePlotArea();
  if (!xScale || !plot || rows.length === 0) return null;
  const band = plot.width / rows.length;
  return (
    <g>
      {rows.map((row) => {
        const cx = Number(xScale(row.paper_id));
        if (!Number.isFinite(cx)) return null;
        return (
          <rect
            key={row.paper_id}
            data-mock={row.paper_id}
            x={cx - band / 2}
            y={plot.y}
            width={band}
            height={plot.height}
            fill="transparent"
            pointerEvents="none"
            role="img"
            aria-label={spoken(row)}
          />
        );
      })}
    </g>
  );
}

function TrendTooltip({ active, row }: { active?: boolean; row?: MockScore }) {
  if (!active || !row) return null;
  return (
    <div
      role="status"
      className="w-44 rounded-lg border border-border bg-popover p-2.5 text-xs shadow-overlay"
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
              className="h-0.5 w-3 shrink-0 rounded-full"
              style={{ background: subject.color }}
            />
            <dt className="flex-1 text-muted-foreground">{subject.label}</dt>
            <dd className="tnum font-medium text-popover-foreground">
              {num(row[subject.key])}
            </dd>
          </div>
        ))}
        <div className="flex items-center gap-2 border-t border-border pt-1">
          <dt className="flex-1 pl-5 text-muted-foreground">Total</dt>
          <dd className="tnum font-semibold text-popover-foreground">
            {num(row.total)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
