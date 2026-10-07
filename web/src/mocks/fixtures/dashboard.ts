import type { DashboardSummary } from "@/api/types";
import { flags } from "./flags";
import {
  DIAGNOSTIC_MAX_MARKS,
  DIAGNOSTIC_PAPER_ID,
  DIAGNOSTIC_PAPER_NAME,
  paperById,
} from "./institute";
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
    // The summary is institute-wide unless `?batch=` scopes it, and says which
    // it is rather than leaving the reader to infer it from the filter chip.
    batch_id: null,
    batch_name: null,
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
    //
    // The latest paper is the diagnostic one, because that is what the
    // fixture's own paper list says: it is held four days ago, after every
    // AIT mock. This used to name "Mock 14" out of 300 while `papers` and
    // every diagnosis fixture said paper 17 was the most recent — and the
    // live summary names paper 17 too. The average is the live figure for
    // that paper; the sitter count is this (larger) mock roster's.
    batch_mock_avg: 98.3,
    latest_paper_id: DIAGNOSTIC_PAPER_ID,
    latest_paper_name: DIAGNOSTIC_PAPER_NAME,
    latest_paper_held_on: paperById.get(DIAGNOSTIC_PAPER_ID)?.held_on ?? null,
    latest_paper_max_marks: DIAGNOSTIC_MAX_MARKS,
    latest_paper_students: 298,

    revision_debt_pct: 31.2,
    avg_revision_debt: 4.7,
    flags_resolved: closed.length,
    recovery_rate_pct: closed.length
      ? round((recovered.length / closed.length) * 100, 1)
      : null,
  };
}
