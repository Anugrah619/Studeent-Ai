import { useMemo, useState, type ReactNode } from "react";
import {
  Check,
  Hourglass,
  LoaderCircle,
  Minus,
  PlugZap,
  Shuffle,
  Tags,
  ThumbsDown,
  ThumbsUp,
  X,
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
import { Bubble } from "@/components/brand/Bubble";
import { AnimatedNumber } from "@/components/kit/AnimatedNumber";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/common/States";
import { QuestionPanel } from "./QuestionPanel";
import { labelsNamedIn } from "@/lib/explainer";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The AI diagnosis, laid out as a marked page — the hero of Student 360.
 *
 * Every other panel on this screen reports what happened. This one says what
 * the student *misunderstands*, and the whole product claim rests on it being
 * legible to a director in about four seconds. So it is a page with a margin,
 * the way a teacher's marked script is:
 *
 *   the prose, left   what was read or written — the claim, the evidence it
 *                     rests on, the observation that argues against it, the
 *                     action. Set in the serif, because it is language.
 *   the margin, right what was counted — marks at stake, confidence, the time
 *                     it takes to fix. Set in the grotesque, because it is
 *                     figures, and each one says who produced it.
 *
 * A vertical rule, drawn in once as the page appears, divides the two. That
 * division is the product's central promise made visible: the AI explains, and
 * the system counts. A director who has seen this card once can tell, on any
 * screen after, which of the things in front of them a model wrote.
 *
 * Read down the prose column, the layout is an argument, in order:
 *
 *   headline + cost   the claim at page-headline size, and what it costs
 *   main finding      the claim broken out, with the questions behind it
 *   key insight       the counter-evidence: why it is a trigger, not a gap
 *   weaker findings   shown, never hidden, and visibly subordinate
 *   action            what to do this week, beside what it takes to fix
 *   verdict           agree / disagree
 *
 * The counter-evidence is deliberately given the largest body type on the page
 * and its own rule rather than a grey footnote. "He was correct on the two
 * questions where the group was stated explicitly" is the sentence that proves
 * the finding is a specific trigger and not a topic gap — the most load-bearing
 * line on the screen, and the one a lesser product cannot produce.
 *
 * Brand is chrome here: the header and verdict bands say "this is the AI's
 * reading", and the question labels in the prose are links. It never carries a
 * status or a value — those are ink.
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
    return <DiagnosisReading />;
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

  if (!query.data) return <DiagnosisReading />;

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
      className="overflow-hidden rounded-xl border border-foreground/25 bg-card shadow-raised"
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-brand-line bg-brand-soft px-6 py-3 sm:px-9">
        <h2
          id="diagnosis-eyebrow"
          className="text-sm font-semibold text-brand-ink"
        >
          AI diagnosis
        </h2>
        {subtitle ? (
          <span className="text-sm text-muted-foreground">{subtitle}</span>
        ) : null}
        {diagnosis ? (
          <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            {diagnosis.from_cache ? (
              <span
                className="rounded-sm border border-border bg-card/70 px-1.5 py-0.5 font-medium"
                title="Served from cache — the same answer the model gave last time, not a fresh call."
              >
                Cached
              </span>
            ) : null}
            {/* An integer on the wire. Prefixed so a bare `53` in the corner
                of a card does not read as a count of something. */}
            {diagnosis.trace_id ? (
              <span
                className="tnum"
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

/**
 * Marking in progress: the four bubbles of an answer row, filled in turn.
 *
 * A saved diagnosis opens at once; a new one is a live call to a model and can
 * take seconds — or minutes, when the model is busy. That wait is the one moment
 * in the product the reader is looking at nothing, so it says what is happening
 * in words, and the bubbles move for the same reason a progress bar does: to
 * show the page has not frozen. With reduced motion set they simply sit still.
 */
function DiagnosisReading() {
  return (
    <Shell>
      <div role="status" className="px-6 py-10 sm:px-9">
        <div aria-hidden className="flex gap-3">
          {["A", "B", "C", "D"].map((letter, i) => (
            <Bubble
              key={letter}
              letter={letter}
              size="lg"
              className="animate-bubble-read"
              style={{ animationDelay: `${i * 300}ms` }}
            />
          ))}
        </div>
        <p className="mt-5 text-base font-semibold text-foreground">
          Reading the answer sheet
        </p>
        <p className="mt-1 max-w-[56ch] text-sm leading-relaxed text-muted-foreground">
          A saved diagnosis opens at once. A new one takes a few seconds, and
          longer when the model is busy.
        </p>
      </div>
    </Shell>
  );
}

/**
 * One row of the page: prose on the left, margin on the right.
 *
 * The margin column is a fixed width and the whole row is capped, so the rule
 * that runs down the page sits at the same place in every row without any
 * measuring — see the offset on the rule in `DiagnosisBody`, which is this
 * geometry written out. Below `lg` there is no margin to speak of: it stacks
 * under its prose and the rule is not drawn.
 */
function Row({
  children,
  margin,
  first = false,
  compact = false,
  marginFirst = false,
}: {
  children: ReactNode;
  margin?: ReactNode;
  first?: boolean;
  compact?: boolean;
  /**
   * When the margin stacks (below `lg`), put it above its prose instead of
   * under it. A finding's confidence and cost read as the head of the finding;
   * the time to fix reads as the tail of the action, so that stays below.
   */
  marginFirst?: boolean;
}) {
  return (
    <div className={first ? undefined : "border-t border-border"}>
      <div
        className={cn(
          "grid max-w-[72rem] gap-x-14 gap-y-5 px-6 sm:px-9 lg:grid-cols-[minmax(0,1fr)_22rem]",
          compact ? "py-5" : "py-7",
        )}
      >
        <div className="min-w-0">{children}</div>
        {margin ? (
          <aside className={cn("min-w-0", marginFirst && "max-lg:order-first")}>
            {margin}
          </aside>
        ) : null}
      </div>
    </div>
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
  const findings = data.hypotheses.length;
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

  // What it takes to fix sits beside the action it prices, not up with what
  // the finding costs. With no action to sit beside it falls back to the hero.
  const fixBand = timeToFix ? <TimeToFixBand label={timeToFix} /> : null;
  const fixInHero = fixBand !== null && !data.recommended_action;
  const heroMargin =
    atStake > 0 || fixInHero ? (
      <>
        <TotalsMargin
          atStake={atStake}
          findings={findings}
          patternFound={data.pattern_found}
        />
        {fixInHero ? <div className={atStake > 0 ? "mt-5" : undefined}>{fixBand}</div> : null}
      </>
    ) : undefined;

  return (
    <>
      <div className="relative">
        {/* The rule between the prose and the margin. `left` is the row
            geometry written out: the row is at most 72rem wide, the margin
            column is 22rem, the gap is 3.5rem and the right padding 2.25rem, so
            the middle of the gap is 26rem in from the row's right edge. It
            draws down once, as the card appears. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-[calc(min(100%,72rem)-26rem)] -ml-px hidden w-0.5 origin-top animate-ink-rule bg-foreground lg:block"
        />

        <Row first margin={heroMargin}>
          {/* The hero. The page's one big sentence is the model's, verbatim. */}
          <p className="max-w-[40ch] font-serif text-2xl leading-[1.15] font-semibold tracking-tight text-balance text-foreground sm:text-3xl">
            {data.headline || "No diagnosis text was returned for this paper."}
          </p>
        </Row>

        {data.pattern_found ? null : (
          <Row>
            <NoPattern name={name} />
          </Row>
        )}

        {main ? (
          <MainFinding hypothesis={main} ctx={ctx} showMarks={findings > 1} />
        ) : null}

        {weaker.length ? (
          <WeakerFindings
            hypotheses={weaker}
            patternFound={data.pattern_found}
            ctx={ctx}
          />
        ) : null}

        {data.recommended_action ? (
          <Row margin={fixBand}>
            <h3 className="text-sm font-semibold text-foreground">
              Do this week
            </h3>
            <ProseWithQuestions
              as="p"
              text={data.recommended_action}
              ctx={ctx}
              className="mt-2 max-w-[60ch] font-serif text-lg leading-relaxed text-foreground"
            />
          </Row>
        ) : null}
      </div>

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

function TotalsMargin({
  atStake,
  findings,
  patternFound,
}: {
  atStake: number;
  findings: number;
  patternFound: boolean;
}) {
  if (!(atStake > 0)) return null;

  return (
    <div>
      <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-5xl leading-none font-semibold tracking-tight text-foreground">
          <AnimatedNumber value={atStake} />
        </span>{" "}
        {/* Named as a total when there is more than one finding, so it does
            not read as a contradiction of the single figure the headline
            quotes for the strongest one. */}
        <span className="text-sm font-medium text-foreground">
          marks at stake
          {findings > 1 ? ` across ${findings} findings` : ""}
        </span>
      </p>
      <p className="mt-2.5 max-w-[34ch] text-xs leading-snug text-muted-foreground">
        Counted from the answer sheet by the system, not estimated by the AI.
      </p>
      {findings > 1 && patternFound ? (
        <p className="mt-2 max-w-[34ch] text-xs leading-snug text-muted-foreground">
          The headline&rsquo;s figure is the main finding alone;{" "}
          {findings - 1 === 1
            ? "the weaker one adds"
            : `the ${findings - 1} weaker ones add`}{" "}
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
 * A band, by being visibly a band, tells the reader how precise the claim is
 * meant to be instead of implying a precision that was never there.
 */
function TimeToFixBand({ label }: { label: string }) {
  return (
    <div>
      <p className="text-sm font-medium text-foreground">
        <span className="text-muted-foreground">About </span>
        {label.toLowerCase()}
        <span className="text-muted-foreground"> to fix</span>
      </p>
      <p className="mt-1.5 max-w-[34ch] text-xs leading-snug text-muted-foreground">
        A band, not an estimate. The AI is not asked for minutes: when it was,
        the answer changed every time.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * pattern_found: false
 *
 * A real answer, not an empty state. A system that will say "there is no
 * pattern here" is the only kind whose patterns are worth anything, so this
 * state is designed rather than defaulted.
 * ------------------------------------------------------------------ */

function NoPattern({ name }: { name: string }) {
  return (
    <div className="flex gap-4">
      <Shuffle aria-hidden className="mt-1 size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-base font-semibold text-foreground">
          No systematic pattern — the errors look scattered
        </p>
        <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
          The AI found no repeated misconception in these wrong answers, so
          there is no single belief to re-teach. That is a finding about {name},
          not a gap in the analysis.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          We would rather say this than invent a misconception to fill the
          card.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The main finding
 *
 * Claim and counter-evidence in one column: what he gets wrong, and the
 * observation that argues against it being a topic gap. Read down the page it
 * is the whole pitch. Its confidence and cost sit in the margin beside it.
 * ------------------------------------------------------------------ */

function MainFinding({
  hypothesis,
  ctx,
  showMarks,
}: {
  hypothesis: Hypothesis;
  ctx: FindingContext;
  /** Off when this is the only finding: its marks are the headline total. */
  showMarks: boolean;
}) {
  return (
    <Row
      marginFirst
      margin={<FindingMargin hypothesis={hypothesis} showMarks={showMarks} />}
    >
      <p>
        <MisconceptionCode code={hypothesis.misconception_code} />
      </p>

      <p className="mt-3 max-w-[60ch] font-serif text-base leading-relaxed text-foreground">
        {hypothesis.claim}
      </p>

      {/* The bubbles fill in one after another as the page inks in. */}
      <EvidenceRow evidence={hypothesis.evidence} ctx={ctx} fillFromMs={560} />

      {hypothesis.counter_evidence ? (
        <KeyInsight text={hypothesis.counter_evidence} ctx={ctx} />
      ) : null}
    </Row>
  );
}

function FindingMargin({
  hypothesis,
  quiet = false,
  showMarks = true,
}: {
  hypothesis: Hypothesis;
  /** A weaker finding: the same facts, one size down. */
  quiet?: boolean;
  /** The finding's own cost, when it is not already the headline figure. */
  showMarks?: boolean;
}) {
  return (
    <div className={quiet ? "space-y-2.5" : "space-y-4"}>
      <ConfidenceMeter level={hypothesis.confidence} />
      {showMarks && hypothesis.marks_at_stake > 0 ? (
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span
            className={cn(
              "tnum leading-none font-semibold tracking-tight text-foreground",
              quiet ? "text-xl" : "text-3xl",
            )}
          >
            {num(hypothesis.marks_at_stake)}
          </span>
          <span className="text-sm text-muted-foreground">marks at stake</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The cited questions, each one a way into the evidence. Each chip carries the
 * option this student actually picked, which is the difference between "he
 * got D16 wrong" and "he picked C on D16" — the second is checkable against
 * the paper in his hand.
 *
 * A citation the server could not tie to one of this student's wrong answers
 * comes back with `question_id: null`, and is rendered as plain text rather
 * than as something that looks openable.
 */
function EvidenceRow({
  evidence,
  ctx,
  compact = false,
  fillFromMs,
}: {
  evidence: Evidence[];
  ctx: FindingContext;
  compact?: boolean;
  /** Set to have the chips' bubbles fill in on mount, one after another. */
  fillFromMs?: number;
}) {
  if (!evidence.length) return null;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2.5 gap-y-2",
        compact ? "mt-3" : "mt-4",
      )}
    >
      <span className="text-sm text-muted-foreground">Rests on</span>
      {evidence.map((cited, i) => (
        <EvidenceChip
          key={cited.label}
          cited={cited}
          studentId={ctx.studentId}
          studentName={ctx.studentName}
          fillDelayMs={fillFromMs === undefined ? undefined : fillFromMs + i * 90}
        />
      ))}
      <span className="text-sm text-muted-foreground">
        {evidence.length === 1
          ? "1 question"
          : `${evidence.length} questions, same error`}
      </span>
    </div>
  );
}

/**
 * One cited question.
 *
 * Resolved citations open the question itself — the stem, the four options
 * and the belief that produced the option chosen — and show the option this
 * student picked as a filled bubble, the pencil mark, which is what makes the
 * claim checkable against the paper in the teacher's hand.
 *
 * Unresolved ones (the model named a question that is not a wrong answer this
 * student gave on this paper) stay a dashed, inert span with a title saying
 * so. They are deliberately not buttons: a chip that opens an empty panel is
 * worse than a chip that visibly is not one.
 */
export function EvidenceChip({
  cited,
  studentId,
  studentName,
  fillDelayMs,
}: {
  cited: Evidence;
  studentId: number;
  studentName: string;
  /** Set to have the bubble fill in on mount, after this many milliseconds. */
  fillDelayMs?: number;
}) {
  if (!isResolved(cited)) {
    return (
      <span
        className="tnum inline-flex items-center rounded-sm border border-dashed border-border px-2.5 py-1 text-sm font-medium text-muted-foreground"
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
        className={cn(
          "tnum inline-flex cursor-pointer items-center gap-2 rounded-sm border border-foreground/30 bg-card py-1 pl-2.5 text-sm font-semibold text-foreground shadow-xs transition-colors outline-none hover:border-brand-ink hover:bg-brand-soft focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35",
          cited.chose ? "pr-1.5" : "pr-2.5",
        )}
        title={`${cited.label}: chose ${cited.chose} · ${cited.marks_at_stake} marks. Open the question.`}
      >
        {cited.label}
        {cited.chose ? (
          <>
            <span className="sr-only">chose </span>
            <Bubble
              letter={cited.chose}
              filled
              size="sm"
              className={fillDelayMs === undefined ? undefined : "animate-bubble-fill"}
              style={
                fillDelayMs === undefined
                  ? undefined
                  : { animationDelay: `${fillDelayMs}ms` }
              }
            />
          </>
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
 * Given a rule, its own block and the largest body type on the page, because it
 * is the line that separates a diagnosis from a topic report. Anything can say
 * "weak at organic chemistry". Only a system that actually reasoned over the
 * questions can say "except on the two where the group was named, where he was
 * right" — and that exception is what makes the finding a trigger rather than
 * a subject gap, and what makes it fixable in one sitting rather than a term.
 *
 * The tick in a ring is the same mark a teacher uses for a correct answer, so
 * it is drawn only when the counter-evidence actually narrows the finding; when
 * it does not, the ring holds a dash.
 */
function KeyInsight({ text, ctx }: { text: string; ctx: FindingContext }) {
  const onSheet = labelsNamedIn(text, ctx.sheet);
  const narrows = counterEvidenceNarrows(text);
  return (
    <section
      aria-labelledby="key-insight-heading"
      className="mt-7 border-l-[3px] border-foreground pl-5"
    >
      <h3
        id="key-insight-heading"
        className="flex items-center gap-2.5 text-sm font-semibold text-foreground"
      >
        <span
          aria-hidden
          className="inline-grid size-5 place-items-center rounded-full border-[1.5px] border-foreground"
        >
          {narrows ? (
            <Check className="size-3" strokeWidth={3} />
          ) : (
            <Minus className="size-3" strokeWidth={3} />
          )}
        </span>
        {narrows
          ? "Why this is a trigger, not a topic gap"
          : "Not narrowed to one trigger yet"}
      </h3>
      <ProseWithQuestions
        as="p"
        text={text}
        ctx={ctx}
        className="mt-2.5 max-w-[56ch] font-serif text-lg leading-relaxed text-foreground"
      />
      {onSheet.length ? <SheetCheck rows={onSheet} name={ctx.name} /> : null}
    </section>
  );
}

const SHEET_MARK: Record<AttemptStatus, { icon: LucideIcon; tone: string }> = {
  correct: { icon: Check, tone: "text-status-good" },
  wrong: { icon: X, tone: "text-status-critical" },
  blank: { icon: Minus, tone: "text-muted-foreground" },
  not_reached: { icon: Hourglass, tone: "text-muted-foreground" },
};

/**
 * What the answer sheet recorded on each question the counter-evidence names.
 *
 * The model said he was right on D22; this row says whether the record agrees,
 * in words and an icon. It shows what was recorded even when that contradicts
 * the model — that is the point of checking. The status word carries the
 * meaning; the icon's hue only repeats it.
 */
function SheetCheck({ rows, name }: { rows: Attempt[]; name: string }) {
  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="text-sm text-muted-foreground">
        Checked against {name}&rsquo;s answer sheet
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {rows.map((row) => {
          const mark = SHEET_MARK[row.status];
          const Icon = mark.icon;
          return (
            <li
              key={row.question_id}
              className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-2 py-1 text-sm"
            >
              <Icon aria-hidden className={cn("size-4", mark.tone)} />
              <span className="tnum font-semibold text-foreground">
                {row.question_id}
              </span>
              <span className="text-muted-foreground">
                {STATUS_LABEL[row.status].toLowerCase()}
              </span>
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
 * director never weighs. But smaller, quieter and set on a tint apart from the
 * main one, because on two of the hero students they are what makes the total
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
    <div className="border-t border-border bg-muted/30">
      <Row first compact>
        <h3 className="text-sm font-semibold text-foreground">
          {patternFound
            ? `Also on this paper: ${hypotheses.length} weaker ${hypotheses.length === 1 ? "finding" : "findings"}`
            : "Weak signals, shown for completeness"}
        </h3>
        <p className="mt-1 max-w-[62ch] text-xs leading-relaxed text-muted-foreground">
          {patternFound
            ? "Lower confidence or fewer questions than the main finding. Counted in the total above; not what the headline is about."
            : "None of these is strong enough to call a pattern."}
        </p>
      </Row>
      <ul>
        {hypotheses.map((h) => (
          <li key={`${h.misconception_code}-${h.claim}`}>
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
    <Row
      compact
      marginFirst
      margin={<FindingMargin hypothesis={hypothesis} quiet />}
    >
      <p>
        <MisconceptionCode code={hypothesis.misconception_code} />
      </p>

      <p className="mt-2.5 max-w-[60ch] font-serif text-base leading-relaxed text-foreground">
        {hypothesis.claim}
      </p>

      <EvidenceRow evidence={hypothesis.evidence} ctx={ctx} compact />

      {hypothesis.counter_evidence ? (
        <div className="mt-3 border-l-2 border-foreground/30 pl-4">
          <p className="text-sm font-semibold text-muted-foreground">
            {counterEvidenceNarrows(hypothesis.counter_evidence)
              ? "Why a trigger, not a topic gap"
              : "Not narrowed yet"}
          </p>
          <ProseWithQuestions
            as="p"
            text={hypothesis.counter_evidence}
            ctx={ctx}
            className="mt-1 max-w-[56ch] font-serif text-base leading-relaxed text-muted-foreground"
          />
          {onSheet.length ? (
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {onSheet.map((row) => {
                const mark = SHEET_MARK[row.status];
                const Icon = mark.icon;
                return (
                  <span
                    key={row.question_id}
                    className="inline-flex items-center gap-1.5"
                  >
                    <Icon aria-hidden className={cn("size-3.5", mark.tone)} />
                    <span className="tnum font-semibold text-foreground">
                      {row.question_id}
                    </span>{" "}
                    {STATUS_LABEL[row.status].toLowerCase()}
                  </span>
                );
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </Row>
  );
}

/** A misconception's code, as it is filed in the catalogue. */
function MisconceptionCode({ code }: { code: string }) {
  return (
    <span className="inline-block rounded-sm bg-muted px-2 py-0.5 text-xs font-semibold tracking-wide text-foreground">
      {code}
    </span>
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
 * up. The label is an identifier, so it is set in the grotesque even where the
 * sentence around it is serif; it is a link, so it takes the brand.
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
              className="tnum cursor-pointer rounded-sm font-sans text-[0.9em] font-semibold text-brand-ink underline decoration-brand-line decoration-dotted underline-offset-[3px] outline-none hover:decoration-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50"
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
 * Three bubbles filled in order, plus the word, never a status hue: green for
 * "high confidence" would read as good news, and a confidently-diagnosed
 * misconception is not good news. Fill survives greyscale and every
 * colour-vision deficiency; the word is what actually carries the meaning.
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
    <span className="inline-flex items-center gap-2.5 text-sm font-medium text-foreground">
      <span aria-hidden className="flex items-center gap-1">
        {[1, 2, 3].map((step) => (
          <Bubble key={step} size="xs" filled={step <= filled} />
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
 * the label a later review can be checked against. It is also the only write
 * path on this card, so it gets a band of its own and says plainly what the
 * write does, and what it does not.
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
    <div className="border-t border-brand-line bg-brand-soft/50">
      <div className="flex max-w-[72rem] flex-wrap items-center justify-between gap-x-8 gap-y-4 px-6 py-5 sm:px-9">
        <div className="min-w-0 flex-1 basis-80">
          {recorded ? (
            <p className="text-sm font-semibold text-foreground">
              {recorded === "agreed"
                ? "You agreed with this diagnosis."
                : "You disagreed with this diagnosis."}{" "}
              <span className="font-normal text-muted-foreground">
                Recorded against{" "}
                {data.trace_id ? `trace #${data.trace_id}` : "this diagnosis"}.
              </span>
            </p>
          ) : (
            <p className="text-sm font-semibold text-foreground">
              Does this match what you see in class?
            </p>
          )}
          <p className="mt-1 max-w-[62ch] text-xs leading-relaxed text-muted-foreground">
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

  return <ErrorState error={error} onRetry={onRetry} className="m-6 sm:m-9" />;
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
    <div className="px-6 py-8 sm:px-9">
      <div className="flex gap-4">
        <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-base font-semibold text-foreground">{title}</p>
          <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
            {body}
          </p>
          {detail ? (
            <p className="mt-3 max-w-[60ch] font-mono text-xs leading-relaxed break-words text-muted-foreground/80">
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
