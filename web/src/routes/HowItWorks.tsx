import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import {
  ArrowRight,
  Calculator,
  Check,
  CircleDashed,
  ClipboardList,
  Clock,
  Database,
  Hand,
  Lock,
  Minus,
  Scale,
  PenLine,
  Tag,
  UserCheck,
  X,
} from "lucide-react";
import type { Attempt, DashboardSummary, MarksLost } from "@/api/types";
import { counterEvidenceNarrows, timeToFixLabel, type Diagnosis } from "@/api/diagnosis";
import {
  chosenMisconception,
  chosenOption,
  correctOption,
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
import { Bubble } from "@/components/brand/Bubble";
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
import { IdeaCard } from "@/components/explainer/IdeaCard";
import { Pipeline, type PipelineStop } from "@/components/explainer/Pipeline";
import { RuleBeam } from "@/components/explainer/RuleBeam";
import { PageHeadline } from "@/components/kit/PageHeadline";
import { Reveal, RevealItem } from "@/components/kit/Reveal";
import { Section } from "@/components/kit/Section";
import { TextLink } from "@/components/kit/TextLink";
import { BentoGrid } from "@/components/ui/bento-grid";
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
import { hoverLift } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * How it works — the story the founder tells, on a live example.
 *
 * Written for a coaching-institute director who has two minutes and has sat
 * through many ed-tech demos. The page's whole claim is "this is the system,
 * not a slide about it", so nothing below is a screenshot or hardcoded copy of
 * a result: the paper is the institute's latest (from the dashboard summary),
 * the student is the demo's hero, and every figure, quote and citation is read
 * from the same routes the console uses. The only fixed choice is *which*
 * student to show, and that is a choice, not a number.
 *
 * It reads in three passes, so a director can stop after any one of them:
 *   1. the headline and the beam — who does what, in one sentence and one
 *      picture;
 *   2. the pipeline — six stops a presenter clicks through, each beside the
 *      same step on the example student's answers;
 *   3. the four steps in full — every figure, every citation, the answer that
 *      can be opened.
 * The headings alone tell the story; the detail is there for the one who asks.
 *
 * All three keep the product's one architectural rule visible, because it is
 * also the answer to "why should I trust it": counting is code and is exact,
 * judgement is the AI, and a teacher has the last word. A director who
 * remembers nothing else should remember that the AI does none of the
 * counting. (It does write figures into its own sentences — the headline's
 * "25 marks" — so the page never claims it produces no number at all.)
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
  const repeats = repeatedMistakes(citedQuestions);

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

  const diagnosisPending = summary.isPending || diagnosis.isPending;
  const stops = pipelineStops({
    ctx,
    sheet: sheet.data,
    spotlight,
    spotlightPending: diagnosis.isPending || citedPending,
    repeats,
    repeatsPending: diagnosis.isPending || citedPending,
    marksLost: marksLost.data,
    diagnosis: diagnosis.data,
    diagnosisPending,
    diagnosisError: diagnosis.error,
  });

  return (
    <div className="pb-6">
      <Intro ctx={ctx} pending={summary.isPending || student.isPending} />

      <Reveal delay={0.1}>
        <RuleBeam
          label={`Who does what: the answers are recorded and counted by the system, exactly; the AI explains the pattern, seeing only a code such as ${pseudonymFor(studentId)}; a teacher decides what to do.`}
          stops={[
            {
              icon: Calculator,
              title: "The answers",
              line: "Recorded and counted by the system. Exact, every time.",
            },
            {
              icon: PenLine,
              title: "The AI",
              line: (
                <>
                  Explains <em>why</em>. Sees &ldquo;{pseudonymFor(studentId)}&rdquo;, never a
                  name — and does none of the counting.
                </>
              ),
              accent: true,
            },
            {
              icon: UserCheck,
              title: "A teacher",
              line: "Checks the evidence, decides what to teach, agrees or disagrees.",
            },
          ]}
        />
      </Reveal>

      <div className="mt-14 space-y-16">
        <Section
          id="pipeline"
          eyebrow="Follow one answer"
          title="From a tick-box to a teaching decision, in six stops"
          description={
            <>
              Click any stop — or use Next — to see what happens there, in plain
              words, beside the same step on {ctx.who}&rsquo;s recorded answers.
            </>
          }
        >
          <Reveal>
            <Pipeline
              stops={stops}
              label="The pipeline, in order: the answer sheet; the misconception tag on the option chosen; exact counting; Gemini's judgement; the teacher's action; saved as a training example."
              endpoints={[ATTEMPTS_ROUTE, QUESTION_ROUTE, MARKS_LOST_ROUTE, DIAGNOSIS_ROUTE]}
              exampleLabel={`On ${ctx.who}’s recorded answers`}
            />
          </Reveal>
        </Section>

        <Section
          id="steps"
          eyebrow="In full"
          title="The four steps, on the stored record"
          description="The same journey with every figure on show. Each panel says where its data came from, and each cited wrong answer opens."
        >
          <StepRail />

          <div className="mt-8 space-y-12">
            <Step
              n={1}
              id="step-record"
              who="The system"
              icon={<ClipboardList aria-hidden className="size-3.5" />}
              title="Each answer is kept with the option chosen"
              promise="A cross says he got it wrong. The option he chose often says why."
              lede={
                <>
                  <p>
                    A tick or a cross says only that an answer was wrong. On our
                    diagnostic paper we also keep the option the student picked.
                  </p>
                  <p>
                    That matters because the tempting wrong options on that paper
                    are labelled in advance with the specific mistake
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
                repeats={repeats}
                repeatsPending={diagnosis.isPending || citedPending}
                repeatsUnchecked={citedFailed}
              />
            </Step>

            <Step
              n={3}
              id="step-reason"
              who="The AI"
              icon={<PenLine aria-hidden className="size-3.5" />}
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
                pending={diagnosisPending}
                error={diagnosis.error}
                sheet={sheet.data}
              />
            </Step>

            <Step
              n={4}
              id="step-check"
              who="A teacher"
              icon={<UserCheck aria-hidden className="size-3.5" />}
              title="A teacher checks it, and the verdict is kept"
              promise="Little has to be taken on trust: each finding opens to the wrong answers it cites."
              lede={
                <>
                  <p>
                    Each finding links to the wrong answers it cites. A teacher opens
                    any of them and sees the question, the option the student chose,
                    and the belief that leads to that option — then agrees or
                    disagrees.
                  </p>
                  <p>
                    That judgement is saved alongside the AI&rsquo;s reasoning, as a
                    checked example for training a model of our own later. Today it
                    changes nothing else — not this diagnosis, and not the next one.
                  </p>
                </>
              }
            >
              <CheckExhibit
                ctx={ctx}
                diagnosis={diagnosis.data}
                pending={diagnosisPending}
                error={diagnosis.error}
                spotlight={spotlight}
              />
            </Step>
          </div>
        </Section>

        <Section
          id="remember"
          eyebrow="If you remember five things"
          title="What makes this different from a score report"
        >
          <KeyIdeas
            ctx={ctx}
            diagnosis={diagnosis.data}
            spotlight={spotlight}
            sheet={sheet.data}
          />
        </Section>
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
    <PageHeadline
      eyebrow="How it works"
      title={
        <>
          The system counts. The AI explains. A teacher decides.
        </>
      }
      support={
        <>
          From an answer sheet to a teaching decision, shown on one worked
          example from this system —{" "}
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
          — and the diagnosis it made from them. Every panel draws on the same
          data a teacher&rsquo;s console uses, and its tag says whether that is
          live data or the demo fixtures.
        </>
      }
      meta={
        <>
          <span className="inline-flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm leading-snug text-muted-foreground">
            <Database aria-hidden className="mt-0.5 size-4 shrink-0" />
            {capitalise(ctx.who)} is one of this demo&rsquo;s simulated students,
            answering with a mistake pattern built in, and the paper is our own;
            the AI&rsquo;s diagnosis of that pattern is real.
          </span>
          <TextLink to="/trust" className="text-sm">
            What&rsquo;s real and what&rsquo;s simulated
          </TextLink>
        </>
      }
    />
  );
}

const RAIL = [
  { id: "step-record", verb: "Record", who: "The system", icon: ClipboardList },
  { id: "step-count", verb: "Count", who: "Plain arithmetic", icon: Calculator },
  { id: "step-reason", verb: "Explain", who: "The AI", icon: PenLine },
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
    <nav aria-label="The four steps">
      <ol className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {RAIL.map((step, i) => (
          <li key={step.id} className="min-w-0">
            <a
              href={`#${step.id}`}
              className={cn(
                "flex h-full min-w-0 items-center gap-3 rounded-lg border bg-card px-3 py-2.5 shadow-card transition-[background-color,box-shadow] outline-none hover:bg-muted/60 hover:shadow-raised focus-visible:ring-3 focus-visible:ring-ring/50",
                step.id === "step-reason" ? "border-brand-line" : "border-border",
              )}
            >
              <span className="tnum flex size-7 shrink-0 items-center justify-center rounded-sm border border-foreground/25 text-xs font-semibold text-foreground">
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">
                  {step.verb}
                </span>
                <span
                  className={cn(
                    "flex items-center gap-1 text-xs",
                    step.id === "step-reason" ? "text-brand-ink" : "text-muted-foreground",
                  )}
                >
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

/**
 * One step: the takeaway first, then the reasoning, then the live exhibit.
 *
 * The promise sits directly under the heading because it is the sentence a
 * skimming reader should leave with; the lede below it is for the one who
 * wants the why.
 */
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
      className="scroll-mt-28 border-t border-border pt-8"
    >
      <Reveal className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)] lg:gap-10">
        <div className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <div className="flex items-center gap-2.5">
            <span className="tnum flex size-7 items-center justify-center rounded-sm bg-foreground text-xs font-semibold text-background">
              {n}
            </span>
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
              {icon}
              {who}
            </span>
          </div>
          <h2
            id={`${id}-title`}
            className="mt-3 font-heading text-xl leading-snug font-semibold tracking-tight text-balance text-foreground sm:text-2xl"
          >
            {title}
          </h2>
          <p className="mt-3 max-w-prose border-l-2 border-brand pl-3 text-sm leading-relaxed font-medium text-foreground">
            {promise}
          </p>
          <div className="mt-3.5 max-w-prose space-y-2.5 text-sm leading-relaxed text-muted-foreground">
            {lede}
          </div>
        </div>
        <div className="min-w-0">{children}</div>
      </Reveal>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The pipeline — six stops, each with its example
 *
 * Every example is assembled from the same queries the four steps use, so the
 * pipeline can never tell a different story from the detail below it. Where a
 * query has not answered, the stop says so; it never fills in.
 * ------------------------------------------------------------------ */

function pipelineStops({
  ctx,
  sheet,
  spotlight,
  spotlightPending,
  repeats,
  repeatsPending,
  marksLost,
  diagnosis,
  diagnosisPending,
  diagnosisError,
}: {
  ctx: Ctx;
  sheet: Attempt[] | undefined;
  spotlight: QuestionDetail | undefined;
  spotlightPending: boolean;
  repeats: RepeatedMistake[];
  repeatsPending: boolean;
  marksLost: MarksLost | undefined;
  diagnosis: Diagnosis | undefined;
  diagnosisPending: boolean;
  diagnosisError: Error | null;
}): PipelineStop[] {
  const { who } = ctx;
  const pseudonym = pseudonymFor(ctx.studentId);

  /** The shared fallbacks: nothing sat yet, still loading, or nothing to show. */
  const unavailable = (pending: boolean, none: string): ReactNode =>
    ctx.noPaper ? (
      <Quiet>No paper has been sat yet, so there is no example to show.</Quiet>
    ) : pending ? (
      <ExhibitSkeleton lines={3} />
    ) : (
      <Quiet>{none}</Quiet>
    );

  const aiUnavailable = (none: string): ReactNode =>
    diagnosisError ? (
      <Quiet>
        {isReasoningUnavailable(diagnosisError)
          ? "The AI could not be reached just now, so there is no live example for this stop. The stops before it need no AI."
          : isNotEnoughEvidence(diagnosisError)
            ? "There is not enough labelled evidence on this paper for the AI to reason over — so it does not try."
            : "The diagnosis could not be loaded just now."}
      </Quiet>
    ) : (
      unavailable(diagnosisPending, none)
    );

  const chosen = spotlight ? chosenOption(spotlight) : null;
  const right = spotlight ? correctOption(spotlight) : null;
  const tag = spotlight ? chosenMisconception(spotlight) : null;
  const tally = sheet ? tallySheet(sheet) : null;
  const lead = diagnosis?.hypotheses[0];
  const confirmed = lead && sheet ? labelsNamedIn(lead.counter_evidence, sheet) : [];
  const band = timeToFixLabel(diagnosis?.time_to_fix);
  const repeat = repeats[0];

  return [
    {
      id: "sheet",
      title: "Answer sheet",
      actor: "system",
      icon: ClipboardList,
      explain: (
        <>
          <p>
            A student picks one option on each multiple-choice question. A
            score sheet keeps only a tick or a cross.
          </p>
          <p>
            On our diagnostic paper we keep the option itself — because a wrong
            option is chosen for a reason, and the option often says which.
          </p>
        </>
      ),
      example:
        spotlight && chosen ? (
          <>
            {tally ? (
              <p className="text-muted-foreground">
                {capitalise(who)}&rsquo;s sheet has{" "}
                <Strong>{plural(tally.total, "question")}</Strong>:{" "}
                <Strong>{num(tally.correct)} right</Strong>,{" "}
                <Strong>{num(tally.wrong)} wrong</Strong>
                {tally.blank ? `, ${num(tally.blank)} skipped` : ""}.
              </p>
            ) : null}
            <p className="mt-2">
              On <Code>{spotlight.label}</Code>, {who} chose{" "}
              <Strong>
                ({chosen.label}) {chosen.text}
              </Strong>
              {right && right.label !== chosen.label ? (
                <>
                  . The right answer was ({right.label}) {right.text}
                </>
              ) : null}
              .
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Stored with it: the result
              {spotlight.time_spent != null
                ? ` and the time taken — ${num(spotlight.time_spent)} s`
                : ""}
              .
            </p>
          </>
        ) : (
          unavailable(spotlightPending, "The diagnosis has not cited a wrong answer to follow.")
        ),
      more: { href: "#step-record", label: "See the whole answer sheet" },
    },
    {
      id: "tag",
      title: "Option's misconception tag",
      actor: "system",
      icon: Tag,
      explain: (
        <>
          <p>
            On our diagnostic paper, the tempting wrong options are labelled in
            advance with the misconception that produces each one.
          </p>
          <p>
            So choosing it is not just a lost mark — it is a clue to what the
            student believes.
          </p>
        </>
      ),
      example:
        spotlight && chosen && tag ? (
          <>
            <p className="text-muted-foreground">
              Option ({chosen.label}) on {spotlight.label} was labelled before
              anyone sat the paper:
            </p>
            <p className="mt-2">
              <Code>{tag.code}</Code> <Strong>{tag.name}</Strong>
            </p>
            {tag.description ? (
              <blockquote className="mt-2.5 border-l-2 border-foreground/30 pl-3 font-serif text-muted-foreground">
                {tag.description}
              </blockquote>
            ) : null}
          </>
        ) : (
          unavailable(spotlightPending, "The cited answer carries no label to show.")
        ),
      more: { href: "#step-record", label: "See the option as it is stored" },
    },
    {
      id: "count",
      title: "Counting — exact",
      actor: "code",
      icon: Calculator,
      explain: (
        <>
          <p>
            Plain counting finds the same misconception chosen again and again.
            It is ordinary arithmetic on the recorded answers: exact, and the
            same answers always give the same numbers.
          </p>
          <p className="font-medium">The AI does none of this counting.</p>
        </>
      ),
      example: repeat ? (
        <>
          <p>
            <Code>{repeat.misconception.code}</Code> was chosen on{" "}
            <Strong>{plural(repeat.questions.length, "question")}</Strong> among
            the answers the diagnosis cites:
          </p>
          <p className="tnum mt-2 flex flex-wrap gap-1">
            {repeat.questions.map((q) => (
              <span
                key={q.questionId}
                className="rounded-sm bg-muted px-1.5 py-0.5 text-xs font-semibold text-foreground"
              >
                {q.label}
                <span className="text-muted-foreground"> chose {q.chose}</span>
              </span>
            ))}
          </p>
          {marksLost ? (
            <p className="mt-2.5 text-muted-foreground">
              The same counting, over the whole paper: a score of{" "}
              <Strong>
                {num(marksLost.score)} of {num(marksLost.max_marks)}
              </Strong>
              , with <Strong>{num(marksLost.total_lost)} marks</Strong> lost.
            </p>
          ) : null}
        </>
      ) : (
        unavailable(repeatsPending, "No labelled wrong option was chosen twice among the cited answers.")
      ),
      more: { href: "#step-count", label: "See the full count" },
    },
    {
      id: "judge",
      title: "Gemini's judgement",
      actor: "ai",
      icon: PenLine,
      explain: (
        <>
          <p>
            Only now is the AI — Google&rsquo;s Gemini — involved. It judges{" "}
            <em>why</em> the pattern is there, using counter-evidence: questions
            in the same chapter {who} got right, where the trigger was absent.
          </p>
          <p>
            That is what separates one specific trigger from a weak chapter. It
            sees the student only as &ldquo;{pseudonym}&rdquo; — never a name.
          </p>
        </>
      ),
      example: diagnosis ? (
        <>
          <p className="font-serif font-semibold text-balance">
            {diagnosis.headline || "No diagnosis text was returned for this paper."}
          </p>
          {lead?.counter_evidence ? (
            <div className="mt-2.5 border-l-[3px] border-foreground pl-3">
              <p className="text-xs font-semibold text-foreground">
                The counter-evidence
              </p>
              <p className="mt-1 font-serif text-muted-foreground">{lead.counter_evidence}</p>
            </div>
          ) : null}
          {confirmed.length ? (
            <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">On the answer sheet:</span>
              {confirmed.map((row) => (
                <SheetMark key={row.id} row={row} />
              ))}
            </p>
          ) : null}
        </>
      ) : (
        aiUnavailable("There is no diagnosis to show.")
      ),
      more: { href: "#step-reason", label: "See the AI's diagnosis" },
    },
    {
      id: "action",
      title: "The teacher's action",
      actor: "teacher",
      icon: UserCheck,
      explain: (
        <>
          <p>
            The AI recommends one action for the teacher, with the size of the
            job as a band rather than a minute count.
          </p>
          <p>
            The teacher reads the finding, opens the answers behind it, and
            decides.
          </p>
        </>
      ),
      example: diagnosis?.recommended_action ? (
        <>
          <p className="text-xs font-semibold text-muted-foreground">
            The AI suggests
          </p>
          <p className="mt-1 font-serif">{diagnosis.recommended_action}</p>
          {band ? (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock aria-hidden className="size-3.5" />
              About {band.toLowerCase()} to fix
            </p>
          ) : null}
        </>
      ) : diagnosis ? (
        <Quiet>This diagnosis came back with no recommended action.</Quiet>
      ) : (
        aiUnavailable("There is no recommendation to show.")
      ),
      more: { href: "#step-check", label: "See what the teacher sees" },
    },
    {
      id: "saved",
      title: "Saved as a training example",
      actor: "system",
      icon: Database,
      explain: (
        <>
          <p>
            Every reasoning transcript is saved — the data the AI was shown
            and what it said.
          </p>
          <p>
            A teacher&rsquo;s Agree or Disagree is saved with it. Together they
            become a checked training example: material for training our own
            model later.
          </p>
        </>
      ),
      example: diagnosis ? (
        <>
          <p>
            This diagnosis is saved as{" "}
            <Strong>
              {diagnosis.trace_id ? `trace #${diagnosis.trace_id}` : "a trace"}
            </Strong>
            .
          </p>
          <p className="mt-2 inline-flex items-start gap-1.5 text-muted-foreground">
            {diagnosis.human_verdict ? (
              <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-status-good" />
            ) : (
              <CircleDashed aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            )}
            <span>
              {diagnosis.human_verdict === "agreed"
                ? "A teacher agreed with it, so it is now a checked training example."
                : diagnosis.human_verdict === "disagreed"
                  ? "A teacher disagreed with it, so it is now a checked training example."
                  : "No teacher has reviewed it yet. It becomes a training example the moment one does."}
            </span>
          </p>
        </>
      ) : (
        aiUnavailable("There is no saved reasoning to show.")
      ),
      more: { href: "#step-check", label: "See how a verdict becomes training data" },
    },
  ];
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

function Strong({ children }: { children: ReactNode }) {
  return <span className="tnum font-semibold text-foreground">{children}</span>;
}

function Code({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs font-semibold tracking-wide text-foreground">
      {children}
    </span>
  );
}

/** One answer-sheet cell, in words and an icon — never the tint alone. */
function SheetMark({ row }: { row: Attempt }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 font-semibold">
      <span className="tnum text-xs text-foreground">{row.question_id}</span>
      {row.status === "correct" ? (
        <Check aria-hidden className="size-3.5 text-status-good" />
      ) : (
        <X aria-hidden className="size-3.5 text-status-critical" />
      )}
      <span className="text-muted-foreground">{STATUS_MARK[row.status].word}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * The five ideas
 * ------------------------------------------------------------------ */

/**
 * The page's argument, five cards long, each with a specimen of the real
 * thing beside it — a sum, a label, a citation — so the idea is shown rather
 * than asserted. A specimen that has not loaded is simply left off.
 */
function KeyIdeas({
  ctx,
  diagnosis,
  spotlight,
  sheet,
}: {
  ctx: Ctx;
  diagnosis: Diagnosis | undefined;
  spotlight: QuestionDetail | undefined;
  sheet: Attempt[] | undefined;
}) {
  const parts = diagnosis ? resolvedEvidence(diagnosis) : [];
  const chosen = spotlight ? chosenOption(spotlight) : null;
  const tag = spotlight ? chosenMisconception(spotlight) : null;
  const lead = diagnosis?.hypotheses[0];
  const confirmed = lead && sheet ? labelsNamedIn(lead.counter_evidence, sheet) : [];

  return (
    <Reveal stagger={0.06}>
      <BentoGrid className="auto-rows-auto grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <RevealItem className="sm:col-span-2">
          <IdeaCard
            icon={Calculator}
            title="The AI does none of the counting"
            body="Scores, marks lost and marks at stake are counted by ordinary code from the recorded answers. The AI explains the pattern; a figure inside its own sentences is its wording, not the count."
            specimen={
              parts.length && diagnosis ? (
                <p className="tnum flex flex-wrap items-center gap-1.5 text-xs">
                  {parts.map((row, i) => (
                    <span key={row.question_id} className="inline-flex items-center gap-1.5">
                      {i > 0 ? (
                        <span aria-hidden className="text-muted-foreground">
                          +
                        </span>
                      ) : null}
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs font-semibold text-foreground">
                        {row.label}
                        <span className="text-muted-foreground"> {num(row.marks_at_stake)}</span>
                      </span>
                    </span>
                  ))}
                  <span aria-hidden className="text-muted-foreground">
                    =
                  </span>
                  <span className="font-semibold text-foreground">
                    {num(diagnosis.total_marks_at_stake)} marks at stake
                  </span>
                </p>
              ) : null
            }
            to="#step-count"
            cta="See the count"
          />
        </RevealItem>
        <RevealItem>
          <IdeaCard
            icon={Tag}
            title="A wrong option is a clue"
            body="On our diagnostic paper, the tempting wrong options are labelled in advance with the misconception behind each one."
            specimen={
              spotlight && chosen && tag ? (
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Code>
                    {spotlight.label} ({chosen.label})
                  </Code>
                  <ArrowRight aria-hidden className="size-3" />
                  <Code>{tag.code}</Code>
                  <span className="sr-only">is labelled</span>
                  <span>{tag.name}</span>
                </p>
              ) : null
            }
            to="#step-record"
            cta="See one answer"
          />
        </RevealItem>
        <RevealItem>
          <IdeaCard
            icon={Scale}
            title="What he got right narrows it down"
            body="Correct answers in the same chapter, where the trigger was absent, narrow “weak at the chapter” down to one fixable trigger."
            specimen={
              confirmed.length ? (
                <p className="flex flex-wrap items-center gap-1.5 text-xs">
                  {confirmed.map((row) => (
                    <SheetMark key={row.id} row={row} />
                  ))}
                </p>
              ) : null
            }
            to="#step-reason"
            cta="See the counter-evidence"
          />
        </RevealItem>
        <RevealItem>
          <IdeaCard
            icon={Lock}
            title="The AI never sees a name"
            body={`It is sent a code such as “${pseudonymFor(ctx.studentId)}” and the answers. Each institute's data is walled off from every other's inside the database.`}
            to="/trust#privacy"
            cta="What the AI never sees"
          />
        </RevealItem>
        <RevealItem>
          <IdeaCard
            icon={UserCheck}
            title="A teacher checks the AI"
            body="Each finding opens to the wrong answers it cites. A teacher's Agree or Disagree is saved with the reasoning, as a label for training a model of our own later."
            to="#step-check"
            cta="See the teacher's view"
          />
        </RevealItem>
      </BentoGrid>
    </Reveal>
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
  { icon: typeof Check; word: string; cell: string; ink: string; mark: string }
> = {
  // A tick in a ring: the way a teacher marks a right answer.
  correct: {
    icon: Check,
    word: "right",
    cell: "border-border bg-background",
    ink: "text-status-good",
    mark: "border-[1.5px] border-foreground text-status-good",
  },
  // A cross in a filled disc: the one mark on the sheet that is meant to catch
  // the eye, because a wrong answer is what this page is about.
  wrong: {
    icon: X,
    word: "wrong",
    cell: "border-status-critical/45 bg-status-critical/[0.07]",
    ink: "text-status-critical",
    mark: "border-[1.5px] border-status-critical bg-status-critical text-card",
  },
  blank: {
    icon: Minus,
    word: "skipped",
    cell: "border-dashed border-border bg-muted/40",
    ink: "text-muted-foreground",
    mark: "border-[1.5px] border-dashed border-muted-foreground text-muted-foreground",
  },
  not_reached: {
    icon: Clock,
    word: "not reached",
    cell: "border-dashed border-border bg-muted/40",
    ink: "text-muted-foreground",
    mark: "border-[1.5px] border-dashed border-muted-foreground text-muted-foreground",
  },
};

/** The sheet's mark for one status — round, because it is a judgement on an answer. */
function SheetDot({ status }: { status: Attempt["status"] }) {
  const mark = STATUS_MARK[status];
  const Icon = mark.icon;
  return (
    <span
      aria-hidden
      className={cn("grid size-4.5 shrink-0 place-items-center rounded-full", mark.mark)}
    >
      <Icon className="size-3" strokeWidth={3} />
    </span>
  );
}

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
          const ringed = row.question_id === highlight;
          return (
            <li
              key={row.id}
              title={`${row.question_id} · ${row.topic_name} · ${mark.word}${row.time_spent != null ? ` · ${row.time_spent}s` : ""}`}
              className={cn(
                "flex h-12 flex-col items-center justify-center gap-1 rounded-md border",
                mark.cell,
                ringed && "ring-2 ring-foreground ring-offset-1 ring-offset-card",
              )}
            >
              <span className="tnum text-xs leading-none font-medium text-muted-foreground">
                {row.question_id}
              </span>
              <SheetDot status={row.status} />
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
          return (
            <span key={item.status} className="inline-flex items-center gap-1.5">
              <SheetDot status={item.status} />
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
        <span className="font-semibold text-foreground">
          {question.label}
        </span>
      </Eyebrow>
      <p className="mt-2 max-w-[60ch] font-serif text-base leading-relaxed text-foreground">
        {question.question_text || "This question has no text on file."}
      </p>

      <ol className="mt-3 space-y-1" aria-label="Options">
        {question.options.map((option) => {
          const picked = option.chosen === true;
          return (
            <li
              key={option.label}
              className={cn(
                "flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md px-2.5 py-2 text-sm",
                option.is_correct
                  ? "bg-status-good/8"
                  : picked
                    ? "bg-status-critical/8"
                    : undefined,
              )}
            >
              <Bubble
                letter={option.label}
                filled={picked}
                ringed={option.is_correct}
                size="sm"
                className="self-center"
              />
              <span className="min-w-0 flex-1 font-serif text-base text-foreground">
                <span className="sr-only">Option {option.label}: </span>
                {option.text}
              </span>
              {option.is_correct ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-status-good">
                  <Check aria-hidden className="size-3.5" />
                  Correct
                </span>
              ) : null}
              {picked ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-xs font-semibold",
                    option.is_correct ? "text-foreground" : "text-status-critical",
                  )}
                >
                  <Hand aria-hidden className="size-3.5" />
                  {who} chose this
                </span>
              ) : null}
              {option.misconception ? (
                <span className="basis-full pl-8 text-xs text-muted-foreground">
                  Labelled in advance:{" "}
                  <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs font-semibold tracking-wide text-foreground">
                    {option.misconception.code}
                  </span>{" "}
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
      <dd className="tnum text-sm font-medium text-foreground">{value}</dd>
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
            A score report stops here:{" "}
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
              ? " Re-teaching the whole chapter would re-teach what he already knows. Step 3 looks for what is actually going wrong."
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
        <p className="mt-1.5 text-xs text-muted-foreground">
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
                <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs font-semibold tracking-wide text-foreground">
                  {entry.misconception.code}
                </span>{" "}
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
                    className="rounded-sm bg-muted px-1.5 py-0.5 text-xs font-semibold text-foreground"
                  >
                    {q.label}
                    <span className="text-muted-foreground"> chose {q.chose}</span>
                  </span>
                ))}
              </p>
            </li>
          ))}
          <li className="text-xs leading-relaxed text-muted-foreground">
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
              The AI saw this student only as &ldquo;
              {pseudonymFor(ctx.studentId)}&rdquo; — never a name. The marks at
              stake were counted by the system; a figure inside the AI&rsquo;s
              own sentences is its wording.{" "}
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
          <p className="max-w-[40ch] font-serif text-2xl leading-[1.15] font-semibold tracking-tight text-balance text-foreground">
            {diagnosis.headline || "No diagnosis text was returned for this paper."}
          </p>

          {lead ? (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs font-semibold tracking-wide text-foreground">
                  {lead.misconception_code}
                </span>
                <ConfidenceMeter level={lead.confidence} />
              </div>
              <p className="mt-3 max-w-prose font-serif text-base leading-relaxed text-foreground">
                {lead.claim}
              </p>

              {lead.counter_evidence ? (
                <div className="mt-5 border-l-[3px] border-foreground pl-5">
                  <p className="flex items-center gap-2.5 text-sm font-semibold text-foreground">
                    <span
                      aria-hidden
                      className="inline-grid size-5 place-items-center rounded-full border-[1.5px] border-foreground"
                    >
                      {counterEvidenceNarrows(lead.counter_evidence) ? (
                        <Check className="size-3" strokeWidth={3} />
                      ) : (
                        <Minus className="size-3" strokeWidth={3} />
                      )}
                    </span>
                    {counterEvidenceNarrows(lead.counter_evidence)
                      ? "Why it’s one trigger, not a weak chapter"
                      : "Not narrowed to one trigger yet"}
                  </p>
                  <p className="mt-2 max-w-prose font-serif text-lg leading-relaxed text-foreground">
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
                          className="inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 font-semibold"
                        >
                          <span className="tnum text-xs text-foreground">
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

          <p className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
            {diagnosis.total_marks_at_stake > 0 ? (
              <span>
                <span className="tnum font-semibold text-foreground">
                  {num(diagnosis.total_marks_at_stake)} marks
                </span>{" "}
                at stake
              </span>
            ) : null}
            {band ? (
              <span className="inline-flex items-center gap-1.5">
                <Clock aria-hidden className="size-3.5" />
                About {band.toLowerCase()} to fix
              </span>
            ) : null}
            {diagnosis.hypotheses.length > 1 ? (
              <span>
                {plural(diagnosis.hypotheses.length - 1, "more finding")} on{" "}
                {ctx.who}&rsquo;s page
              </span>
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
        The AI could not be reached just now, so this step has no live example.
        Steps 1 and 2 need no AI at all, which is why they are still shown
        above.
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
              className="border-l-[3px] border-foreground pl-5"
            >
              <h3
                id="explainer-belief"
                className="text-sm font-semibold text-foreground"
              >
                The belief behind choosing ({spotlight.chosen_label ?? "?"}) on{" "}
                {spotlight.label}
              </h3>
              <blockquote className="mt-2">
                <p className="max-w-[56ch] font-serif text-lg leading-relaxed text-foreground">
                  {belief.description}
                </p>
              </blockquote>
              <p className="mt-2 text-xs text-muted-foreground">
                A teacher reading this knows what to say at the board on Monday.
                A mark out of four never told them that.
              </p>
            </section>
          ) : null}

          {diagnosis.recommended_action ? (
            <div>
              <Eyebrow>The one action the AI suggests</Eyebrow>
              <p className="mt-1.5 max-w-prose font-serif text-base leading-relaxed text-foreground">
                {diagnosis.recommended_action}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                A suggestion for the teacher to weigh against the evidence above —
                the teacher decides.
              </p>
            </div>
          ) : null}

          <VerdictLoop diagnosis={diagnosis} />

          <TextLink to={`/students/${ctx.studentId}`} className="text-sm">
            Agree or disagree on {ctx.who}&rsquo;s page
          </TextLink>
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
      body: `Saved as ${trace} — the data it was shown and what it said.`,
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
      className="mt-16 grid gap-3 border-t border-border pt-8 sm:grid-cols-2"
    >
      <NextLink
        to="/trust"
        title="Data & trust"
        body="What's real and what's simulated, what the AI never sees, and why the counting is left to code."
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
    <motion.div {...hoverLift} className="rounded-xl">
      <Link
        to={to}
        className="group flex h-full items-start justify-between gap-3 rounded-xl border border-border bg-card px-5 py-4 shadow-card transition-shadow outline-none hover:shadow-raised focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground underline decoration-transparent underline-offset-4 transition-colors group-hover:decoration-foreground/40">
            {title}
          </span>
          <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
            {body}
          </span>
        </span>
      </Link>
    </motion.div>
  );
}
