import { useMemo, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  CalendarCheck,
  CircleCheck,
  CircleMinus,
  CircleX,
  Clock,
  Hourglass,
  LoaderCircle,
  PlugZap,
  Scale,
  Shuffle,
  Sparkles,
  Tags,
  ThumbsDown,
  ThumbsUp,
  type LucideIcon,
} from "lucide-react";
import {
  counterEvidenceNarrows,
  isResolved,
  timeToFixLabel,
  type Confidence,
  type Diagnosis,
  type Evidence,
  type Hypothesis,
} from "@/api/diagnosis";
import {
  isNotEnoughEvidence,
  isReasoningUnavailable,
  useAttempts,
  useDiagnosis,
  useDiagnosisVerdict,
} from "@/api/queries";
import { STATUS_LABEL } from "@/api/questions";
import type { Attempt, AttemptStatus } from "@/api/types";
import { AnimatedNumber } from "@/components/kit/AnimatedNumber";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common/States";
import { QuestionPanel } from "./QuestionPanel";
import { labelsNamedIn } from "@/lib/explainer";
import { EASE_OUT_SOFT, fadeUp, stagger } from "@/lib/motion";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The AI diagnosis — the hero of Student 360.
 *
 * Every other panel on this screen reports what happened. This one says what
 * the student *misunderstands*, and the whole product claim rests on it being
 * legible to a director in about four seconds. The layout is an argument, in
 * order:
 *
 *   headline + cost   the claim at page-headline size, and what it costs
 *   main finding      the claim broken out, with the questions behind it
 *   key insight       the counter-evidence: why it is a trigger, not a gap
 *   weaker findings   shown, never hidden, and visibly subordinate
 *   action            what to do this week
 *   verdict           agree / disagree, which trains the system
 *
 * The counter-evidence gets the second-loudest treatment on the card. "He was
 * correct on the two questions where the group was stated explicitly" is the
 * sentence that proves the finding is a specific trigger and not a topic gap
 * — the most load-bearing line on the screen, and the one a lesser product
 * cannot produce.
 */
export function DiagnosisCard({
  studentId,
  studentName,
  paperId,
  paperName,
  /** True while the caller is still working out which paper to diagnose. */
  paperPending = false,
}: {
  studentId: number;
  studentName: string;
  paperId: number | undefined;
  paperName?: string;
  paperPending?: boolean;
}) {
  const query = useDiagnosis(studentId, paperId);

  if (paperPending || (paperId !== undefined && query.isPending)) {
    return <DiagnosisSkeleton />;
  }

  if (paperId === undefined) {
    return (
      <Shell subtitle="No paper to diagnose">
        <CalmState
          icon={Tags}
          title="No mock attempted yet"
          body={`A diagnosis reads one paper at a time. Once ${firstName(studentName)} sits a mock, it appears here.`}
        />
      </Shell>
    );
  }

  if (query.error) {
    return (
      <Shell subtitle={paperName}>
        <DiagnosisError
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </Shell>
    );
  }

  if (!query.data) return <DiagnosisSkeleton />;

  // Captioned with the paper the server says it diagnosed, not the one asked
  // for. The two differ in mock mode — the fixtures answer every `?paper=`
  // with the diagnostic-paper diagnosis — and a card citing D16 and D17 under
  // "AIT Mock 14" names a paper those questions are not on.
  return (
    <Shell subtitle={query.data.paper_name ?? paperName} diagnosis={query.data}>
      <DiagnosisBody
        studentId={studentId}
        studentName={studentName}
        paperId={paperId}
        data={query.data}
      />
    </Shell>
  );
}

/* ------------------------------------------------------------------ *
 * Chrome
 *
 * A brand-soft wash fading into the card: distinct from every data panel on
 * the page, and calm. The brand here is chrome — it marks "this is the AI's
 * reading" — and never carries a status or a value.
 * ------------------------------------------------------------------ */

