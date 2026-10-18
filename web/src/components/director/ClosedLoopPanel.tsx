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
 *
 * Same ledger as the triage table above it — name, the sentence, the verdict —
 * on a grid, so the three columns line up from one row to the next instead of
 * wrapping wherever the text happens to fall.
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
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      {flags.map((flag) => {
        const outcome = flag.outcome && flag.outcome in OUTCOME
          ? OUTCOME[flag.outcome as Outcome]
          : OUTCOME.unknown;
        return (
          <li
            key={flag.id}
            className="grid items-start gap-x-8 gap-y-2 px-6 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_15rem]"
          >
            <div className="min-w-0">
              <Link
                to={`/students/${flag.student_id}`}
                className="text-sm font-semibold text-foreground underline-offset-4 hover:underline"
              >
                {flag.student_name}
              </Link>
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                <span>{flag.batch_name}</span>
                <span>{detectorLabel(flag.type)}</span>
              </div>
            </div>
            <p className="text-sm leading-snug text-muted-foreground">{flag.headline}</p>
            <div className="flex shrink-0 items-center gap-4 md:justify-end">
              <SeverityChip severity={outcome.severity} label={outcome.label} />
              <span className="w-16 text-right text-xs text-muted-foreground">
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
