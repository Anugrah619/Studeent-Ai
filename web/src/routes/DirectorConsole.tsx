import { useMemo, useState } from "react";
import type { Flag } from "@/api/types";
import {
  useBatches,
  useDashboardSummary,
  useFlags,
  useStudents,
} from "@/api/queries";
import { KpiStrip } from "@/components/director/KpiStrip";
import { TriageTable, type TriageRow } from "@/components/director/TriageTable";
import { ClosedLoopPanel } from "@/components/director/ClosedLoopPanel";
import { InterveneDialog } from "@/components/director/InterveneDialog";
import { ErrorState, PanelSkeleton, Refetching } from "@/components/common/States";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { SEVERITY } from "@/lib/severity";
import { longDate } from "@/lib/format";

const ALL = "all";

export function DirectorConsole() {
  const [batch, setBatch] = useState<string>(ALL);
  const [target, setTarget] = useState<Flag | null>(null);

  const batchId = batch === ALL ? undefined : Number(batch);

  const summary = useDashboardSummary();
  const batches = useBatches();
  // Keep the key identical to the switcher's when unfiltered, so the console
  // and the header share one cached roster rather than fetching it twice.
  const students = useStudents(batchId === undefined ? {} : { batch: batchId });
  const openFlags = useFlags(true);
  const closedFlags = useFlags(false);

  const studentById = useMemo(
    () => new Map((students.data ?? []).map((s) => [s.id, s])),
    [students.data],
  );

  /**
   * Severity first, then longest open — a critical flag raised nine days ago is
   * a worse fact about the institute than one raised this morning.
   */
  const rows = useMemo<TriageRow[]>(() => {
    const flags = openFlags.data ?? [];
    return flags
      .filter((flag) => (batchId === undefined ? true : studentById.has(flag.student_id)))
      .map((flag) => ({ flag, student: studentById.get(flag.student_id) }))
      .sort((a, b) => {
        const weight =
          SEVERITY[b.flag.severity].weight - SEVERITY[a.flag.severity].weight;
        if (weight !== 0) return weight;
        return Date.parse(a.flag.raised_at) - Date.parse(b.flag.raised_at);
      });
  }, [openFlags.data, studentById, batchId]);

  const closed = useMemo(
    () =>
      (closedFlags.data ?? [])
        .filter((flag) => (batchId === undefined ? true : studentById.has(flag.student_id)))
        .sort((a, b) => Date.parse(b.resolved_at ?? "") - Date.parse(a.resolved_at ?? ""))
        .slice(0, 6),
    [closedFlags.data, studentById, batchId],
  );

  const error = summary.error ?? openFlags.error ?? students.error;

  return (
    <div className="space-y-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Director console</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Week of {longDate(new Date().toISOString())}. Every row below is a
            student the system can justify interrupting your week for — with the
            evidence that raised it.
          </p>
        </div>

        {/* One filter row, above everything it scopes. */}
        <div className="flex items-end gap-2">
          <div>
            <Label htmlFor="batch-filter" className="mb-1.5 block text-xs">
              Batch
            </Label>
            <Select value={batch} onValueChange={setBatch}>
              <SelectTrigger id="batch-filter" className="w-[196px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All batches</SelectItem>
                {(batches.data ?? []).map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    {item.name} · {item.exam_code} {item.year} ({item.student_count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {error ? <ErrorState error={error} onRetry={() => summary.refetch()} /> : null}

      <KpiStrip
        data={summary.data}
        loading={summary.isPending}
        scopeWarning={batchId !== undefined}
      />

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold tracking-tight">
            Students who need you this week
          </h2>
          <p className="text-xs text-muted-foreground">
            {rows.length} open {rows.length === 1 ? "flag" : "flags"}
            {batchId !== undefined ? " in this batch" : " across the institute"}
          </p>
        </div>

        {openFlags.isPending || students.isPending ? (
          <PanelSkeleton lines={6} />
        ) : (
          <Refetching active={openFlags.isFetching && !openFlags.isPending}>
            <TriageTable rows={rows} onIntervene={setTarget} />
          </Refetching>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold tracking-tight">
            Recently closed
          </h2>
          <p className="max-w-xl text-xs text-muted-foreground">
            Flags a mentor acted on, and what happened next. This is the number
            to hold us to at the end of a pilot.
          </p>
        </div>
        {closedFlags.isPending ? (
          <PanelSkeleton lines={4} />
        ) : (
          <ClosedLoopPanel flags={closed} />
        )}
      </section>

      <InterveneDialog
        flag={target}
        open={target !== null}
        onOpenChange={(next) => !next && setTarget(null)}
      />
    </div>
  );
}
