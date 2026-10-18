import { Info } from "lucide-react";
import { motion } from "motion/react";
import type { DashboardSummary } from "@/api/types";
import { KpiCard } from "@/components/kit/KpiCard";
import { Badge } from "@/components/ui/badge";
import { num } from "@/lib/format";
import { fadeUp, stagger } from "@/lib/motion";

/**
 * What the triage table below says, counted once so the hero figure, the
 * page headline and the table can never disagree. Built by the console from
 * the open flags it is about to list, not taken from the summary — see the
 * note on the hero card for why.
 */
export interface TriageCounts {
  /** Distinct students with at least one open flag. */
  students: number;
  /** Distinct students whose worst open flag is critical. */
  critical: number;
  /** Open flags between them. */
  flags: number;
  /** Of those, raised in the last seven days. */
  newThisWeek: number;
}

interface Props {
  data?: DashboardSummary;
  loading: boolean;
  /** `data` is the previous scope's summary, held while the new one loads. */
  settling?: boolean;
  counts?: TriageCounts;
  countsLoading: boolean;
  /** The batch the table is scoped to, when a filter is on. */
  scope?: { name: string; size: number | null };
}

/**
 * One hero figure — the students who need the director — and three quieter
 * ones about the institute. Four numbers is what a room can hold from a
 * projector; the roster count that used to be a fifth card sits in the
 * headline's meta line now, because it is the denominator, not a finding.
 */
export function KpiStrip({ data, loading, settling, counts, countsLoading, scope }: Props) {
  // Which population the summary's own figures describe, read from the
  // server's echo rather than from the filter: the two differ while a new
  // batch loads, and in mock mode, which has no per-batch summary.
  const summaryBatch = data?.batch_id != null ? (data.batch_name ?? "this batch") : null;
  const paperName = data?.latest_paper_name ?? "Latest mock";
  const closed = data?.flags_resolved ?? 0;
  const recovered =
    data?.recovery_rate_pct != null
      ? Math.round((data.recovery_rate_pct / 100) * closed)
      : null;

  const critical = counts?.critical ?? 0;

  return (
    <section aria-label="Institute summary" className="space-y-2.5">
      <motion.div
        variants={stagger(0.06, 0.12)}
        initial="hidden"
        animate="show"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
      >
        {/* The hero counts students, not flags. The summary's
            `flagged_this_week` is a count of *flags* raised in seven days,
            and it used to sit under a "Students flagged" label — two flags
            on one student read as two students. Counting distinct students
            from the table's own rows is what lets the headline, this card
            and the list below say the same number. */}
        <motion.div variants={fadeUp} className="col-span-2 sm:col-span-3 lg:col-span-2">
          <KpiCard
            size="hero"
            label="Students with open flags"
            loading={countsLoading}
            value={counts?.students}
            unit={
              scope
                ? scope.size != null
                  ? `of ${num(scope.size)} in ${scope.name}`
                  : `in ${scope.name}`
                : data
                  ? `of ${num(data.active_students)} active`
                  : undefined
            }
            tone={counts ? (critical > 0 ? "critical" : counts.students > 0 ? "warn" : "good") : "neutral"}
            toneLabel={
              counts
                ? critical > 0
                  ? `${num(critical)} critical`
                  : counts.students > 0
                    ? "None critical"
                    : "All clear"
                : undefined
            }
            caption={
              counts ? (
                counts.students === 0 ? (
                  "No detector has an open flag. The detectors stayed quiet."
                ) : (
                  <>
                    {critical > 0 ? (
                      <>
                        <strong className="font-semibold text-foreground">
                          Open the {num(critical)} critical first.
                        </strong>{" "}
                      </>
                    ) : null}
                    {num(counts.flags)} open {counts.flags === 1 ? "flag" : "flags"};{" "}
                    {num(counts.newThisWeek)} raised in the last 7 days.
                  </>
                )
              ) : undefined
            }
          />
        </motion.div>

        {/* `latest_paper_max_marks` is on the summary, so the denominator is the
            paper's own. It was hardcoded to 300, which on the seeded institute's
            latest mock — out of 184 — understated a 98.3 average as a third of
            the paper instead of half of it. */}
        <motion.div variants={fadeUp}>
          <KpiCard
            label="Mock average"
            loading={loading}
            value={data?.batch_mock_avg}
            format="decimal"
            digits={1}
            unit={data?.latest_paper_max_marks ? `of ${num(data.latest_paper_max_marks)}` : undefined}
            caption={
              summaryBatch === null
                ? `${paperName}, institute-wide`
                : data?.batch_mock_avg == null
                  ? `${summaryBatch} did not sit ${paperName}`
                  : `${paperName}, ${summaryBatch} only`
            }
          />
        </motion.div>

        <motion.div variants={fadeUp}>
          <KpiCard
            label="Revision debt"
            loading={loading}
            value={data?.revision_debt_pct}
            format="percent"
            digits={1}
            // `revision_debt_pct` is overdue ÷ due: revisions whose date has
            // passed and that were not done. There is no recall model behind
            // it, so the caption does not claim one.
            caption="of revisions due so far have not been done"
          />
        </motion.div>

        {/* Every closed flag in the demo is seeded — no pilot has run, so no
            outcome here was measured. The badge and the caption both say so;
            this is the figure most likely to be quoted back as a result. */}
        <motion.div variants={fadeUp} className="max-sm:col-span-2">
          <KpiCard
            label="Loop closed"
            loading={loading}
            value={data?.recovery_rate_pct}
            format="percent"
            digits={0}
            badge={
              <Badge
                variant="outline"
                className="h-5 text-[11px] text-muted-foreground"
                title="Seeded example outcomes, not measured in a pilot"
              >
                Seeded
              </Badge>
            }
            caption={
              recovered != null
                ? `${num(recovered)} of ${num(closed)} closed flags ended in recovery. Seeded examples, not a pilot result.`
                : "No flags closed yet"
            }
          />
        </motion.div>
      </motion.div>

      {scope && data && !settling ? (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {summaryBatch !== null ? (
            <>Every figure on this strip is for {summaryBatch} only.</>
          ) : (
            <>
              The student count and the table are scoped to {scope.name}. Mock
              average, revision debt and loop closed are institute-wide: this
              dataset has no batch breakdown for them.
            </>
          )}
        </p>
      ) : null}
    </section>
  );
}
