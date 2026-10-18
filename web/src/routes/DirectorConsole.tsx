import { useMemo, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import type { Flag } from "@/api/types";
import {
  useBatches,
  useDashboardSummary,
  useFlags,
  useStudents,
} from "@/api/queries";
import { KpiStrip, type TriageCounts } from "@/components/director/KpiStrip";
import {
  TriageTable,
  groupByStudent,
  type TriageRow,
} from "@/components/director/TriageTable";
import { ClosedLoopPanel } from "@/components/director/ClosedLoopPanel";
import { InterveneDialog } from "@/components/director/InterveneDialog";
import { ErrorState, PanelSkeleton, Refetching } from "@/components/common/States";
import { PageHeadline } from "@/components/kit/PageHeadline";
import { Section } from "@/components/kit/Section";
import { TextLink } from "@/components/kit/TextLink";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { SEVERITY } from "@/lib/severity";
import { longDate, num } from "@/lib/format";

const ALL = "all";
const WEEK_MS = 7 * 86_400_000;

export function DirectorConsole() {
  const [batch, setBatch] = useState<string>(ALL);
  const [target, setTarget] = useState<Flag | null>(null);

  const batchId = batch === ALL ? undefined : Number(batch);

  // Scoped like the table. The strip labels itself from the summary's own
  // `batch_id` echo, so the placeholder (the previous scope, shown while the
  // new one loads) is never captioned as the batch just picked.
  const summary = useDashboardSummary(batchId, { placeholderData: keepPreviousData });
  const batches = useBatches();
  // Keep the key identical to the switcher's when unfiltered, so the console
  // and the header share one cached roster rather than fetching it twice.
  // `keepPreviousData` holds the old roster on screen while a new batch's
  // loads, so a filter change slides rows out of the table instead of
  // blanking it to a skeleton and back.
  const students = useStudents(batchId === undefined ? {} : { batch: batchId }, {
    placeholderData: keepPreviousData,
  });
  /**
   * The batch the roster *on screen* belongs to — not the one just picked.
   * While a new batch's roster loads, the old one is still showing, and
   * labelling the old rows "in Alpha" for that moment would be a false
   * sentence in the headline. Everything that filters or names the scope
   * reads this; only the query reads `batchId`.
   */
  const [shownBatch, setShownBatch] = useState<number | undefined>(batchId);
  if (!students.isPending && !students.isPlaceholderData && shownBatch !== batchId) {
    setShownBatch(batchId);
  }

  const openFlags = useFlags({ open: true });
  // `?open=` is a presence filter, so `false` is ignored by the server: this
  // fetches every flag and `useFlags` keeps the resolved ones. On the seeded
  // institute that is 81 rows over two pages, which `apiGetRows` follows.
  const closedFlags = useFlags({ open: false });

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
      .filter((flag) => (shownBatch === undefined ? true : studentById.has(flag.student_id)))
      .map((flag) => ({ flag, student: studentById.get(flag.student_id) }))
      .sort((a, b) => {
        const weight =
          SEVERITY[b.flag.severity].weight - SEVERITY[a.flag.severity].weight;
        if (weight !== 0) return weight;
        return Date.parse(a.flag.raised_at) - Date.parse(b.flag.raised_at);
      });
  }, [openFlags.data, studentById, shownBatch]);

  const groups = useMemo(() => groupByStudent(rows), [rows]);

  /**
   * The headline, the hero cell and the table are three views of one count.
   * Students, not flags: Aarav with two open flags is one student to call.
   */
  const counts = useMemo<TriageCounts>(() => {
    const now = Date.now();
    return {
      students: groups.length,
      critical: groups.filter((g) => g.flags[0].severity === "critical").length,
      flags: rows.length,
      newThisWeek: rows.filter((r) => now - Date.parse(r.flag.raised_at) <= WEEK_MS)
        .length,
    };
  }, [groups, rows]);

  const closed = useMemo(
    () =>
      (closedFlags.data ?? [])
        .filter((flag) => (shownBatch === undefined ? true : studentById.has(flag.student_id)))
        .sort((a, b) => Date.parse(b.resolved_at ?? "") - Date.parse(a.resolved_at ?? ""))
        .slice(0, 6),
    [closedFlags.data, studentById, shownBatch],
  );

  const scopedBatch =
    shownBatch === undefined ? undefined : batches.data?.find((b) => b.id === shownBatch);
  const scope =
    shownBatch === undefined
      ? undefined
      : { name: scopedBatch?.name ?? "this batch", size: scopedBatch?.student_count ?? null };

  const triageLoading = openFlags.isPending || students.isPending;
  const triageError = openFlags.error ?? students.error;
  const error = summary.error ?? triageError;

  return (
    <div className="space-y-10 pb-6">
      <PageHeadline
        className="pb-0"
        eyebrow={<>Week of {longDate(new Date().toISOString())}</>}
        title={
          triageError ? (
            "This week’s flags could not be loaded."
          ) : triageLoading ? (
            <span className="block py-1" aria-label="Loading this week’s flags">
              <Skeleton className="h-9 w-full max-w-xl sm:h-11" />
            </span>
          ) : (
            <Headline counts={counts} scope={scope?.name} />
          )
        }
        support={
          <>
            Each student below has an open flag, shown with the evidence
            recorded for it — worst first.
          </>
        }
        meta={
          <>
            <TextLink to="/how-it-works">How it works</TextLink>
            {summary.data ? (
              <span className="tnum flex flex-wrap gap-x-4 text-muted-foreground">
                <span>
                  {summary.data.batch_name ?? "Institute"} roster{" "}
                  {num(summary.data.total_students)}
                </span>
                <span>{num(summary.data.active_students)} active</span>
                <span>
                  {num(summary.data.total_students - summary.data.active_students)} exited
                </span>
              </span>
            ) : null}
          </>
        }
        actions={
          // One filter, above everything it scopes.
          <div>
            <Label htmlFor="batch-filter" className="mb-1.5 block text-xs text-muted-foreground">
              Batch
            </Label>
            <Select value={batch} onValueChange={setBatch}>
              <SelectTrigger id="batch-filter" className="w-55">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All batches</SelectItem>
                {(batches.data ?? []).map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    {item.name}, {item.exam_code} {item.year} ({item.student_count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {error ? (
        <ErrorState
          error={error}
          onRetry={() => {
            void summary.refetch();
            void openFlags.refetch();
            void students.refetch();
          }}
        />
      ) : null}

      <KpiStrip
        data={summary.data}
        loading={summary.isPending}
        settling={summary.isPlaceholderData}
        counts={triageLoading || triageError ? undefined : counts}
        countsLoading={triageLoading}
        scope={scope}
      />

      <Section
        title="Students who need you this week"
        description="Worst severity first, then longest open. One row per student; a student's other open flags fold underneath."
        actions={
          triageLoading ? null : (
            <span className="tnum flex gap-x-4">
              <span>
                {num(counts.flags)} open {counts.flags === 1 ? "flag" : "flags"}
              </span>
              <span>
                {num(counts.students)} {counts.students === 1 ? "student" : "students"}
                {shownBatch !== undefined ? " in this batch" : ""}
              </span>
            </span>
          )
        }
      >
        {triageLoading ? (
          <PanelSkeleton lines={6} />
        ) : (
          <Refetching
            active={
              (openFlags.isFetching && !openFlags.isPending) || students.isPlaceholderData
            }
          >
            <TriageTable groups={groups} onIntervene={setTarget} />
          </Refetching>
        )}
      </Section>

      <Section
        title="Recently closed"
        description={
          <>
            Flags closed with an outcome recorded. This is the number to hold us to
            at the end of a pilot — and no pilot has run yet, so these outcomes are{" "}
            <strong className="font-medium text-foreground">seeded examples</strong>,
            not results.
          </>
        }
      >
        {closedFlags.isPending ? (
          <PanelSkeleton lines={4} />
        ) : (
          <ClosedLoopPanel flags={closed} />
        )}
      </Section>

      <InterveneDialog
        flag={target}
        open={target !== null}
        onOpenChange={(next) => !next && setTarget(null)}
      />
    </div>
  );
}

/**
 * The one sentence a director reads first. Worded from the same counts as the
 * hero cell and the table, and never further than they go: "need you" is an
 * open flag, "critical" is a student whose worst open flag is critical.
 *
 * It is one colour from end to end. It used to set the critical count in the
 * brand's accent, picking one phrase out of the sentence — but the sentence
 * already says "critical" in words, and the critical chip beside the figure
 * below says it again in the one colour reserved for it.
 */
function Headline({ counts, scope }: { counts: TriageCounts; scope?: string }) {
  const where = scope ? ` in ${scope}` : "";
  if (counts.students === 0) {
    return <>Nobody{where} needs you this week.</>;
  }
  const one = counts.students === 1;
  const c = counts.critical;
  const tail =
    c === 0
      ? one
        ? "It is not critical."
        : "None is critical."
      : one
        ? "It is critical."
        : c === counts.students
          ? `All ${num(c)} are critical.`
          : `${num(c)} ${c === 1 ? "is" : "are"} critical.`;
  return (
    <>
      {num(counts.students)} {one ? "student" : "students"}
      {where} {one ? "needs" : "need"} you this week. {tail}
    </>
  );
}
