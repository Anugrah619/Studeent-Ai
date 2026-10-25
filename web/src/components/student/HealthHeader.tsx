import { Link } from "react-router-dom";
import type { MockScore, StudentDetail } from "@/api/types";
import { FigureBand } from "@/components/common/StatTile";
import { KpiCard } from "@/components/kit/KpiCard";
import { RiskChip } from "@/components/common/SeverityChip";
import { Sparkline } from "@/components/charts/Sparkline";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { initials, longDate, num, pct } from "@/lib/format";
import { riskBand } from "@/lib/severity";

/**
 * Who this is, compactly. The name and the risk band are the only loud things;
 * roll, batch, exam, target and mentor are reference detail a director glances
 * at once, so they sit in one quiet line of labelled pairs. The page's headline
 * is the diagnosis directly below, not this.
 */
export function StudentHeader({
  student,
  latest,
}: {
  student: StudentDetail;
  latest?: MockScore;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 items-center gap-3.5">
        {/* Square, like every tile that is not an answer. */}
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-md bg-card text-sm font-semibold text-foreground shadow-card ring-1 ring-border"
        >
          {initials(student.name)}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">
              {student.name}
            </h1>
            <RiskChip score={student.state.risk_score} size="md" />
            {student.exited_at ? (
              <span className="rounded-sm px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-border">
                Exited {longDate(student.exited_at)}
              </span>
            ) : null}
          </div>
          {/* Labelled pairs, not a run of middle dots: each fact has a name,
              and the name is quiet enough that the value is what the eye
              lands on. */}
          <dl className="tnum mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <Fact label="Roll" value={student.roll_no} />
            <Fact label="Batch" value={student.batch.name} />
            <Fact
              label="Exam"
              value={`${student.batch.exam_code} ${student.batch.year}`}
            />
            {student.target ? <Fact label="Target" value={student.target} /> : null}
            <Fact label="Mentor" value={student.mentor.name} />
          </dl>
        </div>
      </div>

      {latest ? (
        <Button variant="outline" asChild>
          <Link to={`/students/${student.id}/mock/${latest.paper_id}`}>
            Open {latest.paper_name}
          </Link>
        </Button>
      ) : null}
    </header>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

export function StudentHeaderSkeleton() {
  return (
    <div className="flex items-center gap-3.5" aria-hidden>
      <Skeleton className="size-11 rounded-md" />
      <div className="space-y-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-80 max-w-[70vw]" />
      </div>
    </div>
  );
}

/**
 * The student's standing across the whole series, in one band of four. The
 * hero figure on this page is the diagnosis's marks at stake, above — so none
 * of these is a hero, and the two behaviour signals that used to be cards of
 * their own (consistency, revision debt) sit in one quiet line beneath.
 */
export function HealthKpis({
  student,
  scores,
}: {
  student: StudentDetail;
  scores: MockScore[];
}) {
  const state = student.state;
  const band = riskBand(state.risk_score);
  // Null is "fewer than two papers", not "flat": it renders as a dash.
  const trend = state.mock_trend;

  return (
    <div>
      {/* Four cells fill a row at 4 and at 2 columns alike. */}
      <FigureBand className="grid-cols-2 lg:grid-cols-4">
        {/* No "of 300". `StudentState.mock_avg` averages across papers whose
            maxima differ — the seeded series runs seven papers out of 300 and
            one out of 184 — so there is no single denominator to quote, and
            quoting one anyway is how "152.6 of 300" appeared beside a paper
            worth 184. The count of papers is the honest caption. */}
        <KpiCard
          variant="cell"
          label="Mock average"
          value={state.mock_avg}
          format="decimal"
          digits={1}
          caption={`marks, averaged across ${scores.length} mocks`}
          trend={
            scores.length > 1 ? (
              <Sparkline
                values={scores.map((row) => row.total)}
                accent={band.color}
                label={`Total score across ${scores.length} mocks`}
              />
            ) : undefined
          }
        />
        <KpiCard
          variant="cell"
          label="Mock trend"
          value={trend}
          format="signed"
          digits={trend == null || Number.isInteger(trend) ? 0 : 1}
          delta={
            trend == null
              ? undefined
              : {
                  text: trend < 0 ? "falling" : trend > 0 ? "rising" : "flat",
                  tone: trend < 0 ? "bad" : trend > 0 ? "good" : "neutral",
                  direction: trend < 0 ? "down" : trend > 0 ? "up" : "flat",
                }
          }
          caption={
            scores.length > 1
              ? `${num(scores[0].total)} → ${num(scores.at(-1)!.total)} across the series`
              : undefined
          }
        />
        {/* `risk_score` is 0–1 on the wire. Two decimals, not rounded to a
            whole number — that turned 0.696 into "1" — and not multiplied to
            70, which invents a percentage the score is not and lets the cell
            quietly disagree with the band chip beside the name. */}
        <KpiCard
          variant="cell"
          label="Risk score"
          value={state.risk_score}
          format="decimal"
          digits={2}
          // The nightly refresh recomputes this now, and when it last ran is on
          // the director console ("Data refreshed …") rather than repeated on
          // every student: it is one job for the whole institute.
          caption={`${state.risk_score == null ? "Not scored yet" : band.label}, on a 0–1 scale, from mock trend, subject balance, revision and consistency`}
        />
        <KpiCard
          variant="cell"
          label="Syllabus covered"
          value={state.syllabus_pct}
          format="percent"
          digits={1}
          caption={
            student.batch.exam_date
              ? `Exam ${longDate(student.batch.exam_date)}`
              : undefined
          }
        />
      </FigureBand>

      <dl className="tnum mt-3 flex flex-wrap gap-x-6 gap-y-1.5 px-1 text-sm text-muted-foreground">
        <div className="flex items-baseline gap-1.5">
          <dt>Study consistency</dt>
          <dd className="font-semibold text-foreground">
            {state.consistency == null ? "—" : pct(state.consistency * 100)}
          </dd>
          {/* `features.py`: days with any study logged in the last 60, over
              60. There is no plan behind it, so it never says "planned". */}
          <dd className="text-xs">of the last 60 days had study logged</dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt>Revision debt</dt>
          <dd className="font-semibold text-foreground">{num(state.revision_debt)}</dd>
          {/* A count of scheduled revision sessions past their date and not
              done — not chapters, and not a modelled "recall floor". */}
          <dd className="text-xs">revision sessions overdue</dd>
        </div>
      </dl>
    </div>
  );
}

export function HealthKpisSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-32 rounded-xl" />
      ))}
    </div>
  );
}
