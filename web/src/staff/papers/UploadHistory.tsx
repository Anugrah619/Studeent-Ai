import { useState } from "react";
import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { useIngestBatches } from "@/api/staff";
import type { IngestBatch } from "@/api/types";
import { EmptyState, ErrorState, PanelSkeleton } from "@/components/common/States";
import { longDate, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { plural } from "../common";
import { BATCH_STATUS } from "./labels";

const STATUS_ICON = {
  done: CircleCheck,
  failed: CircleAlert,
  pending: Loader2,
} as const;

/**
 * Every results file imported, newest first — the receipts.
 *
 * There is no delete, on purpose: answers are an append-only record and a
 * batch is the receipt for the ones it wrote. The route has no `?paper=`
 * filter, so this paper's uploads are picked out here, with the institute's
 * others one click away.
 */
export function UploadHistory({ paperId, highlight }: { paperId: number; highlight?: number }) {
  const batches = useIngestBatches();
  const [everyPaper, setEveryPaper] = useState(false);

  if (batches.isPending) return <PanelSkeleton lines={4} />;
  if (batches.error) {
    return <ErrorState error={batches.error} onRetry={() => void batches.refetch()} />;
  }

  const all = batches.data ?? [];
  const mine = all.filter((b) => b.paper_id === paperId);
  const rows = everyPaper ? all : mine;
  const others = all.length - mine.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <p>
          {everyPaper
            ? `${plural(all.length, "upload")} across every paper.`
            : `${plural(mine.length, "upload")} for this paper.`}
        </p>
        {others > 0 || everyPaper ? (
          <button
            type="button"
            aria-pressed={everyPaper}
            onClick={() => setEveryPaper((v) => !v)}
            className="rounded-sm font-medium text-brand-ink underline decoration-brand-line underline-offset-4 outline-none hover:decoration-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {everyPaper ? "Show this paper's only" : `Show every paper's (${num(all.length)})`}
          </button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing uploaded yet"
          body="Each results file you import is listed here, with how many students it brought in and how many failed."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-card shadow-card ring-1 ring-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Results files imported, newest first</caption>
            <thead className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">Upload</th>
                <th scope="col" className="px-4 py-2.5 font-medium">File</th>
                {everyPaper ? (
                  <th scope="col" className="px-4 py-2.5 font-medium">Paper</th>
                ) : null}
                <th scope="col" className="px-4 py-2.5 font-medium">When</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Rows</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Imported</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Failed</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="tnum divide-y divide-border">
              {rows.map((batch) => (
                <BatchRow
                  key={batch.id}
                  batch={batch}
                  showPaper={everyPaper}
                  highlighted={batch.id === highlight}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BatchRow({
  batch,
  showPaper,
  highlighted,
}: {
  batch: IngestBatch;
  showPaper: boolean;
  highlighted: boolean;
}) {
  const status = batch.status ?? "done";
  const Icon = STATUS_ICON[status];
  return (
    <tr
      data-batch-id={batch.id}
      aria-current={highlighted ? "true" : undefined}
      className={cn(highlighted && "bg-brand-soft")}
    >
      <td className="px-4 py-2.5 font-medium text-foreground">#{batch.id}</td>
      <td className="max-w-64 truncate px-4 py-2.5 text-foreground" title={batch.filename}>
        {batch.filename}
      </td>
      {showPaper ? (
        <td className="px-4 py-2.5 text-muted-foreground">{batch.paper_name || "—"}</td>
      ) : null}
      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
        {longDate(batch.created_at)}
      </td>
      <td className="px-4 py-2.5 text-right">{num(batch.row_count)}</td>
      <td className="px-4 py-2.5 text-right">{num(batch.rows_ok)}</td>
      <td className="px-4 py-2.5 text-right">{num(batch.rows_failed)}</td>
      <td className="px-4 py-2.5">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <Icon
            aria-hidden
            className={cn(
              "size-3.5",
              status === "done"
                ? "text-status-good"
                : status === "failed"
                  ? "text-status-critical"
                  : "animate-spin text-muted-foreground",
            )}
          />
          {BATCH_STATUS[status]}
          {highlighted ? <span className="sr-only"> (the upload this file duplicates)</span> : null}
        </span>
      </td>
    </tr>
  );
}
