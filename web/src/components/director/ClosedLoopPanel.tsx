import { Link } from "react-router-dom";
import { motion } from "motion/react";
import type { Flag, Outcome } from "@/api/types";
import { SeverityChip } from "@/components/common/SeverityChip";
import { EmptyState } from "@/components/common/States";
import { daysAgo } from "@/lib/format";
import { fadeUp, stagger } from "@/lib/motion";
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
 * Deliberately quieter than the triage table above it — no card shadow, no
 * actions, smaller type. Nothing here asks the director to do anything; the
 * outcome chip is the only thing on a row meant to be read from a distance.
 */
export function ClosedLoopPanel({ flags }: { flags: Flag[] }) {
  if (!flags.length) {
    return (
      <EmptyState
        title="No flags closed yet"
        body="When a flag is closed with what became of the student, it appears here."
      />
    );
  }

  return (
    <motion.ul
      variants={stagger(0.04)}
      initial="hidden"
      animate="show"
      className="divide-y divide-border overflow-hidden rounded-xl bg-muted/25 ring-1 ring-border"
    >
      {flags.map((flag) => {
        const outcome =
          flag.outcome && flag.outcome in OUTCOME
            ? OUTCOME[flag.outcome as Outcome]
            : OUTCOME.unknown;
        return (
          <motion.li
            key={flag.id}
            variants={fadeUp}
            className="grid gap-x-6 gap-y-1.5 px-5 py-3.5 transition-colors duration-150 hover:bg-muted/40 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto] sm:items-center"
          >
            <div className="min-w-0">
              <Link
                to={`/students/${flag.student_id}`}
                className="rounded-sm text-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {flag.student_name}
              </Link>
              <div className="text-xs text-muted-foreground">
                {flag.batch_name} · {detectorLabel(flag.type)}
              </div>
            </div>
            <p className="text-[13px] leading-snug text-muted-foreground">
              {flag.headline}
            </p>
            <div className="flex items-center gap-3 sm:justify-end">
              <SeverityChip severity={outcome.severity} label={outcome.label} />
              <span className="text-xs whitespace-nowrap text-muted-foreground sm:w-20 sm:text-right">
                closed {daysAgo(flag.resolved_at)}
              </span>
            </div>
          </motion.li>
        );
      })}
    </motion.ul>
  );
}

export { OUTCOME };
