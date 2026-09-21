import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { MockScore, StudentDetail } from "@/api/types";
import { StatTile } from "@/components/common/StatTile";
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
    <header className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight">{student.name}</h1>
            <RiskChip score={state.risk_score} size="md" />
            {student.exited_at ? (
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                Exited {longDate(student.exited_at)}
              </span>
            ) : null}
          </div>
          <p className="tnum mt-1 text-sm text-muted-foreground">
            {student.roll_no} · {student.batch.name} · {student.batch.exam_code}{" "}
            {student.batch.year}
            {student.target ? ` · Target ${student.target}` : ""} · Mentor{" "}
            {student.mentor.name}
          </p>
        </div>

        {latest ? (
          <Button variant="outline" asChild>
            <Link to={`/students/${student.id}/mock/${latest.paper_id}`}>
              Open {latest.paper_name}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Mock average"
          value={num(state.mock_avg, 1)}
          caption={`of 300 across ${scores.length} mocks`}
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
        <StatTile
          label="Risk score"
          value={num(state.risk_score)}
          caption={`Band: ${band.label} · recomputed nightly`}
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
      </div>
    </header>
  );
}
