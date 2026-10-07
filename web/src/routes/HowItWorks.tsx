import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Calculator,
  Check,
  CircleDashed,
  ClipboardList,
  Clock,
  Hand,
  Lock,
  Minus,
  Quote,
  Scale,
  Sparkles,
  UserCheck,
  X,
} from "lucide-react";
import type { Attempt, DashboardSummary, MarksLost } from "@/api/types";
import { timeToFixLabel, type Diagnosis } from "@/api/diagnosis";
import {
  chosenMisconception,
  chosenOption,
  type QuestionDetail,
} from "@/api/questions";
import {
  isNotEnoughEvidence,
  isReasoningUnavailable,
  useAttempts,
  useDashboardSummary,
  useDiagnosis,
  useMarksLost,
  useQuestionsFor,
  useStudent,
} from "@/api/queries";
import {
  ConfidenceMeter,
  EvidenceChip,
} from "@/components/student/DiagnosisCard";
import {
  Exhibit,
  ExhibitNote,
  ExhibitSkeleton,
  Eyebrow,
  Figure,
} from "@/components/explainer/Exhibit";
import {
  EXAMPLE_STUDENT_ID,
  capitalise,
  chapterTally,
  firstName,
  labelsNamedIn,
  plural,
  pseudonymFor,
  repeatedMistakes,
  resolvedEvidence,
  tallySheet,
  type RepeatedMistake,
  type SheetTally,
} from "@/lib/explainer";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * How it works — four steps, each shown on a live example.
 *
 * Written for a coaching-institute director who has two minutes and has sat
 * through many ed-tech demos. The page's whole claim is "this is the system,
 * not a slide about it", so nothing below is a screenshot or hardcoded copy of
 * a result: the paper is the institute's latest (from the dashboard summary),
 * the student is the demo's hero, and every figure, quote and citation is read
 * from the same routes the console uses. The only fixed choice is *which*
 * student to show, and that is a choice, not a number.
 *
 * The four steps keep the product's one architectural rule visible, because
 * it is also the answer to "why should I trust it": counting is code and is
 * exact (steps 1–2), judgement is the AI (step 3), and a teacher has the last
 * word (step 4). A director who remembers nothing else should remember that the
 * AI never produces a number.
 */
