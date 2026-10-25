import { useMemo, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, FileQuestion } from "lucide-react";
import { ApiError } from "@/api/client";
import type { MarksLost } from "@/api/types";
import { useMarksLost, useMockScores, useStudent } from "@/api/queries";
import { MarksLostBar } from "@/components/charts/MarksLostBar";
import { EmptyState, ErrorState, PanelSkeleton } from "@/components/common/States";
import { FigureBand } from "@/components/common/StatTile";
import { KpiCard } from "@/components/kit/KpiCard";
import { PageHeadline } from "@/components/kit/PageHeadline";
import { Section } from "@/components/kit/Section";
import { causeSlices, marksLostTotals, type MarksLostTotals } from "@/lib/causes";
import { firstName } from "@/lib/explainer";
import { longDate, num, pct } from "@/lib/format";
import { resolveSubject, subjectsOf } from "@/lib/subjects";
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

  /**
   * A 404 here is an answer, not a failure: the server holds no attempts for
   * this student on this paper. Retrying will not change it, so it gets a
   * calm sentence and the paper picker rather than the red error state.
   */
  const noSheet = marksLost.error instanceof ApiError && marksLost.error.status === 404;
  const error = student.error ?? (noSheet ? null : marksLost.error);

  /**
   * The denominators, resolved once. Null until the data lands, which is also
   * what narrows both to non-null inside the loaded branch below.
   */
  const totals = marksLost.data ? marksLostTotals(marksLost.data) : null;

  /** The paper's real maximum, from the server, once it has answered. */
  const maxMarks = marksLost.data?.max_marks ?? null;
  const name = student.data ? firstName(student.data.name) : "this student";
  const paperName = row?.paper_name ?? "this paper";

  const picker = (
    <div>
      <Label htmlFor="paper-select" className="mb-1.5 block text-xs text-muted-foreground">
        Paper
      </Label>
      <Select
        value={row ? String(paperId) : ""}
        onValueChange={(value) => navigate(`/students/${id}/mock/${value}`)}
      >
        <SelectTrigger id="paper-select" className="w-60 max-w-full bg-card">
          <SelectValue placeholder="Choose a paper" />
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
  );

  const headline =
    marksLost.data && totals ? (
      mockHeadline(marksLost.data, totals, paperName, name)
    ) : (
      loadingHeadline()
    );

  return (
    <div className="space-y-10 py-6">
      <div>
        <Link
          to={`/students/${id}`}
          className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft aria-hidden className="size-4" />
          {student.data?.name ?? "Student"} · 360
        </Link>

        <PageHeadline
          className="pt-5 pb-0 sm:pt-6"
          eyebrow={row ? `Mock intelligence for ${row.paper_name}` : "Mock intelligence"}
          title={noSheet ? `No answer sheet for ${name} on this paper.` : headline.title}
          support={noSheet ? undefined : headline.support}
          meta={
            <span className="tnum text-muted-foreground">
              {student.data?.name ?? "—"}
              {row ? `, held ${longDate(row.held_on)}` : ""}
            </span>
          }
          actions={picker}
        />
      </div>

      {error ? <ErrorState error={error} onRetry={() => marksLost.refetch()} /> : null}

      {noSheet ? (
        <EmptyState
          icon={<FileQuestion aria-hidden className="size-5" />}
          title="Nothing to attribute on this paper"
          body={`The server has no attempts recorded for ${name} on it, so there are no lost marks to explain. Pick a paper ${name} sat from the paper list.`}
        />
      ) : marksLost.isPending || !marksLost.data || !totals ? (
        error ? null : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Skeleton className="col-span-2 h-40 rounded-xl" />
              <Skeleton className="h-40 rounded-xl" />
              <Skeleton className="h-40 rounded-xl" />
              <Skeleton className="h-40 rounded-xl" />
            </div>
            <PanelSkeleton lines={4} />
          </>
        )
      ) : (
        <>
          <section aria-label="The figures behind the headline" className="space-y-3">
            {/* One band, so the hero leads it. At two columns the hero fills the
                first row and the last cell fills the third; at five, the hero
                takes two and the others one each — no row ever ends short. */}
            <FigureBand className="grid-cols-2 lg:grid-cols-5">
              {/* The one hero figure on this view.
                  The denominator here is `attributed_lost`, never `total_lost`.
                  "61 of the 90 we can explain" is a claim the engine can defend;
                  "61 of your 166 marks" quietly asserts that the other 76 were
                  also understood, which is the thing it was changed to stop
                  doing. */}
              <KpiCard
                variant="cell"
                size="hero"
                animate
                className="col-span-2"
                label="Recoverable without learning anything new"
                value={marksLost.data.recoverable}
                unit={`of the ${num(totals.attributed)} marks we can explain`}
                caption={
                  totals.recoverablePct === null
                    ? "Execution, the clock and avoidable skips — fixed with drilling and paper strategy."
                    : `${pct(totals.recoverablePct)} of the explained loss — execution, the clock and avoidable skips.`
                }
              />
              <KpiCard
                variant="cell"
                label="Conceptual gap"
                value={marksLost.data.conceptual_gap}
                unit="marks"
                caption="The only part that needs teaching"
              />
              <KpiCard
                variant="cell"
                label="Not attributed"
                value={totals.unattributed}
                unit={`of ${num(totals.totalLost)} lost`}
                caption="Too little evidence to name a cause"
              />
              {/* The score is quoted with a denominator only once the paper's
                  own maximum has arrived. A number out of the wrong
                  denominator is worse than one that shows up half a second
                  later. */}
              <KpiCard
                variant="cell"
                className="max-lg:col-span-2"
                label="Score on this paper"
                value={marksLost.data.score ?? row?.total ?? null}
                unit={maxMarks ? `of ${num(maxMarks)}` : undefined}
                caption={`${num(totals.totalLost)} marks lost in all — split below`}
              />
            </FigureBand>

            {totals.unattributed > 0 ? (
              <p className="flex max-w-3xl gap-2.5 px-1 text-sm leading-relaxed text-muted-foreground">
                <span
                  aria-hidden
                  className="mt-1.75 h-2.5 w-2.5 shrink-0 rounded-xs"
                  style={{ background: "var(--cause-unattributed)" }}
                />
                <span>
                  A further{" "}
                  <strong className="font-semibold text-foreground">
                    {num(totals.unattributed)} marks
                  </strong>{" "}
                  of the {num(totals.totalLost)} lost are not attributed to any
                  cause. Those questions come from chapters {name} has barely
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

          <Section
            title="Each cause, and what fixes it"
            description="Teaching closes a conceptual gap; drilling and paper strategy close the rest. The bucket the engine will not call is shown as exactly that."
          >
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {causeSlices(marksLost.data).map((slice) => (
                <li
                  key={slice.key}
                  className="flex flex-col rounded-xl bg-card p-5 shadow-card ring-1 ring-border"
                >
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="size-3 shrink-0 rounded-xs"
                      style={{ background: slice.color }}
                    />
                    <h3 className="text-sm font-medium text-foreground">
                      {slice.label}
                    </h3>
                  </div>
                  <p className="tnum mt-2 text-2xl leading-none font-semibold">
                    {num(slice.marks)}
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      {pct(slice.sharePct)}
                    </span>
                  </p>
                  <p className="mt-2 flex-1 text-xs leading-relaxed text-muted-foreground">
                    {slice.meaning}.
                  </p>
                  {/* Three outcomes, not two. The unattributed bucket is neither
                      a teaching job nor a drilling job — it is a question the
                      engine has not earned the right to answer yet, and saying
                      so is more useful than filing it under either. */}
                  <p className="mt-3 text-xs font-semibold">
                    {!slice.attributed ? (
                      <span className="text-muted-foreground">No call made yet</span>
                    ) : slice.needsNewLearning ? (
                      <span className="text-status-warn">Needs teaching</span>
                    ) : (
                      <span className="text-status-good">Needs drilling</span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </Section>

          {row ? (
            <Section
              title="By subject"
              description="What each subject contributed to this paper's total."
            >
              {/* One cell per subject of the exam, in the order the server
                  sends them — three for JEE, four for NEET. Two columns at four,
                  so the band's rule never shows a grey hole. */}
              <FigureBand
                role="list"
                aria-label="Subject scores in this paper"
                className={subjectsOf(row).length % 3 === 0 ? "sm:grid-cols-3" : "sm:grid-cols-2 xl:grid-cols-4"}
              >
                {subjectsOf(row).map((entry) => {
                  const subject = resolveSubject(entry.subject);
                  return (
                    <div key={entry.subject} role="listitem" className="bg-card px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="size-3 shrink-0 rounded-xs"
                          style={{ background: subject.color }}
                        />
                        <span className="text-xs font-medium text-muted-foreground">
                          {subject.label}
                        </span>
                      </div>
                      {/* No "/ 100". `MockScore` ships each subject's marks and
                          a total, and no per-subject maximum — and a paper out
                          of 184 does not split into thirds of 100 either. The
                          share of the paper's own total is a number we can
                          stand behind. */}
                      <p className="tnum mt-2 text-2xl leading-none font-semibold">
                        {num(entry.marks)}
                        {row.total > 0 ? (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {pct((entry.marks / row.total) * 100)} of the paper
                          </span>
                        ) : null}
                      </p>
                    </div>
                  );
                })}
              </FigureBand>
            </Section>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * The page's one sentence, from the paper's own split. It leads with whichever
 * job is bigger — drilling or teaching — and never says more than the counts
 * do. The rates it quotes are the server's (`recoverable_pct` divides by the
 * attributed loss); nothing here divides by `total_lost`.
 */
function mockHeadline(
  data: MarksLost,
  totals: MarksLostTotals,
  paperName: string,
  name: string,
): { title: ReactNode; support: ReactNode } {
  if (totals.attributed <= 0) {
    return {
      title: (
        <>
          None of the {num(totals.totalLost)} marks lost on {paperName} can be
          called yet.
        </>
      ),
      support: `They come from chapters ${name} has barely attempted, so naming a cause would be a guess.`,
    };
  }

  if (data.recoverable >= data.conceptual_gap) {
    return {
      title: (
        <>
          {num(data.recoverable)} marks on {paperName} were recoverable without
          learning anything new.
        </>
      ),
      support: (
        <>
          Only{" "}
          <strong className="font-semibold text-foreground">
            {num(data.conceptual_gap)} marks
          </strong>{" "}
          went to chapters where {name}&rsquo;s mastery is low. The rest of what we can
          explain went to execution, the clock and questions {name} could have
          answered — work for drilling and paper strategy, not more teaching.
        </>
      ),
    };
  }

  return {
    title: (
      <>
        {num(data.conceptual_gap)} marks on {paperName} went to chapters where{" "}
        {name}&rsquo;s mastery is low.
      </>
    ),
    support: (
      <>
        That is a teaching job. A further{" "}
        <strong className="font-semibold text-foreground">
          {num(data.recoverable)} marks
        </strong>{" "}
        were recoverable without learning anything new — execution, the clock
        and avoidable skips.
      </>
    ),
  };
}

function loadingHeadline(): { title: ReactNode; support: ReactNode } {
  return {
    title: (
      <>
        <span className="sr-only">Loading this paper</span>
        <span
          aria-hidden
          className="inline-block h-9 w-[24ch] max-w-full animate-pulse rounded-md bg-muted align-middle"
        />
      </>
    ),
    support: (
      <span
        aria-hidden
        className="inline-block h-4 w-[48ch] max-w-full animate-pulse rounded-md bg-muted align-middle"
      />
    ),
  };
}
