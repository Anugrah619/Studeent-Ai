import { Link } from "react-router-dom";
import type { MockScore, StudentDetail } from "@/api/types";
import { FigureBand, StatTile } from "@/components/common/StatTile";
import { RiskChip } from "@/components/common/SeverityChip";
import { Sparkline } from "@/components/charts/Sparkline";
import { Button } from "@/components/ui/button";
import { longDate, num, pct, signed } from "@/lib/format";
import { riskBand } from "@/lib/severity";

export function HealthHeader({
  student,
  scores,
}: {
  student: StudentDetail;
  scores: MockScore[];
}) {
  const state = student.state;
  const band = riskBand(state.risk_score);
  const latest = scores.at(-1);
  const trend = state.mock_trend ?? 0;

  return (
    <header className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{student.name}</h1>
            <RiskChip score={state.risk_score} size="md" />
            {student.exited_at ? (
              <span className="rounded-sm border border-border px-2 py-0.5 text-xs text-muted-foreground">
                Exited {longDate(student.exited_at)}
              </span>
            ) : null}
          </div>
          {/* Pairs, not a run of middle dots: each fact has a name, and the
              name is quiet enough that the value is what the eye lands on. */}
          <dl className="tnum mt-3 flex flex-wrap gap-x-8 gap-y-1.5 text-sm">
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

        {latest ? (
          <Button variant="outline" asChild>
            <Link to={`/students/${student.id}/mock/${latest.paper_id}`}>
              Open {latest.paper_name}
            </Link>
          </Button>
        ) : null}
      </div>

      {/* Six cells fill a row at 6, 3 and 2 columns alike. */}
      <FigureBand className="grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        {/* No "of 300". `StudentState.mock_avg` averages across papers whose
            maxima differ — the seeded series runs seven papers out of 300 and
            one out of 184 — so there is no single denominator to quote, and
            quoting one anyway is how "152.6 of 300" appeared beside a paper
            worth 184. The count of papers is the honest caption. */}
        <StatTile
          label="Mock average"
          value={num(state.mock_avg, 1)}
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
        <StatTile
          label="Mock trend"
          value={signed(trend)}
          delta={{
            text: trend < 0 ? "falling" : trend > 0 ? "rising" : "flat",
            tone: trend < 0 ? "bad" : trend > 0 ? "good" : "neutral",
            caption: "",
          }}
          caption={
            scores.length > 1
              ? `${num(scores[0].total)} → ${num(scores.at(-1)!.total)} across the series`
              : undefined
          }
        />
        {/* `risk_score` is 0–1 on the wire. Two decimals, not rounded to a
            whole number — that turned 0.696 into "1" — and not multiplied to
            70, which invents a percentage the score is not and lets the tile
            quietly disagree with the band chip beside it. */}
        <StatTile
          label="Risk score"
          value={num(state.risk_score, 2)}
          caption={`${band.label}, on a 0–1 scale, recomputed nightly`}
        />
        <StatTile
          label="Study consistency"
          value={pct((state.consistency ?? 0) * 100)}
          caption="Share of planned sessions actually logged"
        />
        <StatTile
          label="Revision debt"
          value={num(state.revision_debt)}
          caption="Chapters past their recall floor"
        />
        <StatTile
          label="Syllabus covered"
          value={pct(state.syllabus_pct, 1)}
          caption={
            student.batch.exam_date
              ? `Exam ${longDate(student.batch.exam_date)}`
              : undefined
          }
        />
      </FigureBand>
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
