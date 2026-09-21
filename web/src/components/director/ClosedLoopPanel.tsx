import { Link } from "react-router-dom";
import type { Flag, Outcome } from "@/api/types";
import { SeverityChip } from "@/components/common/SeverityChip";
import { EmptyState } from "@/components/common/States";
import { daysAgo } from "@/lib/format";
import { detectorLabel } from "@/lib/severity";

const OUTCOME: Record<Outcome, { label: string; severity: "improving" | "critical" | "watch" }> =
  {
    recovered: { label: "Recovered", severity: "improving" },
    declined: { label: "Declined", severity: "critical" },
    unknown: { label: "Outcome unknown", severity: "watch" },
  };

/**
 * A console that only raises flags is a complaints box. This is the half that
 * renews a contract: what was done, and whether it worked.
 */
export function ClosedLoopPanel({ flags }: { flags: Flag[] }) {
  if (!flags.length) {
    return (
      <EmptyState
        title="No flags closed yet"
        body="Once a mentor logs an intervention, the flag moves here and the recovery clock starts."
      />
    );
  }

  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {flags.map((flag) => {
        const outcome = flag.outcome && flag.outcome in OUTCOME
          ? OUTCOME[flag.outcome as Outcome]
          : OUTCOME.unknown;
        return (
          <li key={flag.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-3">
            <div className="min-w-[160px] flex-1">
              <Link
                to={`/students/${flag.student_id}`}
                className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
              >
                {flag.student_name}
              </Link>
              <div className="text-[11px] text-muted-foreground">
                {flag.batch_name} · {detectorLabel(flag.type)}
              </div>
            </div>
            <p className="min-w-[200px] flex-[2] text-xs leading-snug text-muted-foreground">
              {flag.headline}
            </p>
            <div className="flex shrink-0 items-center gap-3">
              <SeverityChip severity={outcome.severity} label={outcome.label} />
              <span className="w-20 text-right text-[11px] text-muted-foreground">
                {daysAgo(flag.resolved_at)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export { OUTCOME };