function Shell({
  subtitle,
  diagnosis,
  children,
}: {
  subtitle?: string;
  diagnosis?: Diagnosis;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby="diagnosis-eyebrow"
      className="relative isolate overflow-hidden rounded-2xl bg-card shadow-raised ring-1 ring-brand-line"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[30rem] bg-linear-to-b from-brand-soft via-brand-soft/60 to-transparent"
      />
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 pt-5 sm:px-8 sm:pt-6">
        <h2
          id="diagnosis-eyebrow"
          className="flex items-center gap-1.5 text-xs font-semibold tracking-[0.08em] text-brand-ink uppercase"
        >
          <Sparkles aria-hidden className="size-3.5" />
          AI diagnosis
        </h2>
        {subtitle ? (
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        ) : null}
        {diagnosis ? (
          <span className="ml-auto flex items-center gap-2">
            {diagnosis.from_cache ? (
              <span
                className="rounded-full bg-card/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border"
                title="Served from cache — the same answer the model gave last time, not a fresh call."
              >
                Cached
              </span>
            ) : null}
            {/* An integer on the wire. Prefixed so a bare `53` in the corner
                of a card does not read as a count of something. */}
            {diagnosis.trace_id ? (
              <span
                className="font-mono text-[10px] text-muted-foreground"
                title="Trace id — the exact input sent to the AI and the answer it returned are stored under it."
              >
                trace #{diagnosis.trace_id}
              </span>
            ) : null}
          </span>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function DiagnosisSkeleton() {
  return (
    <Shell>
      <div className="grid gap-6 px-5 pt-5 pb-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-end">
        <div className="space-y-3">
          <span className="sr-only">Loading the diagnosis</span>
          <Skeleton className="h-8 w-[92%]" />
          <Skeleton className="h-8 w-[78%]" />
          <Skeleton className="h-8 w-[40%]" />
        </div>
        <Skeleton className="h-36 rounded-xl" />
      </div>
      <div className="grid gap-6 border-t border-brand-line/50 px-5 py-6 sm:px-8 lg:grid-cols-2">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ *
 * Body
 * ------------------------------------------------------------------ */

function DiagnosisBody({
  studentId,
  studentName,
  paperId,
  data,
}: {
  studentId: number;
  studentName: string;
  paperId: number;
  data: Diagnosis;
}) {
  /**
   * The server's own total, not a sum taken here.
   *
   * It counts *distinct* cited questions across every hypothesis, so a model
   * that cites one question under two findings does not get to charge for it
   * twice. Summing `hypotheses[].marks_at_stake` in the browser would — and a
   * marks figure that is quietly too high is the one number on this card a
   * director can check against the paper in about a minute.
   */
  const atStake = data.total_marks_at_stake;
  const timeToFix = timeToFixLabel(data.time_to_fix);
  const name = firstName(studentName);

  // The model lists its strongest finding first, and the headline is about
  // that one. With no pattern there is no main finding — only weak signals.
  const [main, ...rest] = data.pattern_found ? data.hypotheses : [];
  const weaker = data.pattern_found ? rest : data.hypotheses;

  const openable = useMemo(() => openableLabels(data), [data]);

  /**
   * The answer sheet the counter-evidence can be checked against.
   *
   * API_GAPS.COUNTER_EVIDENCE_UNRESOLVED — the questions the counter-evidence
   * names ("D22 and D23") come back as prose with no `question_id`, so they
   * cannot open a question panel. What the sheet *can* say is what was
   * recorded on them. Keyed on the paper the diagnosis reports it read, and
   * skipped when it spans every paper — a label is unique within one paper
   * only, so "D22" across several is not one question.
   */
  const sheetPaper = data.paper_id ?? undefined;
  const sheet = useAttempts(studentId, sheetPaper);

  const ctx: FindingContext = {
    studentId,
    studentName,
    name,
    openable,
    sheet: sheet.data ?? [],
  };

  return (
    <>
      <motion.div
        variants={stagger(0.08)}
        initial="hidden"
        animate="show"
        className={cn(
          "grid gap-x-10 gap-y-6 px-5 pt-3 pb-7 sm:px-8 sm:pb-8",
          atStake > 0 && "lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-center",
        )}
      >
        <div className="min-w-0">
          {/* The hero. The page's one big sentence is the model's, verbatim. */}
          <motion.p
            variants={fadeUp}
            className="max-w-[40ch] font-heading text-[26px] leading-[1.18] font-semibold tracking-tight text-balance text-foreground sm:text-[32px] sm:leading-[1.14] lg:text-[36px]"
          >
            {data.headline || "No diagnosis text was returned for this paper."}
          </motion.p>
          {timeToFix ? (
            <motion.div variants={fadeUp} className="mt-4">
              <TimeToFixBand label={timeToFix} />
            </motion.div>
          ) : null}
        </div>

        {atStake > 0 ? (
          <motion.div variants={fadeUp}>
            <WhatItCosts
              atStake={atStake}
              findings={data.hypotheses.length}
              patternFound={data.pattern_found}
            />
          </motion.div>
        ) : null}
      </motion.div>

      {data.pattern_found ? null : (
        <div className="px-5 pb-7 sm:px-8">
          <NoPattern name={name} />
        </div>
      )}

      {main ? <MainFinding hypothesis={main} ctx={ctx} /> : null}

      {weaker.length ? (
        <WeakerFindings
          hypotheses={weaker}
          patternFound={data.pattern_found}
          ctx={ctx}
        />
      ) : null}

      {data.recommended_action ? (
        <div className="border-t border-border px-5 py-6 sm:px-8">
          <div className="flex gap-3.5">
            <span className="mt-0.5 hidden size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground ring-1 ring-border sm:flex">
              <CalendarCheck aria-hidden className="size-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                Do this week
              </h3>
              <ProseWithQuestions
                as="p"
                text={data.recommended_action}
                ctx={ctx}
                className="mt-1.5 max-w-[75ch] text-[15px] leading-relaxed text-foreground"
              />
            </div>
          </div>
        </div>
      ) : null}

      <VerdictBar studentId={studentId} paperId={paperId} data={data} />
    </>
  );
}

interface FindingContext {
  studentId: number;
  studentName: string;
  name: string;
  /** Labels this diagnosis resolved to exactly one question id. */
  openable: Map<string, number>;
  /** The answer sheet for the paper diagnosed, or empty while unknown. */
  sheet: Attempt[];
}

/* ------------------------------------------------------------------ *
 * What it costs — the hero figure
 *
 * The total is the server's, over distinct questions. On a paper with weaker
 * secondary findings it is larger than the figure the headline quotes for the
 * main one, so the caption says which is which in words rather than doing
 * arithmetic the server did not do.
 * ------------------------------------------------------------------ */

function WhatItCosts({
  atStake,
  findings,
  patternFound,
}: {
  atStake: number;
  findings: number;
  patternFound: boolean;
}) {
  return (
    <div className="rounded-xl bg-card/90 p-4 shadow-card ring-1 ring-border sm:p-5">
      <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        What it costs
      </p>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-5xl leading-none font-semibold tracking-tight text-foreground sm:text-6xl">
          <AnimatedNumber value={atStake} />
        </span>{" "}
        <span className="text-base font-medium text-foreground">marks at stake</span>
        {/* Named as a total when there is more than one finding, so it does
            not read as a contradiction of the single figure the headline
            quotes for the strongest one. */}
        {findings > 1 ? (
          <>
            {" "}
            <span className="text-sm text-muted-foreground">
              across {findings} findings
            </span>
          </>
        ) : null}
      </p>
      {findings > 1 && patternFound ? (
        <p className="mt-3 border-t border-border pt-3 text-xs leading-snug text-muted-foreground">
          The headline&rsquo;s figure is the main finding alone;{" "}
          {findings - 1 === 1 ? "the weaker one adds" : `the ${findings - 1} weaker ones add`}{" "}
          the rest.
        </p>
      ) : null}
    </div>
  );
}

/**
 * How long this takes to fix, as a band.
 *
 * It used to be free text, and the model — asked for a number of minutes —
 * answered "40 minutes", then "20", then "45" for the same student and the
 * same evidence, while the action it recommended never changed. So it is four
 * bands now, and the label carries no digits: a director who spots one
 * invented "45 minutes" has no way left to believe the misconception above it.
 */
function TimeToFixBand({ label }: { label: string }) {
  return (
    <p
      className="flex items-start gap-2 text-[15px]"
      title="A band, not an estimate — the model is not asked for a number of minutes, because when it was, it gave a different one each time for the same evidence."
    >
      <Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span>
        <span className="text-muted-foreground">About </span>
        <span className="font-medium text-foreground">{label.toLowerCase()}</span>
        <span className="text-muted-foreground"> to fix</span>
      </span>
    </p>
  );
}

/* ------------------------------------------------------------------ *
 * pattern_found: false
 *
 * A real answer, not an empty state. A system that will say "there is no
 * pattern here" is the only kind whose patterns are worth anything.
 * ------------------------------------------------------------------ */

function NoPattern({ name }: { name: string }) {
  return (
    <div className="rounded-xl bg-card/85 px-4 py-4 ring-1 ring-border sm:px-5">
      <div className="flex gap-3.5">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-border">
          <Shuffle aria-hidden className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-base font-semibold text-foreground">
            No systematic pattern — the errors look scattered
          </p>
          <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
            The AI found no repeated misconception in these wrong answers, so
            there is no single belief to re-teach. That is a finding about{" "}
            {name}, not a gap in the analysis.
          </p>
          <p className="mt-2 text-xs text-muted-foreground italic">
            We would rather say this than invent a misconception to fill the
            card.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The main finding
 *
 * Claim and counter-evidence side by side: what he gets wrong, and the
 * observation that argues against it being a topic gap. Read left to right
 * it is the whole pitch.
 * ------------------------------------------------------------------ */

function MainFinding({
  hypothesis,
  ctx,
}: {
  hypothesis: Hypothesis;
  ctx: FindingContext;
}) {
  return (
    <div className="grid gap-x-10 gap-y-6 border-t border-brand-line/60 px-5 py-7 sm:px-8 lg:grid-cols-2">
      <article className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Main finding
          </h3>
          <MisconceptionCode code={hypothesis.misconception_code} />
          <ConfidenceMeter level={hypothesis.confidence} />
        </div>

        <p className="mt-3 max-w-[60ch] text-base leading-relaxed text-foreground sm:text-[17px]">
          {hypothesis.claim}
        </p>

        <EvidenceRow
          evidence={hypothesis.evidence}
          ctx={ctx}
          marks={hypothesis.marks_at_stake}
        />
      </article>

      {hypothesis.counter_evidence ? (
        <KeyInsight text={hypothesis.counter_evidence} ctx={ctx} />
      ) : null}
    </div>
  );
}

/**
 * The cited questions, each one a way into the evidence. Each chip carries the
 * option this student actually picked, which is the difference between "he
 * got D16 wrong" and "he picked C on D16" — the second is checkable against
 * the paper in his hand.
 */
function EvidenceRow({
  evidence,
  ctx,
  marks,
  compact = false,
}: {
  evidence: Evidence[];
  ctx: FindingContext;
  marks: number;
  compact?: boolean;
}) {
  if (!evidence.length) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-2", compact ? "mt-3" : "mt-4")}>
      <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        Rests on
      </span>
      {evidence.map((cited) => (
        <EvidenceChip
          key={cited.label}
          cited={cited}
          studentId={ctx.studentId}
          studentName={ctx.studentName}
        />
      ))}
      <span className="text-xs text-muted-foreground">
        {evidence.length === 1
          ? "· 1 question"
          : `· ${evidence.length} questions, same error`}
        {marks > 0 && !compact ? ` · ${num(marks)} marks` : ""}
      </span>
    </div>
  );
}

/**
 * One cited question.
 *
 * Resolved citations open the question itself — the stem, the four options
 * and the belief that produced the option chosen. Unresolved ones (the model
 * named a question that is not a wrong answer this student gave on this
 * paper) stay a dashed, inert span with a title saying so: a chip that opens
 * an empty panel is worse than a chip that visibly is not one.
 */
export function EvidenceChip({
  cited,
  studentId,
  studentName,
}: {
  cited: Evidence;
  studentId: number;
  studentName: string;
}) {
  if (!isResolved(cited)) {
    return (
      <span
        className="tnum rounded-md border border-dashed border-border px-2 py-1 font-mono text-xs text-muted-foreground"
        title="The model cited this question, but it is not one of this student's wrong answers on this paper — so nothing is claimed for it."
      >
        {cited.label}
      </span>
    );
  }

  return (
    <QuestionPanel
      questionId={cited.question_id}
      studentId={studentId}
      studentName={studentName}
    >
      <button
        type="button"
        className="tnum group/chip inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-card px-2 py-1 font-mono text-xs text-foreground shadow-card ring-1 ring-border transition-[color,background-color,box-shadow] outline-none hover:bg-brand-soft hover:ring-brand-line focus-visible:ring-3 focus-visible:ring-ring/50"
        title={`${cited.label}: chose ${cited.chose} · ${cited.marks_at_stake} marks. Open the question.`}
      >
        <span className="font-semibold">{cited.label}</span>
        {cited.chose ? (
          <span className="font-sans text-muted-foreground group-hover/chip:text-foreground">
            chose {cited.chose}
          </span>
        ) : null}
        <span className="sr-only">
          — open this question, the options and what that choice reveals
        </span>
      </button>
    </QuestionPanel>
  );
}

/**
 * The counter-evidence, as the card's key insight.
 *
 * Anything can say "weak at organic chemistry". Only a system that actually
 * reasoned over the questions can say "except on the two where the group was
 * named, where he was right" — and that exception is what makes the finding a
 * trigger rather than a subject gap, and fixable in a sitting rather than a
 * term. So it sits on its own raised panel, in reading-size type, with the one
 * piece of motion on the card that is not an entrance.
 */
function KeyInsight({ text, ctx }: { text: string; ctx: FindingContext }) {
  const onSheet = labelsNamedIn(text, ctx.sheet);
  return (
    <aside
      aria-labelledby="key-insight-heading"
      className="min-w-0 self-start rounded-xl bg-card p-5 shadow-raised ring-1 ring-border sm:p-6"
    >
      <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        <Scale aria-hidden className="size-3.5" />
        Key insight
      </p>
      <h3
        id="key-insight-heading"
        className="mt-2 font-heading text-lg leading-snug font-semibold tracking-tight text-foreground sm:text-xl"
      >
        {counterEvidenceNarrows(text) ? (
          <>
            Why this is <MarkOnce>a trigger, not a topic gap</MarkOnce>
          </>
        ) : (
          "Not narrowed to one trigger yet"
        )}
      </h3>
      <ProseWithQuestions
        as="p"
        text={text}
        ctx={ctx}
        className="mt-3 text-base leading-relaxed text-foreground sm:text-[17px]"
      />
      {onSheet.length ? (
        <SheetCheck rows={onSheet} name={ctx.name} />
      ) : null}
    </aside>
  );
}

/**
 * A marker stroke drawn once under a phrase, the first time it is seen. It is
 * emphasis on our own words, never on a value, so it takes the brand line.
 * Reduced motion gets the finished stroke with no sweep.
 */
function MarkOnce({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  const done = { backgroundSize: "100% 38%" };
  return (
    <motion.span
      className="box-decoration-clone bg-no-repeat"
      style={{
        backgroundImage: "linear-gradient(var(--brand-line), var(--brand-line))",
        backgroundPosition: "0 92%",
        ...(reduce ? done : null),
      }}
      initial={reduce ? false : { backgroundSize: "0% 38%" }}
      whileInView={done}
      viewport={{ once: true, amount: 1 }}
      transition={{ duration: 0.7, delay: 0.45, ease: EASE_OUT_SOFT }}
    >
      {children}
    </motion.span>
  );
}

const SHEET_MARK: Record<
  AttemptStatus,
  { icon: LucideIcon; tone: string }
> = {
  correct: {
    icon: CircleCheck,
    tone: "bg-status-good/10 text-status-good ring-status-good/25",
  },
  wrong: {
    icon: CircleX,
    tone: "bg-status-critical/10 text-status-critical ring-status-critical/25",
  },
  blank: {
    icon: CircleMinus,
    tone: "bg-muted text-muted-foreground ring-border",
  },
  not_reached: {
    icon: Hourglass,
    tone: "bg-muted text-muted-foreground ring-border",
  },
};

/**
 * What the answer sheet recorded on each question the counter-evidence names.
 *
 * The model said he was right on D22; this row says whether the record agrees,
 * in words and an icon. It shows what was recorded even when that contradicts
 * the model — that is the point of checking.
 */
function SheetCheck({ rows, name }: { rows: Attempt[]; name: string }) {
  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="text-xs text-muted-foreground">
        Checked against {name}&rsquo;s answer sheet
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {rows.map((row) => {
          const mark = SHEET_MARK[row.status];
          const Icon = mark.icon;
          return (
            <li
              key={row.question_id}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset",
                mark.tone,
              )}
            >
              <Icon aria-hidden className="size-3.5" />
              <span className="tnum font-mono font-semibold">{row.question_id}</span>
              <span>{STATUS_LABEL[row.status].toLowerCase()}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Weaker findings
 *
 * Shown, never folded away — a finding hidden behind a click is a finding a
 * director never weighs. But smaller, quieter and boxed apart from the main
 * one, because on two of the hero students they are what makes the total
 * larger than the headline's figure, and that must read as "plus some weaker
 * things", not as a second headline.
 * ------------------------------------------------------------------ */

function WeakerFindings({
  hypotheses,
  patternFound,
  ctx,
}: {
  hypotheses: Hypothesis[];
  patternFound: boolean;
  ctx: FindingContext;
}) {
  return (
    <div className="border-t border-border bg-muted/30 px-5 py-6 sm:px-8">
      <h3 className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {patternFound
          ? `Also on this paper — ${hypotheses.length} weaker ${hypotheses.length === 1 ? "finding" : "findings"}`
          : "Weak signals, shown for completeness"}
      </h3>
      <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">
        {patternFound
          ? "Lower confidence or fewer questions than the main finding. Counted in the total above; not what the headline is about."
          : "None of these is strong enough to call a pattern."}
      </p>
      <ul className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {hypotheses.map((h) => (
          <li key={`${h.misconception_code}-${h.claim}`} className="min-w-0">
            <WeakerFinding hypothesis={h} ctx={ctx} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function WeakerFinding({
  hypothesis,
  ctx,
}: {
  hypothesis: Hypothesis;
  ctx: FindingContext;
}) {
  const onSheet = labelsNamedIn(hypothesis.counter_evidence, ctx.sheet);
  return (
    <article className="flex h-full flex-col rounded-xl bg-card p-4 shadow-card ring-1 ring-border">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <MisconceptionCode code={hypothesis.misconception_code} />
          <ConfidenceMeter level={hypothesis.confidence} />
        </div>
        {hypothesis.marks_at_stake > 0 ? (
          <span className="tnum shrink-0 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">
              {num(hypothesis.marks_at_stake)}
            </span>{" "}
            marks at stake
          </span>
        ) : null}
      </div>

      <p className="mt-2.5 text-sm leading-relaxed text-foreground">
        {hypothesis.claim}
      </p>

      <EvidenceRow
        evidence={hypothesis.evidence}
        ctx={ctx}
        marks={hypothesis.marks_at_stake}
        compact
      />

      {hypothesis.counter_evidence ? (
        <div className="mt-3 border-t border-border pt-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            <Scale aria-hidden className="size-3" />
            {counterEvidenceNarrows(hypothesis.counter_evidence)
              ? "Why a trigger, not a topic gap"
              : "Not narrowed yet"}
          </p>
          <ProseWithQuestions
            as="p"
            text={hypothesis.counter_evidence}
            ctx={ctx}
            className="mt-1 text-xs leading-relaxed text-muted-foreground"
          />
          {onSheet.length ? (
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              {onSheet.map((row) => {
                const Icon = SHEET_MARK[row.status].icon;
                return (
                  <span key={row.question_id} className="inline-flex items-center gap-1">
                    <Icon aria-hidden className="size-3" />
                    <span className="font-mono">{row.question_id}</span>{" "}
                    {STATUS_LABEL[row.status].toLowerCase()}
                  </span>
                );
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function MisconceptionCode({ code }: { code: string }) {
  return (
    <code className="rounded-md bg-card px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground ring-1 ring-border">
      {code}
    </code>
  );
}

/* ------------------------------------------------------------------ *
 * Question labels in the model's prose
 * ------------------------------------------------------------------ */

/**
 * Labels this diagnosis already tied to a question id, and only those.
 *
 * A label is unique within one paper, and the server resolved these against
 * this student's answers — so "D16" in the recommended action is the same
 * question as the "D16 chose C" chip. A label that resolved to two different
 * ids (a diagnosis spanning papers) is dropped rather than guessed between.
 */
function openableLabels(data: Diagnosis): Map<string, number> {
  const ids = new Map<string, number>();
  const clash = new Set<string>();
  for (const hypothesis of data.hypotheses) {
    for (const row of hypothesis.evidence) {
      if (!isResolved(row) || !row.label) continue;
      const seen = ids.get(row.label);
      if (seen !== undefined && seen !== row.question_id) clash.add(row.label);
      else ids.set(row.label, row.question_id);
    }
  }
  for (const label of clash) ids.delete(label);
  return ids;
}

/**
 * Prose with the question labels it names made openable — where the diagnosis
 * resolved them. Matching runs from the known labels into the text, never the
 * other way, so "-SO3H" is never mistaken for a question. A label the payload
 * did not resolve stays plain text: there is no id to open, and none is made
 * up.
 */
function ProseWithQuestions({
  text,
  ctx,
  as: Tag = "p",
  className,
}: {
  text: string;
  ctx: FindingContext;
  as?: "p" | "span";
  className?: string;
}) {
  const parts = useMemo(
    () => splitOnLabels(text, [...ctx.openable.keys()]),
    [text, ctx.openable],
  );
  return (
    <Tag className={className}>
      {parts.map((part, index) =>
        typeof part === "string" ? (
          part
        ) : (
          <QuestionPanel
            key={index}
            questionId={ctx.openable.get(part.label)!}
            studentId={ctx.studentId}
            studentName={ctx.studentName}
          >
            <button
              type="button"
              className="tnum cursor-pointer rounded-sm font-mono text-[0.92em] font-semibold text-brand-ink underline decoration-brand-line decoration-dotted underline-offset-[3px] outline-none hover:decoration-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {part.label}
              <span className="sr-only"> — open this question</span>
            </button>
          </QuestionPanel>
        ),
      )}
    </Tag>
  );
}

function splitOnLabels(
  text: string,
  labels: string[],
): Array<string | { label: string }> {
  if (!text || !labels.length) return [text];
  const alternatives = [...labels]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  const pattern = new RegExp(
    `(?<![A-Za-z0-9])(${alternatives})(?![A-Za-z0-9])`,
    "g",
  );
  const out: Array<string | { label: string }> = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push({ label: match[1] });
    last = at + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ------------------------------------------------------------------ *
 * Confidence
 *
 * Three steps of one ordinal ramp plus the word, never a status hue: green for
 * "high confidence" would read as good news, and a confidently-diagnosed
 * misconception is not good news. The word is what carries the meaning.
 * ------------------------------------------------------------------ */

const CONFIDENCE_STEPS: Record<Confidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const CONFIDENCE_WORD: Record<Confidence, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

export function ConfidenceMeter({ level }: { level: Confidence }) {
  const filled = CONFIDENCE_STEPS[level];
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
      <span aria-hidden className="flex items-center gap-[2px]">
        {[1, 2, 3].map((step) => (
          <span
            key={step}
            className={cn(
              "h-2.5 w-1 rounded-[1px]",
              step <= filled ? "bg-foreground/70" : "bg-foreground/15",
            )}
          />
        ))}
      </span>
      {CONFIDENCE_WORD[level]}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Verdict
 *
 * The human verdict is what turns a generic tool into *their* system — it is
 * the training data. It is also the only write path on this card, so it gets
 * a band of its own and says plainly what the write does.
 * ------------------------------------------------------------------ */

function VerdictBar({
  studentId,
  paperId,
  data,
}: {
  studentId: number;
  paperId: number;
  data: Diagnosis;
}) {
  const verdict = useDiagnosisVerdict(studentId, paperId);
  const [failed, setFailed] = useState<string | null>(null);
  const recorded = data.human_verdict;

  function send(value: "agreed" | "disagreed") {
    setFailed(null);
    verdict.mutate(
      { verdict: value },
      { onError: (error) => setFailed(error.message) },
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4 border-t border-brand-line/60 bg-brand-soft/50 px-5 py-5 sm:px-8">
      <div className="min-w-0 flex-1 basis-80">
        {recorded ? (
          <p className="text-base font-semibold text-foreground">
            {recorded === "agreed"
              ? "You agreed with this diagnosis."
              : "You disagreed with this diagnosis."}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              Recorded against{" "}
              {data.trace_id ? `trace #${data.trace_id}` : "this diagnosis"}.
            </span>
          </p>
        ) : (
          <p className="text-base font-semibold text-foreground">
            Does this match what you see in class?
          </p>
        )}
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Your answer is saved with this diagnosis as a teacher-checked label.
          It does not change this diagnosis or any later one.
        </p>
        {failed ? (
          <p role="alert" className="mt-1.5 text-xs text-status-critical">
            Could not record that: {failed}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {verdict.isPending ? (
          <LoaderCircle
            aria-hidden
            className="size-4 animate-spin text-muted-foreground"
          />
        ) : null}
        <Button
          size="lg"
          className="min-w-28"
          variant={recorded === "agreed" ? "default" : "outline"}
          aria-pressed={recorded === "agreed"}
          disabled={verdict.isPending}
          onClick={() => send("agreed")}
        >
          <ThumbsUp aria-hidden />
          Agree
        </Button>
        <Button
          size="lg"
          className="min-w-28"
          variant={recorded === "disagreed" ? "default" : "outline"}
          aria-pressed={recorded === "disagreed"}
          disabled={verdict.isPending}
          onClick={() => send("disagreed")}
        >
          <ThumbsDown aria-hidden />
          Disagree
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Failure
 *
 * 503 and 422 are different answers and must not share a screen. One says the
 * reasoning layer is not switched on; the other says it is switched on and has
 * honestly declined to guess. Neither is an error the reader caused, so neither
 * gets the red error treatment — and neither shows a made-up diagnosis.
 * ------------------------------------------------------------------ */

function DiagnosisError({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  if (isReasoningUnavailable(error)) {
    return (
      <CalmState
        icon={PlugZap}
        title="The diagnosis could not be prepared just now"
        body={
          <>
            Everything else on this page is computed from your own data and
            needs no model. This card is the one part that calls the reasoning
            layer, and it did not answer this time — the reason is below — so
            the card says that, instead of a number it made up.
          </>
        }
        detail={error.message}
        action={{ label: "Check again", onClick: onRetry }}
      />
    );
  }

  if (isNotEnoughEvidence(error)) {
    return (
      <CalmState
        icon={Tags}
        title="Not enough tagged evidence on this paper"
        body={
          <>
            A diagnosis needs wrong answers with the chosen option recorded, on
            questions whose options are tagged with the mistake behind them.
            This paper does not give it that for this student yet, so there is
            nothing honest to say. The reason is below.
          </>
        }
        detail={error.message}
        action={{ label: "Try again", onClick: onRetry }}
      />
    );
  }

  return <ErrorState error={error} onRetry={onRetry} className="m-5 sm:m-8" />;
}

function CalmState({
  icon: Icon,
  title,
  body,
  detail,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body: ReactNode;
  detail?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="px-5 pt-4 pb-8 sm:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-card text-muted-foreground shadow-card ring-1 ring-border">
          <Icon aria-hidden className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="font-heading text-xl leading-snug font-semibold tracking-tight text-foreground sm:text-2xl">
            {title}
          </p>
          <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-muted-foreground">
            {body}
          </p>
          {detail ? (
            <p className="mt-3 max-w-prose font-mono text-[11px] leading-relaxed break-words text-muted-foreground/80">
              {detail}
            </p>
          ) : null}
          {action ? (
            <Button
              size="sm"
              variant="outline"
              className="mt-4"
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The name to address a student by in prose.
 *
 * Not simply the first token: "Md. Faizan Ali" is on this roster, and "That is
 * a finding about Md." is the kind of sentence that costs a demo its credit.
 * A trailing full stop marks a prefix, never a given name.
 */
function firstName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return parts.find((part) => !part.endsWith(".")) ?? parts[0] ?? full;
}