export function HowItWorks() {
  const studentId = EXAMPLE_STUDENT_ID;
  const summary = useDashboardSummary();
  const paperId = summary.data?.latest_paper_id ?? undefined;

  const student = useStudent(studentId);
  const diagnosis = useDiagnosis(studentId, paperId);
  const sheet = useAttempts(studentId, paperId);
  const marksLost = useMarksLost(studentId, paperId ?? Number.NaN);

  // Every question the diagnosis cites, as this student answered it. Shares its
  // cache with the question panel each evidence chip opens.
  const cited = diagnosis.data ? resolvedEvidence(diagnosis.data) : [];
  const citedQueries = useQuestionsFor(
    cited.map((row) => row.question_id),
    studentId,
  );
  const citedQuestions = citedQueries
    .map((query) => query.data)
    .filter((q): q is QuestionDetail => q !== undefined);
  // Still settling while any is loading — including a retry of one that failed
  // earlier — so the tally never shows a transitional "4×" on its way to "5×".
  const citedPending = citedQueries.some(
    (query) => query.isPending || (query.isError && query.isFetching),
  );
  const citedFailed = citedQueries.filter(
    (query) => query.isError && !query.isFetching,
  ).length;

  // The answer the page puts under the microscope: the first citation of the
  // strongest finding — chosen by the diagnosis, not by this file.
  const spotlight = citedQuestions.find((q) => q.id === cited[0]?.question_id);

  const name = student.data?.name ?? "this student";
  const who = student.data ? firstName(student.data.name) : "the student";
  const paperName = summary.data?.latest_paper_name ?? diagnosis.data?.paper_name ?? null;

  const ctx: Ctx = {
    studentId,
    name,
    who,
    paperName,
    summary: summary.data,
    noPaper: summary.isSuccess && paperId === undefined,
  };

  return (
    <div className="py-6">
      <Intro ctx={ctx} pending={summary.isPending || student.isPending} />
      <StepRail />

      <div className="mt-8 space-y-12">
        <Step
          n={1}
          id="step-record"
          who="The system"
          icon={<ClipboardList aria-hidden className="size-3.5" />}
          title="Every answer is recorded — including which option was chosen"
          promise="A cross says he got it wrong. The option he chose says why."
          lede={
            <>
              <p>
                Most test software keeps a tick or a cross. We keep the option
                the student actually picked.
              </p>
              <p>
                That matters because, on our diagnostic paper, the tempting
                wrong options are labelled in advance with the specific mistake
                that leads a student to choose them. So a wrong answer is not
                just a lost mark — it is a clue.
              </p>
            </>
          }
        >
          <RecordExhibit
            ctx={ctx}
            sheet={sheet.data}
            sheetPending={sheet.isPending}
            sheetError={sheet.error}
            spotlight={spotlight}
            spotlightPending={diagnosis.isPending || citedPending}
          />
        </Step>

        <Step
          n={2}
          id="step-count"
          who="Plain arithmetic — no AI"
          icon={<Calculator aria-hidden className="size-3.5" />}
          title="We count, exactly"
          promise="The numbers are never guessed. The same answers always give the same numbers."
          lede={
            <>
              <p>
                Next, the system counts: the score, how many answers were right,
                the marks lost and which chapters they were lost in, and which
                labelled wrong options keep coming back.
              </p>
              <p>
                This is ordinary arithmetic on the recorded answers. No AI is
                involved in this step, and none of these figures is ever
                produced by one.
              </p>
            </>
          }
        >
          <CountExhibit
            ctx={ctx}
            sheet={sheet.data}
            marksLost={marksLost.data}
            pending={sheet.isPending || marksLost.isPending}
            error={sheet.error ?? marksLost.error}
            repeats={repeatedMistakes(citedQuestions)}
            repeatsPending={diagnosis.isPending || citedPending}
            repeatsUnchecked={citedFailed}
          />
        </Step>

        <Step
          n={3}
          id="step-reason"
          who="The AI"
          icon={<Sparkles aria-hidden className="size-3.5" />}
          title="The AI reads the pattern"
          promise="The line that matters is what he got right — because that is what narrows a weak chapter down to one fixable trigger."
          lede={
            <>
              <p>
                Only now is the AI involved. It is handed the counts, the
                questions and the options {who} chose — with his name replaced
                by a code — and asked what a good teacher would ask: is this one
                repeated misunderstanding, or scattered slips?
              </p>
              <p>
                It is also shown the questions he got <em>right</em> in the same
                chapters. Those are what separate “weak at the chapter” from
                “goes wrong on one specific kind of question”.
              </p>
            </>
          }
        >
          <ReasonExhibit
            ctx={ctx}
            diagnosis={diagnosis.data}
            pending={summary.isPending || diagnosis.isPending}
            error={diagnosis.error}
            sheet={sheet.data}
          />
        </Step>

        <Step
          n={4}
          id="step-check"
          who="A teacher"
          icon={<UserCheck aria-hidden className="size-3.5" />}
          title="A teacher checks it, and the system learns"
          promise="Nothing has to be taken on trust: every claim opens to the answers behind it."
          lede={
            <>
              <p>
                Every claim links to the answers it rests on. A teacher opens
                any of them and sees the question, the option the student chose,
                and the belief that leads to that option — then agrees or
                disagrees.
              </p>
              <p>
                That judgement is saved alongside the AI&rsquo;s reasoning. Over
                time those checked examples become the training material for
                our own model — one that has learned from your teachers.
              </p>
            </>
          }
        >
          <CheckExhibit
            ctx={ctx}
            diagnosis={diagnosis.data}
            pending={summary.isPending || diagnosis.isPending}
            error={diagnosis.error}
            spotlight={spotlight}
          />
        </Step>
      </div>

      <NextSteps studentId={studentId} who={who} />
    </div>
  );
}

interface Ctx {
  studentId: number;
  name: string;
  who: string;
  paperName: string | null;
  summary: DashboardSummary | undefined;
  /** The summary answered and named no paper: nothing has been sat yet. */
  noPaper: boolean;
}

/* ------------------------------------------------------------------ *
 * Chrome
 * ------------------------------------------------------------------ */

function Intro({ ctx, pending }: { ctx: Ctx; pending: boolean }) {
  return (
    <header className="max-w-3xl">
      <Eyebrow>How it works</Eyebrow>
      <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-balance sm:text-[1.75rem]">
        From an answer sheet to a teaching decision, in four steps
      </h1>
      <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground sm:text-[0.9375rem]">
        Each step is shown on a real example from this system —{" "}
        {pending ? (
          "one student's answers to the latest paper"
        ) : (
          <>
            <span className="font-medium text-foreground">{ctx.name}</span>
            &rsquo;s answers to{" "}
            <span className="font-medium text-foreground">
              {ctx.paperName ?? "the latest paper"}
            </span>
          </>
        )}{" "}
        — and the diagnosis it made from them. Every panel is read from the
        system as this page loads: what you see is what a teacher sees, not a
        screenshot.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {capitalise(ctx.who)} is one of this
        demo&rsquo;s simulated students and the paper is our own; the AI&rsquo;s
        diagnosis is real.{" "}
        <Link
          to="/trust"
          className="font-medium text-foreground underline underline-offset-4"
        >
          What&rsquo;s real and what&rsquo;s simulated
        </Link>
      </p>
    </header>
  );
}

