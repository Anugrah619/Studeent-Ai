import type { DashboardSummary } from "@/api/types";
import { flags } from "./flags";
import { round } from "./rng";

const WEEK_MS = 7 * 86_400_000;

/**
 * Derived from the flag fixtures rather than asserted, so the KPI strip and the
 * triage table below it can never contradict each other — the first thing a
 * sceptical director checks.
 */
export function dashboardSummary(): DashboardSummary {
  const now = Date.now();
  const open = flags.filter((f) => f.is_open);
  const closed = flags.filter((f) => !f.is_open);
  const recovered = closed.filter((f) => f.outcome === "recovered");

  return {
    // Institute roster. Only 14 students are seeded in this fixture set.
    total_students: 312,
    active_students: 298,
    flagged_this_week: open.filter(
      (f) => now - Date.parse(f.raised_at) <= WEEK_MS,
    ).length,
    critical_flags: open.filter((f) => f.severity === "critical").length,
    batch_mock_avg: 158.4,
    revision_debt_pct: 31.2,
    flags_resolved: closed.length,
    recovery_rate_pct: closed.length
      ? round((recovered.length / closed.length) * 100, 1)
      : null,
  };
}
