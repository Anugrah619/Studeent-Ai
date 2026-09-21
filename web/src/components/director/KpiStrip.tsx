import { Info } from "lucide-react";
import type { DashboardSummary } from "@/api/types";
import { StatTile } from "@/components/common/StatTile";
import { SeverityChip } from "@/components/common/SeverityChip";
import { num, pct } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";

interface Props {
  data?: DashboardSummary;
  loading: boolean;
  /** True when a batch filter is active but the summary cannot honour it. */
  scopeWarning?: boolean;
}

export function KpiStrip({ data, loading, scopeWarning }: Props) {
  const closed = data?.flags_resolved ?? 0;
  const recovered =
    data?.recovery_rate_pct != null
      ? Math.round((data.recovery_rate_pct / 100) * closed)
      : null;

  return (
    <section aria-label="Institute summary" className="space-y-2">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {/* The one hero figure on this view. */}
        <div className="col-span-2 flex min-w-0 flex-col justify-between rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Students flagged this week
            </span>
            {!loading && data ? (
              <SeverityChip severity={data.critical_flags > 0 ? "critical" : "ok"} />
            ) : null}
          </div>
          {loading || !data ? (
            <Skeleton className="mt-3 h-12 w-24" />
          ) : (
            <div className="mt-2 flex items-baseline gap-3">
              <span className="text-5xl leading-none font-semibold tracking-tight text-foreground">
                {num(data.flagged_this_week)}
              </span>
              <span className="text-sm text-muted-foreground">
                of {num(data.active_students)} active
              </span>
            </div>
          )}
          {!loading && data ? (
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
              {data.critical_flags > 0 ? (
                <>
                  <strong className="font-semibold text-status-critical">
                    {num(data.critical_flags)} critical
                  </strong>{" "}
                  — these are the ones to open first.
                </>
              ) : (
                "No critical flags open. The detectors stayed quiet this week."
              )}
            </p>
          ) : null}
        </div>

        <StatTile
          label="Students on roster"
          loading={loading}
          value={num(data?.total_students)}
          caption={`${num(data?.active_students)} active · ${num(
            (data?.total_students ?? 0) - (data?.active_students ?? 0),
          )} exited`}
        />

        <StatTile
          label="Mock average"
          loading={loading}
          value={num(data?.batch_mock_avg, 1)}
          caption="of 300 · latest mock, institute-wide"
        />

        <StatTile
          label="Revision debt"
          loading={loading}
          value={pct(data?.revision_debt_pct, 1)}
          caption="of scheduled revisions are past their recall floor"
        />

        <StatTile
          label="Loop closed"
          loading={loading}
          value={pct(data?.recovery_rate_pct, 0)}
          caption={
            recovered != null
              ? `${num(recovered)} of ${num(closed)} closed flags ended in recovery`
              : "No flags closed yet"
          }
        />
      </div>

      {scopeWarning ? (
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Info aria-hidden className="mt-px size-3 shrink-0" />
          These figures stay institute-wide — the summary endpoint takes no batch
          filter yet. The table below is scoped.
        </p>
      ) : null}
    </section>
  );
}