const RAIL = [
  { id: "step-record", verb: "Record", who: "The system", icon: ClipboardList },
  { id: "step-count", verb: "Count", who: "Plain arithmetic", icon: Calculator },
  { id: "step-reason", verb: "Explain", who: "The AI", icon: Sparkles },
  { id: "step-check", verb: "Check", who: "A teacher", icon: UserCheck },
] as const;

/**
 * The four steps at a glance, and who does each one.
 *
 * The "who" row is the point: it puts the AI in exactly one of four boxes,
 * between two that are code and one that is a person. Doubles as in-page
 * navigation for a presenter who wants to jump to step 3.
 */
function StepRail() {
  return (
    <nav aria-label="The four steps" className="mt-6">
      <ol className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {RAIL.map((step, i) => (
          <li key={step.id} className="min-w-0">
            <a
              href={`#${step.id}`}
              className={cn(
                "flex h-full min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50",
                step.id === "step-reason"
                  ? "border-foreground/30 bg-card"
                  : "border-border bg-card",
              )}
            >
              <span className="tnum flex size-7 shrink-0 items-center justify-center rounded-full border border-foreground/25 text-xs font-semibold text-foreground">
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">
                  {step.verb}
                </span>
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <step.icon aria-hidden className="size-3" />
                  {step.who}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Step({
  n,
  id,
  who,
  icon,
  title,
  lede,
  promise,
  children,
}: {
  n: number;
  id: string;
  who: string;
  icon: ReactNode;
  title: string;
  lede: ReactNode;
  promise: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="grid scroll-mt-20 gap-5 border-t border-border pt-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)] lg:gap-10"
    >
      <div className="min-w-0 lg:sticky lg:top-20 lg:self-start">
        <div className="flex items-center gap-2.5">
          <span className="tnum flex size-7 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
            {n}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
            {icon}
            {who}
          </span>
        </div>
        <h2
          id={`${id}-title`}
          className="mt-3 text-lg leading-snug font-semibold tracking-tight text-balance text-foreground sm:text-xl"
        >
          {title}
        </h2>
        <div className="mt-2.5 max-w-prose space-y-2.5 text-sm leading-relaxed text-muted-foreground">
          {lede}
        </div>
        <p className="mt-4 max-w-prose border-l-2 border-foreground/70 pl-3 text-sm leading-relaxed font-medium text-foreground">
          {promise}
        </p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Step 1 — the record
 * ------------------------------------------------------------------ */

const ATTEMPTS_ROUTE = "/api/students/{id}/attempts/?paper=";
const QUESTION_ROUTE = "/api/questions/{id}/?student=";
const MARKS_LOST_ROUTE = "/api/students/{id}/marks-lost/?paper=";
const DIAGNOSIS_ROUTE = "/api/students/{id}/diagnosis/?paper=";
const SUMMARY_ROUTE = "/api/dashboard/summary/";

function RecordExhibit({
  ctx,
  sheet,
  sheetPending,
  sheetError,
  spotlight,
  spotlightPending,
}: {
  ctx: Ctx;
  sheet: Attempt[] | undefined;
  sheetPending: boolean;
  sheetError: Error | null;
  spotlight: QuestionDetail | undefined;
  spotlightPending: boolean;
}) {
  return (
    <Exhibit
      title={`${ctx.who}'s answer sheet${ctx.paperName ? ` · ${ctx.paperName}` : ""}`}
      endpoints={[ATTEMPTS_ROUTE, QUESTION_ROUTE]}
    >
      {ctx.noPaper ? (
        <ExhibitNote>
          No paper has been sat in this institute yet, so there is no answer
          sheet to show.
        </ExhibitNote>
      ) : sheetError ? (
        <ExhibitNote detail={sheetError.message}>
          The answer sheet could not be loaded just now.
        </ExhibitNote>
      ) : sheetPending || !sheet ? (
        <ExhibitSkeleton lines={4} />
      ) : (
        <AnswerSheet rows={sheet} highlight={spotlight?.label} />
      )}

      <div className="mt-5 border-t border-border pt-4">
        {spotlight ? (
          <AnswerRecord question={spotlight} who={ctx.who} />
        ) : spotlightPending && !ctx.noPaper ? (
          <ExhibitSkeleton lines={5} />
        ) : (
          <ExhibitNote>
            There is no cited wrong answer to open here — the diagnosis has
            not named one.
          </ExhibitNote>
        )}
      </div>
    </Exhibit>
  );
}

const STATUS_MARK: Record<
  Attempt["status"],
  { icon: typeof Check; word: string; cell: string; ink: string }
> = {
  correct: {
    icon: Check,
    word: "right",
    cell: "border-border bg-background",
    ink: "text-status-good",
  },
  wrong: {
    icon: X,
    word: "wrong",
    cell: "border-status-critical/45 bg-status-critical/[0.07]",
    ink: "text-status-critical",
  },
  blank: {
    icon: Minus,
    word: "skipped",
    cell: "border-dashed border-border bg-muted/40",
    ink: "text-muted-foreground",
  },
  not_reached: {
    icon: Clock,
    word: "not reached",
    cell: "border-dashed border-border bg-muted/40",
    ink: "text-muted-foreground",
  },
};

/**
 * Every question on the paper, one cell each.
 *
 * Right and wrong are told apart by an icon and by the word in the cell's
 * accessible name, never by the tint alone. The cited answer the record below
 * opens is ringed, so the eye goes from the sheet to the record without being
 * told to.
 */
function AnswerSheet({ rows, highlight }: { rows: Attempt[]; highlight?: string }) {
  const tally = tallySheet(rows);
  return (
    <div>
      <SheetLegend tally={tally} />
      <ol
        aria-label="Answer sheet, one entry per question"
        className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1"
      >
        {rows.map((row) => {
          const mark = STATUS_MARK[row.status];
          const Icon = mark.icon;
          const ringed = row.question_id === highlight;
          return (
            <li
              key={row.id}
              title={`${row.question_id} · ${row.topic_name} · ${mark.word}${row.time_spent != null ? ` · ${row.time_spent}s` : ""}`}
              className={cn(
                "flex h-10 flex-col items-center justify-center rounded-md border",
                mark.cell,
                ringed && "ring-2 ring-foreground ring-offset-1 ring-offset-card",
              )}
            >
              <span className="tnum font-mono text-[10px] leading-none text-muted-foreground">
                {row.question_id}
              </span>
              <Icon aria-hidden className={cn("mt-1 size-3.5", mark.ink)} />
              <span className="sr-only">
                {`${row.topic_name}: ${mark.word}`}
                {ringed ? " — opened below" : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SheetLegend({ tally }: { tally: SheetTally }) {
  const items: { status: Attempt["status"]; n: number }[] = [
    { status: "correct", n: tally.correct },
    { status: "wrong", n: tally.wrong },
    { status: "blank", n: tally.blank },
    { status: "not_reached", n: tally.notReached },
  ];
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="tnum font-medium text-foreground">
        {plural(tally.total, "question")}
      </span>
      {items
        .filter((item) => item.n > 0 || item.status !== "not_reached")
        .map((item) => {
          const mark = STATUS_MARK[item.status];
          const Icon = mark.icon;
          return (
            <span key={item.status} className="inline-flex items-center gap-1">
              <Icon aria-hidden className={cn("size-3.5", mark.ink)} />
              <span className="tnum font-medium text-foreground">{num(item.n)}</span>{" "}
              {mark.word}
            </span>
          );
        })}
    </p>
  );
}

/** One answer, as stored: the question, the four options, the choice. */
function AnswerRecord({ question, who }: { question: QuestionDetail; who: string }) {
  const chosen = chosenOption(question);
  return (
    <div>
      <Eyebrow>
        One answer, as the system stores it ·{" "}
        <span className="font-mono normal-case tracking-normal text-foreground">
          {question.label}
        </span>
      </Eyebrow>
      <p className="mt-2 max-w-[60ch] text-sm leading-relaxed font-medium text-foreground">
        {question.question_text || "This question has no text on file."}
      </p>

      <ol className="mt-3 space-y-1" aria-label="Options">
        {question.options.map((option) => {
          const picked = option.chosen === true;
          return (
            <li
              key={option.label}
              className={cn(
                "flex flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-md border px-2.5 py-1.5 text-sm",
                option.is_correct
                  ? "border-status-good/45 bg-status-good/[0.06]"
                  : picked
                    ? "border-status-critical/45 bg-status-critical/[0.06]"
                    : "border-border",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "tnum flex size-5 shrink-0 items-center justify-center self-center rounded border font-mono text-[10px] font-semibold",
                  picked
                    ? "border-transparent bg-foreground text-background"
                    : "border-border bg-muted text-muted-foreground",
                )}
              >
                {option.label}
              </span>
              <span className="min-w-0 flex-1 text-foreground">
                <span className="sr-only">Option {option.label}: </span>
                {option.text}
              </span>
              {option.is_correct ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold tracking-wide text-status-good uppercase">
                  <Check aria-hidden className="size-3.5" />
                  Correct
                </span>
              ) : null}
              {picked ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-[11px] font-semibold tracking-wide uppercase",
                    option.is_correct ? "text-foreground" : "text-status-critical",
                  )}
                >
                  <Hand aria-hidden className="size-3.5" />
                  {who} chose this
                </span>
              ) : null}
              {option.misconception ? (
                <span className="basis-full pl-7.5 text-xs text-muted-foreground">
                  Labelled in advance:{" "}
                  <code className="rounded border border-border bg-muted px-1 py-px font-mono text-[10px] text-foreground">
                    {option.misconception.code}
                  </code>{" "}
                  {option.misconception.name}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
        <RecordField label="Chose" value={chosen ? `(${chosen.label})` : "—"} />
        <RecordField
          label="Result"
          value={question.status === "wrong" ? "Wrong" : question.status === "correct" ? "Right" : "—"}
        />
        <RecordField
          label="Marks"
          value={
            question.marks == null
              ? "—"
              : `${question.marks > 0 ? "+" : question.marks < 0 ? "−" : ""}${num(Math.abs(question.marks))}`
          }
        />
        <RecordField
          label="Time taken"
          value={question.time_spent == null ? "—" : `${num(question.time_spent)} s`}
        />
      </dl>
    </div>
  );
}

function RecordField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tnum font-mono text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Step 2 — the count
 * ------------------------------------------------------------------ */

function CountExhibit({
  ctx,
  sheet,
  marksLost,
  pending,
  error,
  repeats,
  repeatsPending,
  repeatsUnchecked,
}: {
  ctx: Ctx;
  sheet: Attempt[] | undefined;
  marksLost: MarksLost | undefined;
  pending: boolean;
  error: Error | null;
  repeats: RepeatedMistake[];
  repeatsPending: boolean;
  /** Cited answers whose question could not be loaded, so were not counted. */
  repeatsUnchecked: number;
}) {
  if (ctx.noPaper) {
    return (
      <Exhibit title="What the counting shows" endpoints={[MARKS_LOST_ROUTE]}>
        <ExhibitNote>No paper has been sat yet, so there is nothing to count.</ExhibitNote>
      </Exhibit>
    );
  }

  const tally = sheet ? tallySheet(sheet) : null;
  const top = marksLost?.top_loss_topics[0];
  const topChapter = top && sheet ? chapterTally(sheet, top.topic) : null;
  const summary = ctx.summary;

  return (
    <div className="space-y-3">
      <Exhibit
        title={`What the counting shows · ${ctx.who}`}
        endpoints={[MARKS_LOST_ROUTE, ATTEMPTS_ROUTE, QUESTION_ROUTE, SUMMARY_ROUTE]}
        footer={
          summary?.batch_mock_avg != null &&
          summary.latest_paper_max_marks &&
          summary.latest_paper_students ? (
            <>
              The same counting ran for every one of the{" "}
              <span className="tnum font-medium text-foreground">
                {num(summary.latest_paper_students)}
              </span>{" "}
              students who sat this paper. Their average:{" "}
              <span className="tnum font-medium text-foreground">
                {num(summary.batch_mock_avg, 1)} of {num(summary.latest_paper_max_marks)}
              </span>
              .
            </>
          ) : null
        }
      >
        {error ? (
          <ExhibitNote detail={error.message}>
            The counts could not be loaded just now.
          </ExhibitNote>
        ) : pending || !marksLost || !tally ? (
          <ExhibitSkeleton lines={5} />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              <Figure
                label="Score"
                value={num(marksLost.score)}
                of={`of ${num(marksLost.max_marks)}`}
              />
              <Figure
                label="Right answers"
                value={num(tally.correct)}
                of={`of ${num(tally.total)}`}
                caption={
                  tally.answered
                    ? `${num(Math.round((tally.correct / tally.answered) * 100))}% of those he answered`
                    : undefined
                }
              />
              <Figure
                label="Marks lost"
                value={num(marksLost.total_lost)}
                caption="between his score and full marks"
              />
              <Figure
                label="Same wrong option, repeated"
                value={
                  repeatsPending ? "…" : repeats[0] ? `${num(repeats[0].questions.length)}×` : "—"
                }
                caption={
                  repeats[0]
                    ? repeats[0].misconception.name
                    : repeatsPending
                      ? undefined
                      : "no labelled option chosen twice"
                }
              />
            </dl>

            <ChapterLosses marksLost={marksLost} />
            <Repeats
              repeats={repeats}
              pending={repeatsPending}
              unchecked={repeatsUnchecked}
              who={ctx.who}
            />
          </>
        )}
      </Exhibit>

      {top && topChapter && topChapter.asked > 0 ? (
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3.5 text-sm leading-relaxed">
          <p className="text-muted-foreground">
            This is where most products stop:{" "}
            <span className="font-medium text-foreground">
              &ldquo;weak in {top.topic} — revise the chapter.&rdquo;
            </span>
          </p>
          <p className="mt-1.5 text-foreground">
            {topChapter.correct * 2 > topChapter.asked ? "But " : ""}
            {ctx.who} answered{" "}
            <span className="tnum font-semibold">
              {num(topChapter.correct)} of {num(topChapter.asked)}
            </span>{" "}
            {top.topic} questions correctly on this paper.
            {topChapter.correct * 2 > topChapter.asked
              ? " Re-teaching the whole chapter would re-teach what he already knows. Step 3 finds what is actually going wrong."
              : " Step 3 asks whether one misunderstanding explains the losses."}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Marks lost by chapter — a single-series bar list.
 *
 * One neutral hue (this is magnitude, not identity or status), thin bars
 * anchored at zero, and the value written beside every bar because there are
 * at most five and the values are the point. Every figure is also in the text,
 * so there is no separate table view to fall out of step.
 */
function ChapterLosses({ marksLost }: { marksLost: MarksLost }) {
  const rows = marksLost.top_loss_topics.slice(0, 5);
  if (!rows.length) return null;
  const max = Math.max(...rows.map((row) => row.marks_lost), 1);
  const rest = marksLost.top_loss_topics.length - rows.length;
  return (
    <div className="mt-5">
      <Eyebrow id="chapter-losses">Where the marks went, by chapter</Eyebrow>
      <ul aria-labelledby="chapter-losses" className="mt-2 space-y-1.5">
        {rows.map((row) => (
          <li
            key={row.topic_id}
            className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] items-center gap-3 text-xs sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto]"
          >
            <span className="truncate text-foreground" title={row.topic}>
              {row.topic}
            </span>
            <span aria-hidden className="h-2 min-w-0 overflow-hidden rounded-r-[4px] bg-foreground/[0.06]">
              <span
                className="block h-full rounded-r-[4px] bg-foreground/60"
                style={{ width: `${(row.marks_lost / max) * 100}%` }}
              />
            </span>
            <span className="tnum text-right whitespace-nowrap text-muted-foreground">
              <span className="font-medium text-foreground">−{num(row.marks_lost)}</span> ·{" "}
              {plural(row.questions, "question")}
            </span>
          </li>
        ))}
      </ul>
      {rest > 0 ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          and {plural(rest, "more chapter")}
        </p>
      ) : null}
    </div>
  );
}

function Repeats({
  repeats,
  pending,
  unchecked,
  who,
}: {
  repeats: RepeatedMistake[];
  pending: boolean;
  unchecked: number;
  who: string;
}) {
  return (
    <div className="mt-5">
      <Eyebrow>Wrong options that repeat</Eyebrow>
      {pending ? (
        <div className="mt-2">
          <ExhibitSkeleton lines={2} />
        </div>
      ) : repeats.length === 0 ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          None of {who}&rsquo;s cited wrong answers chose a labelled option, so
          there is nothing to tally.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {repeats.map((entry) => (
            <li key={entry.misconception.code} className="text-xs leading-relaxed">
              <p className="text-foreground">
                <code className="rounded border border-border bg-muted px-1 py-px font-mono text-[10px]">
                  {entry.misconception.code}
                </code>{" "}
                <span className="font-medium">{entry.misconception.name}</span>
                <span className="text-muted-foreground">
                  {" "}
                  — chosen on {plural(entry.questions.length, "question")}
                </span>
              </p>
              <p className="tnum mt-1 flex flex-wrap gap-1">
                {entry.questions.map((q) => (
                  <span
                    key={q.questionId}
                    className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground"
                  >
                    {q.label}
                    <span className="text-muted-foreground"> chose {q.chose}</span>
                  </span>
                ))}
              </p>
            </li>
          ))}
          <li className="text-[11px] leading-relaxed text-muted-foreground">
            Read from the label on the option he chose, one question at a time —
            over the answers the diagnosis cites.
            {unchecked > 0
              ? ` ${plural(unchecked, "cited answer")} could not be loaded just now, so ${unchecked === 1 ? "it is" : "they are"} not counted.`
              : ""}
          </li>
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Step 3 — the AI
 * ------------------------------------------------------------------ */

function ReasonExhibit({
  ctx,
  diagnosis,
  pending,
  error,
  sheet,
}: {
  ctx: Ctx;
  diagnosis: Diagnosis | undefined;
  pending: boolean;
  error: Error | null;
  sheet: Attempt[] | undefined;
}) {
  const lead = diagnosis?.hypotheses[0];
  const confirmed = lead && sheet ? labelsNamedIn(lead.counter_evidence, sheet) : [];
  const band = timeToFixLabel(diagnosis?.time_to_fix);

  return (
    <Exhibit
      title={
        diagnosis?.trace_id
          ? `The AI's diagnosis · trace #${diagnosis.trace_id}`
          : "The AI's diagnosis"
      }
      endpoints={[DIAGNOSIS_ROUTE, ATTEMPTS_ROUTE]}
      footer={
        diagnosis ? (
          <span className="inline-flex items-start gap-1.5">
            <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>
              The AI saw this student only as &ldquo;Student{" "}
              {pseudonymFor(ctx.studentId)}&rdquo; — never a name. Every number
              on this card was counted by the system, not by the AI.{" "}
              <Link
                to="/trust#privacy"
                className="font-medium text-foreground underline underline-offset-4"
              >
                What the AI never sees
              </Link>
            </span>
          </span>
        ) : null
      }
    >
      {ctx.noPaper ? (
        <ExhibitNote>No paper has been sat yet, so there is nothing to diagnose.</ExhibitNote>
      ) : error ? (
        <DiagnosisUnavailable error={error} />
      ) : pending || !diagnosis ? (
        <ExhibitSkeleton lines={6} />
      ) : (
        <div>
          <p className="max-w-[48ch] text-lg leading-snug font-semibold tracking-tight text-balance text-foreground sm:text-xl">
            {diagnosis.headline || "No diagnosis text was returned for this paper."}
          </p>

          {lead ? (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <code className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground">
                  {lead.misconception_code}
                </code>
                <ConfidenceMeter level={lead.confidence} />
              </div>
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-foreground">
                {lead.claim}
              </p>

              {lead.counter_evidence ? (
                <div className="mt-4 border-l-[3px] border-status-good bg-status-good/[0.07] py-3 pr-3.5 pl-3.5">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-foreground uppercase">
                    <Scale aria-hidden className="size-3.5" />
                    Why it&rsquo;s one trigger, not a weak chapter
                  </p>
                  <p className="mt-1.5 max-w-prose text-[0.9375rem] leading-relaxed text-foreground">
                    {lead.counter_evidence}
                  </p>
                  {confirmed.length ? (
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
                      <span className="text-muted-foreground">
                        Checked against {ctx.who}&rsquo;s answer sheet:
                      </span>
                      {confirmed.map((row) => (
                        <span
                          key={row.id}
                          className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5"
                        >
                          <span className="tnum font-mono text-[11px] text-foreground">
                            {row.question_id}
                          </span>
                          {row.status === "correct" ? (
                            <Check aria-hidden className="size-3.5 text-status-good" />
                          ) : (
                            <X aria-hidden className="size-3.5 text-status-critical" />
                          )}
                          <span className="text-muted-foreground">
                            {STATUS_MARK[row.status].word}
                          </span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground">
              The AI found no repeated misunderstanding on this paper — and says
              so, rather than inventing one.
            </p>
          )}

          <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {diagnosis.total_marks_at_stake > 0 ? (
              <span>
                <span className="tnum font-semibold text-foreground">
                  {num(diagnosis.total_marks_at_stake)} marks
                </span>{" "}
                at stake
              </span>
            ) : null}
            {diagnosis.total_marks_at_stake > 0 && band ? (
              <span aria-hidden className="text-border">
                ·
              </span>
            ) : null}
            {band ? (
              <span className="inline-flex items-center gap-1.5">
                <Clock aria-hidden className="size-3.5" />
                About {band.toLowerCase()} to fix
              </span>
            ) : null}
            {diagnosis.hypotheses.length > 1 ? (
              <>
                <span aria-hidden className="text-border">
                  ·
                </span>
                <span>
                  {plural(diagnosis.hypotheses.length - 1, "more finding")} on{" "}
                  {ctx.who}&rsquo;s page
                </span>
              </>
            ) : null}
          </p>
        </div>
      )}
    </Exhibit>
  );
}

/** 503 and 422 are different answers, and neither is the reader's problem. */
function DiagnosisUnavailable({ error }: { error: Error }) {
  if (isReasoningUnavailable(error)) {
    return (
      <ExhibitNote detail={error.message}>
        The AI is not connected on this deployment, so this step has no live
        example right now. Steps 1 and 2 need no AI at all, which is why they
        are still shown above.
      </ExhibitNote>
    );
  }
  if (isNotEnoughEvidence(error)) {
    return (
      <ExhibitNote detail={error.message}>
        There is not enough labelled evidence on this paper for the AI to reason
        over — so it does not try. It says nothing rather than guess.
      </ExhibitNote>
    );
  }
  return (
    <ExhibitNote detail={error.message}>
      The diagnosis could not be loaded just now.
    </ExhibitNote>
  );
}

/* ------------------------------------------------------------------ *
 * Step 4 — the teacher
 * ------------------------------------------------------------------ */

function CheckExhibit({
  ctx,
  diagnosis,
  pending,
  error,
  spotlight,
}: {
  ctx: Ctx;
  diagnosis: Diagnosis | undefined;
  pending: boolean;
  error: Error | null;
  spotlight: QuestionDetail | undefined;
}) {
  const lead = diagnosis?.hypotheses[0];
  const belief = spotlight ? chosenMisconception(spotlight) : null;

  return (
    <Exhibit
      title="What the teacher sees — and what happens next"
      endpoints={[DIAGNOSIS_ROUTE, QUESTION_ROUTE]}
    >
      {ctx.noPaper ? (
        <ExhibitNote>No paper has been sat yet, so there is nothing to check.</ExhibitNote>
      ) : error ? (
        <DiagnosisUnavailable error={error} />
      ) : pending || !diagnosis ? (
        <ExhibitSkeleton lines={5} />
      ) : (
        <div className="space-y-5">
          {lead && lead.evidence.length ? (
            <div>
              <Eyebrow>The finding rests on these answers — open any one</Eyebrow>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {lead.evidence.map((cited) => (
                  <EvidenceChip
                    key={cited.label}
                    cited={cited}
                    studentId={ctx.studentId}
                    studentName={ctx.name}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {spotlight && belief ? (
            <section
              aria-labelledby="explainer-belief"
              className="rounded-lg border border-foreground/20 bg-muted/40 px-4 py-3.5"
            >
              <h3
                id="explainer-belief"
                className="text-[11px] font-semibold tracking-[0.06em] text-foreground uppercase"
              >
                What choosing ({spotlight.chosen_label ?? "?"}) on {spotlight.label}{" "}
                reveals — in {ctx.who}&rsquo;s own words
              </h3>
              <blockquote className="mt-2 flex gap-2.5">
                <Quote aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
                <p className="max-w-[56ch] text-[0.9375rem] leading-relaxed text-foreground">
                  {belief.description}
                </p>
              </blockquote>
              <p className="mt-2 text-xs text-muted-foreground">
                A teacher reading this knows what to say at the board on Monday.
                A mark out of four never told them that.
              </p>
            </section>
          ) : null}

          <VerdictLoop diagnosis={diagnosis} />

          <Link
            to={`/students/${ctx.studentId}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline underline-offset-4"
          >
            Agree or disagree on {ctx.who}&rsquo;s page
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </div>
      )}
    </Exhibit>
  );
}

/**
 * The learning loop, with this diagnosis's real state in the middle box.
 *
 * Read-only on purpose. The explainer *shows* where a verdict goes; the place
 * to give one is the diagnosis card itself, where the teacher has the whole
 * finding in front of them. A button here would record a verdict on a page
 * built for explaining, not judging.
 */
function VerdictLoop({ diagnosis }: { diagnosis: Diagnosis }) {
  const verdict = diagnosis.human_verdict;
  const trace = diagnosis.trace_id ? `trace #${diagnosis.trace_id}` : "a trace";
  const boxes = [
    {
      title: "The AI's reasoning",
      body: `Saved in full as ${trace} — what it was shown and what it said.`,
      done: true,
    },
    {
      title: "A teacher's verdict",
      body:
        verdict === "agreed"
          ? "A teacher agreed with this diagnosis."
          : verdict === "disagreed"
            ? "A teacher disagreed with this diagnosis."
            : "Not given yet — no teacher has reviewed this one.",
      done: verdict !== null,
    },
    {
      title: "A checked training example",
      body:
        verdict !== null
          ? "Reasoning plus a teacher's judgement: material for training our own model."
          : "Becomes one the moment a teacher answers.",
      done: verdict !== null,
    },
  ];

  return (
    <div>
      <Eyebrow>How a verdict becomes training material</Eyebrow>
      <ol className="mt-2 grid gap-2 sm:grid-cols-3">
        {boxes.map((box, i) => (
          <li
            key={box.title}
            className={cn(
              "relative rounded-lg border px-3 py-2.5",
              box.done ? "border-border bg-background/60" : "border-dashed border-border bg-muted/30",
            )}
          >
            <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              {box.done ? (
                <Check aria-hidden className="size-3.5 text-status-good" />
              ) : (
                <CircleDashed aria-hidden className="size-3.5 text-muted-foreground" />
              )}
              <span className="sr-only">{box.done ? "Done: " : "Waiting: "}</span>
              {box.title}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{box.body}</p>
            {i < boxes.length - 1 ? (
              <ArrowRight
                aria-hidden
                className="absolute top-1/2 -right-2 z-10 hidden size-3.5 -translate-y-1/2 rounded-full bg-card text-muted-foreground sm:block"
              />
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Footer
 * ------------------------------------------------------------------ */

function NextSteps({ studentId, who }: { studentId: number; who: string }) {
  return (
    <nav
      aria-label="Where to go next"
      className="mt-12 grid gap-2 border-t border-border pt-6 sm:grid-cols-2"
    >
      <NextLink
        to="/trust"
        title="Data & trust"
        body="What's real and what's simulated, what the AI never sees, and why it never does the maths."
      />
      <NextLink
        to={`/students/${studentId}`}
        title={`${capitalise(who)}'s full page`}
        body="The same diagnosis in the console, with the Agree / Disagree buttons a teacher uses."
      />
    </nav>
  );
}

function NextLink({ to, title, body }: { to: string; title: string; body: string }) {
  return (
    <Link
      to={to}
      className="group flex items-start justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3.5 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
          {body}
        </span>
      </span>
      <ArrowRight
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}
