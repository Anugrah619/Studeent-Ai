import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import type { MockScore, MyProgress, MyTopic, TopicState } from "@/api/types";
import {
  ncertLinks,
  statusOf,
  useMyMarksLost,
  useMyMockScores,
  useMyPaperMaxima,
  useMyProfile,
  useMySubjectBreakdown,
  useMyTopicStates,
  useMyTopics,
} from "@/api/student";
import { KpiCard } from "@/components/kit/KpiCard";
import { Button } from "@/components/ui/button";
import { num, signed } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BalanceBars, CauseBar, Meter, ScoreColumns, ScoresTable, SubjectStrips } from "../charts";
import { plural, shortDay, uniq, whenText } from "../lib";
import { Block, LoadingRows, Quiet, ScreenHeader, Sheet, SubjectLabel, Trouble } from "../ui";

/**
 * Progress — the student's own dashboard: how regular they are, how their
 * mocks have gone, where their time and marks go, how strong each chapter is,
 * and where the marks on any one paper went.
 *
 * It shows the student-safe slice the server sends (`MyProgress` has no risk
 * score) and nothing more. A measure without enough answers behind it says so
 * in words — "not enough answers yet" — and is never drawn as a zero, because
 * for a student who is new to a chapter the two mean opposite things.
 */
export function Progress() {
  const profile = useMyProfile();
  const progress = profile.data?.progress ?? null;

  return (
    <>
      <ScreenHeader kicker="Progress" title="How your preparation is going.">
        Built from your mocks, your study log and your revisions.
        {progress?.computed_at ? ` Last brought up to date ${whenText(progress.computed_at).toLowerCase()}.` : ""}
      </ScreenHeader>

      {profile.isPending ? (
        <LoadingRows rows={2} label="Loading your progress" />
      ) : profile.error ? (
        <Trouble error={profile.error} what="your progress" onRetry={() => void profile.refetch()} />
      ) : (
        <Figures progress={progress} />
      )}

      <Scores />
      <Balance />
      <Chapters />
      <WhereMarksWent />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The four figures
 * ------------------------------------------------------------------ */

function NotYet({ children }: { children: string }) {
  return <span className="text-base font-medium text-muted-foreground">{children}</span>;
}

function Figures({ progress }: { progress: MyProgress | null }) {
  if (!progress) {
    return (
      <Quiet>
        Your figures appear after your first mock and a few logged sessions. They are worked out
        every night.
      </Quiet>
    );
  }
  const trend = progress.mock_trend;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard
        label="Days you studied"
        {...(progress.consistency === null
          ? { display: <NotYet>Not enough logged yet</NotYet> }
          : { value: Math.round(progress.consistency * 100), format: "percent" as const })}
        caption="of recent days had study logged"
      />
      <KpiCard
        label="Revisions waiting"
        value={progress.revision_debt}
        caption={progress.revision_debt === 0 ? "None past their date" : "past their date"}
        to="/revisions"
      />
      <KpiCard
        label="Mock average"
        {...(progress.mock_avg === null
          ? { display: <NotYet>No mocks yet</NotYet> }
          : { value: progress.mock_avg, format: "decimal" as const, digits: Number.isInteger(progress.mock_avg) ? 0 : 1 })}
        caption="marks across your papers"
        delta={
          trend === null || progress.mock_avg === null
            ? undefined
            : {
                text: `${signed(trend)}`,
                // Direction only. A fall is said plainly, never in red.
                tone: "neutral",
                direction: trend > 0 ? "up" : trend < 0 ? "down" : "flat",
                caption: `marks from your first paper to your latest`,
              }
        }
      />
      <KpiCard
        label="Syllabus taught"
        {...(progress.syllabus_pct === null
          ? { display: <NotYet>Not set yet</NotYet> }
          : { value: Math.round(progress.syllabus_pct), format: "percent" as const })}
        caption="of your batch's chapters, so far"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Mock scores
 * ------------------------------------------------------------------ */

function Scores() {
  const scores = useMyMockScores();
  const rows = scores.data ?? [];
  const maxima = useMyPaperMaxima(rows.map((r) => r.paper_id));
  const [table, setTable] = useState(false);

  return (
    <Block
      id="scores"
      title="Your mock scores"
      description="Every paper you've sat, oldest first."
      actions={
        rows.length ? (
          <Button variant="ghost" size="sm" aria-expanded={table} onClick={() => setTable((t) => !t)}>
            {table ? "Show as a chart" : "Show as a table"}
          </Button>
        ) : null
      }
    >
      {scores.isPending ? (
        <LoadingRows rows={2} label="Loading your mock scores" />
      ) : scores.error ? (
        <Trouble error={scores.error} what="your mock scores" onRetry={() => void scores.refetch()} />
      ) : !rows.length ? (
        <Quiet>No mocks yet. After your first one, your marks will show here, subject by subject.</Quiet>
      ) : (
        <Sheet className="px-4 py-4 sm:px-5">
          {table ? (
            <ScoresTable rows={rows} maxima={maxima} />
          ) : (
            <>
              <ScoreColumns rows={rows} maxima={maxima} />
              <h3 className="mt-6 text-sm font-semibold text-foreground">By subject</h3>
              <SubjectStrips rows={rows} />
            </>
          )}
        </Sheet>
      )}
    </Block>
  );
}

/* ------------------------------------------------------------------ *
 * Time against marks
 * ------------------------------------------------------------------ */

function Balance() {
  const breakdown = useMySubjectBreakdown();
  const rows = breakdown.data ?? [];
  // The one sentence worth saying: the subject whose share of lost marks most
  // outruns its share of study time, if the gap is large enough to matter.
  const story = [...rows]
    .map((r) => ({ ...r, gap: r.marks_lost_share_pct - r.time_share_pct }))
    .sort((a, b) => b.gap - a.gap)[0];

  return (
    <Block
      id="balance"
      title="Where your time goes, and where your marks go"
      description={
        story && story.gap >= 10
          ? `${story.subject} gets ${Math.round(story.time_share_pct)}% of your study time but accounts for ${Math.round(story.marks_lost_share_pct)}% of the marks you lose. A little more time there goes a long way.`
          : "Each subject's share of your study time, beside its share of the marks you lose."
      }
    >
      {breakdown.isPending ? (
        <LoadingRows rows={2} label="Loading your subject balance" />
      ) : breakdown.error ? (
        <Trouble error={breakdown.error} what="your subject balance" onRetry={() => void breakdown.refetch()} />
      ) : rows.length ? (
        <Sheet className="px-4 py-4 sm:px-5">
          <BalanceBars rows={rows} />
        </Sheet>
      ) : (
        <Quiet>This fills in once you&rsquo;ve logged some study and sat a mock.</Quiet>
      )}
    </Block>
  );
}

/* ------------------------------------------------------------------ *
 * Chapter strength
 * ------------------------------------------------------------------ */

function Chapters() {
  const topics = useMyTopics();
  const states = useMyTopicStates();
  const subjects = useMemo(() => uniq((topics.data ?? []).map((t) => t.subject)), [topics.data]);
  const [picked, setPicked] = useState<string | null>(null);
  const subject = picked ?? subjects[0] ?? null;

  const stateByTopic = useMemo(
    () => new Map((states.data ?? []).map((s) => [s.topic.id, s] as const)),
    [states.data],
  );

  const inSubject = (topics.data ?? []).filter((t) => t.subject === subject);
  const measured = inSubject.filter((t) => stateByTopic.get(t.id)?.mastery != null).length;

  return (
    <Block
      id="chapters"
      title="How strong each chapter is"
      description="From your answers. A chapter needs a few answers before it can be measured."
    >
      {topics.isPending || states.isPending ? (
        <LoadingRows rows={3} label="Loading your chapters" />
      ) : topics.error || states.error ? (
        <Trouble
          error={topics.error ?? states.error}
          what="your chapters"
          onRetry={() => {
            void topics.refetch();
            void states.refetch();
          }}
        />
      ) : subject === null ? (
        <Quiet>Your syllabus isn&rsquo;t set up yet. Your mentor can sort that out.</Quiet>
      ) : (
        <>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Subject">
            {subjects.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={s === subject}
                onClick={() => setPicked(s)}
                className={cn(
                  "h-9 shrink-0 rounded-md border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  s === subject
                    ? "border-brand bg-brand-soft text-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                <SubjectLabel subject={s} />
              </button>
            ))}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {measured} of {plural(inSubject.length, "chapter")} in {subject} have enough answers to
            measure.
          </p>
          <Sheet as="ul" className="mt-2 divide-y divide-border">
            {inSubject.map((topic) => (
              <ChapterRow key={topic.id} topic={topic} state={stateByTopic.get(topic.id)} />
            ))}
          </Sheet>
        </>
      )}
    </Block>
  );
}

function ChapterRow({ topic, state }: { topic: MyTopic; state: TopicState | undefined }) {
  const links = ncertLinks(topic.ncert_ref);
  const answered = state?.attempts_n ?? 0;
  return (
    <li className="px-4 py-3.5" data-topic-id={topic.id}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <div className="min-w-0">
          <p className="text-sm leading-snug font-semibold text-foreground">{topic.name}</p>
          {topic.unit && topic.unit !== topic.name ? (
            <p className="text-xs text-muted-foreground">{topic.unit}</p>
          ) : null}
        </div>
        {state?.mastery != null ? (
          <Meter value={state.mastery * 100} label={`Strength in ${topic.name}`} />
        ) : (
          <span className="text-sm text-muted-foreground">
            {answered === 0 ? "No answers yet" : "Not enough answers yet"}
          </span>
        )}
      </div>
      {links.length ? (
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-brand-ink underline decoration-brand-line underline-offset-4"
            >
              Read in NCERT: {link.label}
              <span className="sr-only">, {link.title} (opens the PDF)</span>
              <ArrowUpRight aria-hidden className="size-3.5" />
            </a>
          ))}
        </p>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * Where my marks went, per paper
 * ------------------------------------------------------------------ */

function WhereMarksWent() {
  const scores = useMyMockScores();
  const [params, setParams] = useSearchParams();
  const rows: MockScore[] = scores.data ?? [];
  const latest = rows.at(-1)?.paper_id;
  const asked = Number(params.get("paper"));
  const paper = rows.some((r) => r.paper_id === asked) ? asked : latest;
  const marks = useMyMarksLost(paper);

  return (
    <Block id="marks" title="Where your marks went" description="On one paper: the marks you didn't get, and why.">
      {scores.isPending ? (
        <LoadingRows rows={2} label="Loading your papers" />
      ) : scores.error ? (
        <Trouble error={scores.error} what="your papers" onRetry={() => void scores.refetch()} />
      ) : !rows.length || paper === undefined ? (
        <Quiet>After your first mock, this shows where the marks you didn&rsquo;t get went.</Quiet>
      ) : (
        <Sheet className="px-4 py-4 sm:px-5">
          <label htmlFor="marks-paper" className="text-sm font-medium text-foreground">
            Paper
          </label>
          <select
            id="marks-paper"
            value={paper}
            onChange={(e) => setParams({ paper: e.target.value }, { replace: true, preventScrollReset: true })}
            className="mt-1.5 block h-10 w-full max-w-sm rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
          >
            {[...rows].reverse().map((r) => (
              <option key={r.paper_id} value={r.paper_id}>
                {r.paper_name}, {shortDay(r.held_on)}
              </option>
            ))}
          </select>

          <div className="mt-5" aria-live="polite">
            {marks.isPending ? (
              <LoadingRows rows={1} label="Loading this paper" />
            ) : marks.error ? (
              statusOf(marks.error) === 404 ? (
                <Quiet>No answers of yours are recorded on that paper.</Quiet>
              ) : (
                <Trouble error={marks.error} what="this paper" onRetry={() => void marks.refetch()} />
              )
            ) : marks.data ? (
              <>
                <p className="font-serif text-lg leading-snug text-foreground">
                  You scored {num(marks.data.score)} of {num(marks.data.max_marks)}.
                  {marks.data.total_lost > 0
                    ? ` Here's where the other ${num(marks.data.total_lost)} went.`
                    : " Nothing was lost on this one."}
                </p>
                {marks.data.total_lost > 0 ? (
                  <>
                    <div className="mt-4">
                      <CauseBar data={marks.data} />
                    </div>
                    <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                      {marks.data.attributed_lost > 0
                        ? `${num(marks.data.recoverable)} of the ${num(marks.data.attributed_lost)} marks we can explain needed no new learning: care, time, or a first look would have won them.`
                        : "There weren't enough of your answers in these chapters to explain any of the marks yet."}
                    </p>
                  </>
                ) : null}
                <p className="mt-4 text-sm">
                  <Link
                    to={`/mistakes?paper=${marks.data.paper_id}`}
                    className="font-medium text-brand-ink underline decoration-brand-line underline-offset-4"
                  >
                    Go over your wrong answers on this paper
                  </Link>
                </p>
              </>
            ) : null}
          </div>
        </Sheet>
      )}
    </Block>
  );
}
