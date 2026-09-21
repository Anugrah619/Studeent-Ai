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

    // The KPI strip is now scoped to the most recent paper rather than to
    // every attempt the institute ever recorded — the backend changed this
    // because the unscoped form was a Seq Scan that would take seconds at
    // 20M rows. The paper identity travels with the number so the strip can
    // say *which* mock the average is for, instead of implying it is
    // lifetime.
    batch_mock_avg: 158.4,
    latest_paper_id: 14,
    latest_paper_name: "Mock 14",
    latest_paper_held_on: "2026-09-06",
    latest_paper_max_marks: 300,
    latest_paper_students: 298,

    revision_debt_pct: 31.2,
    avg_revision_debt: 4.7,
    flags_resolved: closed.length,
    recovery_rate_pct: closed.length
      ? round((recovered.length / closed.length) * 100, 1)
      : null,
  };
}
