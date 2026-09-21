import { useMemo } from "react";
import type { SubjectBreakdown } from "@/api/types";
import { num, pct, signed } from "@/lib/format";
import { resolveSubject } from "@/lib/subjects";
import { Figure, FigureTable, Legend } from "./Figure";

const BAR_H = 18;
/** The input half of the comparison is deliberately un-hued. */
const TIME_FILL = "color-mix(in oklab, var(--foreground) 32%, transparent)";
const SUBJECT_KEY_FILL =
  "linear-gradient(90deg, var(--subject-physics) 0 33.33%, var(--subject-chemistry) 33.33% 66.66%, var(--subject-maths) 66.66% 100%)";

interface Row extends SubjectBreakdown {
  color: string;
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
  const data = useMemo<Row[]>(
    () =>
      rows.map((row) => {
        const token = resolveSubject(row.subject);
        return {
          ...row,
          color: token.color,
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
      <div className="pt-1">
        <div className="mb-2 grid grid-cols-[1fr_auto_1fr] items-end gap-x-3">
          <div className="text-right text-[11px] font-medium text-muted-foreground">
            ← Share of study time
          </div>
          <div className="w-[104px]" />
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
              {/* Left half — grows leftward from the centre baseline. The
                  label rides the bar's outer end rather than the column edge,
                  so it stays attached to a short bar. */}
              <div className="flex min-w-0 items-center justify-end gap-2">
                <span className="tnum shrink-0 text-[11px] text-muted-foreground">
                  {pct(row.time_share_pct)}
                </span>
                <div
                  className="shrink-0 rounded-l-[4px]"
                  style={{
                    width: `${(row.time_share_pct / max) * 100}%`,
                    height: BAR_H,
                    background: TIME_FILL,
                  }}
                />
              </div>

              <div className="w-[104px] text-center">
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
              <div className="flex min-w-0 items-center gap-2">
                <div
                  className="shrink-0 rounded-r-[4px]"
                  style={{
                    width: `${(row.marks_lost_share_pct / max) * 100}%`,
                    height: BAR_H,
                    background: row.color,
                  }}
                />
                <span className="tnum shrink-0 text-[11px] font-medium text-foreground">
                  {pct(row.marks_lost_share_pct)}
                </span>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] gap-x-3 text-[10px] text-muted-foreground">
          <div className="tnum text-left">{max}%</div>
          <div className="w-[104px] text-center">0</div>
          <div className="tnum text-right">{max}%</div>
        </div>
      </div>
    </Figure>
  );
}
