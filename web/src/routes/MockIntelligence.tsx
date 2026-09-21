import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useMarksLost, useMockScores, useStudent } from "@/api/queries";
import { MarksLostBar } from "@/components/charts/MarksLostBar";
import { ErrorState, PanelSkeleton } from "@/components/common/States";
import { causeSlices } from "@/lib/causes";
import { longDate, num, pct } from "@/lib/format";
import { SUBJECT_LIST } from "@/lib/subjects";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

/** Papers in this fixture set are out of 300; the contract does not ship the max. */
const MAX_MARKS = 300;

export function MockIntelligence() {
  const params = useParams();
  const navigate = useNavigate();
  const id = Number(params.id);
  const paperId = Number(params.paperId);

  const student = useStudent(id);
  const scores = useMockScores(id);
  const marksLost = useMarksLost(id, paperId);

  const row = useMemo(
    () => scores.data?.find((score) => score.paper_id === paperId),
    [scores.data, paperId],
  );

  const error = student.error ?? marksLost.error;

  return (
    <div className="space-y-6 py-6">
      <Link
        to={`/students/${id}`}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ChevronLeft aria-hidden className="size-3.5" />
        {student.data?.name ?? "Student"} · 360
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">
            {row?.paper_name ?? "Mock"} · mock intelligence
          </h1>
          <p className="tnum mt-1 text-sm text-muted-foreground">
            {student.data?.name ?? "—"}
            {row ? ` · held ${longDate(row.held_on)}` : ""}
            {row ? ` · scored ${num(row.total)} of ${num(MAX_MARKS)}` : ""}
          </p>
        </div>

        {/* One filter row, above everything it scopes. */}
        <div>
          <Label htmlFor="paper-select" className="mb-1.5 block text-xs">
            Paper
          </Label>
          <Select
            value={String(paperId)}
            onValueChange={(value) => navigate(`/students/${id}/mock/${value}`)}
          >
            <SelectTrigger id="paper-select" className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(scores.data ?? []).map((score) => (
                <SelectItem key={score.paper_id} value={String(score.paper_id)}>
                  {score.paper_name} · {num(score.total)}/300
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? <ErrorState error={error} onRetry={() => marksLost.refetch()} /> : null}

      {row ? (
        <section
          aria-label="Subject scores in this paper"
          className="grid grid-cols-3 gap-3"
        >
          {SUBJECT_LIST.map((subject) => (
            <div
              key={subject.key}
              className="rounded-xl border border-border bg-card px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-[2px]"
                  style={{ background: subject.color }}
                />
                <span className="text-xs font-medium text-muted-foreground">
                  {subject.label}
                </span>
              </div>
              <div className="tnum mt-1.5 text-2xl leading-none font-semibold">
                {num(row[subject.key])}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  / 100
                </span>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {marksLost.isPending || !marksLost.data ? (
        <>
          <Skeleton className="h-28 rounded-xl" />
          <PanelSkeleton lines={4} />
        </>
      ) : (
        <>
          {/* The one hero figure on this view. */}
          <section className="rounded-xl border border-border bg-card px-6 py-5">
            <p className="text-xs font-medium text-muted-foreground">
              Recoverable without learning anything new
            </p>
            <p className="mt-2 flex flex-wrap items-baseline gap-2">
              <span className="text-[56px] leading-none font-semibold tracking-tight text-foreground">
                {num(marksLost.data.recoverable)}
              </span>
              <span className="text-lg text-muted-foreground">
                of {num(marksLost.data.total_lost)} marks lost
              </span>
            </p>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Only{" "}
              <strong className="font-semibold text-foreground">
                {num(marksLost.data.conceptual_gap)} marks
              </strong>{" "}
              went to things this student genuinely does not know. The rest went
              to execution, the clock, and questions he could have answered and
              did not — {pct(
                (marksLost.data.recoverable / (marksLost.data.total_lost || 1)) * 100,
              )}{" "}
              of the loss, addressable with drilling and paper strategy rather
              than more teaching.
            </p>
          </section>

          <MarksLostBar
            data={marksLost.data}
            maxMarks={MAX_MARKS}
            scored={row?.total}
          />

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {causeSlices(marksLost.data).map((slice) => (
              <article
                key={slice.key}
                className="rounded-xl border border-border bg-card p-4"
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-[2px]"
                    style={{ background: slice.color }}
                  />
                  <h3 className="text-xs font-medium text-muted-foreground">
                    {slice.label}
                  </h3>
                </div>
                <p className="tnum mt-2 text-2xl leading-none font-semibold">
                  {num(slice.marks)}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {pct(slice.sharePct)}
                  </span>
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  {slice.meaning}.
                </p>
                <p className="mt-2 text-[11px] font-medium">
                  {slice.needsNewLearning ? (
                    <span className="text-status-warn">Needs teaching</span>
                  ) : (
                    <span className="text-status-good">Needs drilling</span>
                  )}
                </p>
              </article>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
