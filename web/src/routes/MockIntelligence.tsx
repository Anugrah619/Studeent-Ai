import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useMarksLost, useMockScores, useStudent } from "@/api/queries";
import { MarksLostBar } from "@/components/charts/MarksLostBar";
import { ErrorState, PanelSkeleton } from "@/components/common/States";
import { causeSlices, marksLostTotals } from "@/lib/causes";
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

/**
 * The paper's maximum, when nothing has told us yet.
 *
 * `MarksLost.max_marks` is in the contract now and is the real answer — this
 * constant only stands in for the moment before that request lands, and only
 * for the paper picker, which lists papers whose `marks-lost` has not been
 * fetched. It used to be the *only* source, which meant the header quoted
 * "scored 134 of 300" for a paper that is out of 184. A denominator nobody
 * checked is how a demo ends up showing a 73% score as 45%.
 */
const ASSUMED_MAX_MARKS = 300;

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

  /**
   * The denominators, resolved once. Null until the data lands, which is also
   * what narrows both to non-null inside the loaded branch below.
   */
  const totals = marksLost.data ? marksLostTotals(marksLost.data) : null;

  /** The paper's real maximum, from the server, once it has answered. */
  const maxMarks = marksLost.data?.max_marks ?? null;

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
            {/* The score is quoted only once the paper's own maximum has
                arrived. A number out of the wrong denominator is worse than a
                number that shows up half a second later. */}
            {row && maxMarks ? ` · scored ${num(row.total)} of ${num(maxMarks)}` : ""}
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
                  {/* No denominator here: `MockScore` carries no paper max, and
                      the one we know belongs to the paper currently open, not
                      to every row in this list. */}
                  {score.paper_name} · {num(score.total)}
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
              {/* No "/ 100". `MockScore` ships three subject scores and a
                  total, and no per-subject maximum — and this paper is out of
                  184, not 300, so thirds of it are not 100 either. The share of
                  the paper's own total is a number we can actually stand
                  behind. */}
              <div className="tnum mt-1.5 text-2xl leading-none font-semibold">
                {num(row[subject.key])}
                {row.total > 0 ? (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {pct((row[subject.key] / row.total) * 100)} of the paper
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {marksLost.isPending || !marksLost.data || !totals ? (
        <>
          <Skeleton className="h-28 rounded-xl" />
          <PanelSkeleton lines={4} />
        </>
      ) : (
        <>
          {/* The one hero figure on this view.
              The denominator here is `attributed_lost`, never `total_lost`.
              "61 of the 90 we can explain" is a claim the engine can defend;
              "61 of your 166 marks" quietly asserts that the other 105 were
              also understood, which is the thing it was just changed to stop
              doing. */}
          <section className="rounded-xl border border-border bg-card px-6 py-5">
            <p className="text-xs font-medium text-muted-foreground">
              Recoverable without learning anything new
            </p>
            <p className="mt-2 flex flex-wrap items-baseline gap-2">
              <span className="text-[56px] leading-none font-semibold tracking-tight text-foreground">
                {num(marksLost.data.recoverable)}
              </span>
              <span className="text-lg text-muted-foreground">
                of the {num(totals.attributed)} marks we can explain
              </span>
            </p>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Only{" "}
              <strong className="font-semibold text-foreground">
                {num(marksLost.data.conceptual_gap)} marks
              </strong>{" "}
              went to things this student genuinely does not know. The rest went
              to execution, the clock, and questions he could have answered and
              did not
              {totals.recoverablePct === null
                ? ""
                : ` — ${pct(totals.recoverablePct)} of the explained loss`}
              , addressable with drilling and paper strategy rather than more
              teaching.
            </p>
            {totals.unattributed > 0 ? (
              <p className="mt-2.5 flex max-w-2xl gap-2.5 text-sm leading-relaxed text-muted-foreground">
                <span
                  aria-hidden
                  className="mt-[7px] h-2.5 w-2.5 shrink-0 rounded-[2px]"
                  style={{ background: "var(--cause-unattributed)" }}
                />
                <span>
                  A further{" "}
                  <strong className="font-semibold text-foreground">
                    {num(totals.unattributed)} marks
                  </strong>{" "}
                  of the {num(totals.totalLost)} lost are not attributed to any
                  cause. Those questions come from chapters he has barely
                  attempted, so calling them a proven gap would be a guess. They
                  are counted, shown, and left uncalled.
                </span>
              </p>
            ) : null}
          </section>

          <MarksLostBar
            data={marksLost.data}
            maxMarks={marksLost.data.max_marks ?? ASSUMED_MAX_MARKS}
            scored={marksLost.data.score ?? row?.total}
          />

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
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
                {/* Three outcomes, not two. The unattributed bucket is neither
                    a teaching job nor a drilling job — it is a question the
                    engine has not earned the right to answer yet, and saying
                    so is more useful than filing it under either. */}
                <p className="mt-2 text-[11px] font-medium">
                  {!slice.attributed ? (
                    <span className="text-muted-foreground">
                      No call made yet
                    </span>
                  ) : slice.needsNewLearning ? (
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
