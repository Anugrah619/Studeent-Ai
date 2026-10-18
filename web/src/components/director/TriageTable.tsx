import { Link } from "react-router-dom";
import { MoveDown, MoveRight, MoveUp } from "lucide-react";
import type { Flag, StudentList } from "@/api/types";
import { Button } from "@/components/ui/button";
import { SeverityChip } from "@/components/common/SeverityChip";
import { EmptyState } from "@/components/common/States";
import { daysAgo, num, signed } from "@/lib/format";
import { detectorLabel } from "@/lib/severity";

export interface TriageRow {
  flag: Flag;
  student?: StudentList;
}

/**
 * "Students who need you this week." Driven by open flags rather than by the
 * roster, because a director does not want a list of 312 students — they want
 * the handful the system can justify interrupting their week for.
 *
 * The page's one ledger, so it gets the room: 15px rows with space around
 * them, the sentence that raised each flag in full, and the name of the check
 * that raised it underneath rather than as a label above — what the system saw
 * is the thing a director reads, and which rule saw it is the footnote.
 */
export function TriageTable({
  rows,
  onIntervene,
}: {
  rows: TriageRow[];
  onIntervene: (flag: Flag) => void;
}) {
  if (!rows.length) {
    return (
      <EmptyState
        title="Nothing open in this batch"
        body="No detector has raised a flag it can justify. That is the intended resting state — a console that flags everyone gets ignored by week three."
      />
    );
  }

  return (
    // `relative` is load-bearing: the screen-reader-only spans inside the cells
    // are absolutely positioned, and without a containing block here they escape
    // this wrapper's clipping and widen the whole page on a phone.
    <div className="relative overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
      <table className="w-full min-w-[980px] text-sm">
        <caption className="sr-only">
          Open flags, worst severity first, then longest open.
        </caption>
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th scope="col" className="py-3 pr-4 pl-6 font-medium">Student</th>
            <th scope="col" className="py-3 pr-4 font-medium">Severity</th>
            <th scope="col" className="py-3 pr-4 font-medium">What the system saw</th>
            <th scope="col" className="py-3 pr-4 text-right font-medium">Mock trend</th>
            <th scope="col" className="py-3 pr-4 text-right font-medium">Mock avg</th>
            <th scope="col" className="py-3 pr-4 font-medium">Raised</th>
            <th scope="col" className="py-3 pr-6 text-right font-medium">
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(({ flag, student }) => (
            <tr key={flag.id} className="align-top transition-colors hover:bg-muted/50">
              <td className="py-4 pr-4 pl-6">
                <Link
                  to={`/students/${flag.student_id}`}
                  className="font-semibold text-foreground underline-offset-4 hover:underline"
                >
                  {flag.student_name}
                </Link>
                <div className="tnum mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                  {student?.roll_no ? <span>{student.roll_no}</span> : null}
                  <span>{flag.batch_name}</span>
                </div>
              </td>

              <td className="py-4 pr-4">
                <SeverityChip severity={flag.severity} />
              </td>

              <td className="max-w-[400px] py-4 pr-4">
                <p className="leading-snug text-foreground">{flag.headline}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {detectorLabel(flag.type)}
                </p>
              </td>

              <td className="py-4 pr-4 text-right">
                <TrendCell value={student?.mock_trend} />
              </td>

              <td className="tnum py-4 pr-4 text-right text-foreground">
                {num(student?.mock_avg, 1)}
              </td>

              <td className="py-4 pr-4 whitespace-nowrap">
                <div className="text-foreground">{daysAgo(flag.raised_at)}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {flag.mentor_name}
                </div>
              </td>

              <td className="py-4 pr-6">
                <div className="flex items-center justify-end gap-1">
                  <Button size="sm" variant="outline" onClick={() => onIntervene(flag)}>
                    Log intervention
                  </Button>
                  <Button size="sm" variant="link" asChild>
                    <Link
                      to={`/students/${flag.student_id}`}
                      aria-label={`Open ${flag.student_name}'s 360 view`}
                    >
                      Open
                    </Link>
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Direction is carried by an arrow and a sign, not by the colour alone. */
function TrendCell({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const Icon = value > 0 ? MoveUp : value < 0 ? MoveDown : MoveRight;
  const tone =
    value > 0
      ? "text-status-good"
      : value < 0
        ? "text-status-critical"
        : "text-muted-foreground";
  return (
    <span className={`tnum inline-flex items-center gap-1 font-medium ${tone}`}>
      <Icon aria-hidden className="size-3.5" />
      {signed(value)}
      <span className="sr-only">marks across the mock series</span>
    </span>
  );
}
