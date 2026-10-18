import { useState, type ReactNode } from "react";
import {
  Check,
  LoaderCircle,
  PlugZap,
  Shuffle,
  Tags,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import {
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
  useDiagnosis,
  useDiagnosisVerdict,
} from "@/api/queries";
import { Bubble } from "@/components/brand/Bubble";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/common/States";
import { QuestionPanel } from "./QuestionPanel";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The AI diagnosis, laid out as a marked page.
 *
 * Every other panel on this screen reports what happened. This one says what
 * the student *misunderstands*, and the whole product claim rests on it being
 * legible to a teacher in about four seconds. So it is a page with a margin,
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
 * The counter-evidence is deliberately given the largest body type on the page
 * and its own rule rather than a grey footnote. "He was correct on the two
 * questions where the group was stated explicitly" is the sentence that proves
 * the finding is a specific trigger and not a topic gap — the most load-bearing
 * line on the screen, and the one a lesser product cannot produce.
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
          icon={<Tags aria-hidden className="size-5" />}
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

  return (
    <Shell subtitle={paperName} diagnosis={query.data}>
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
      className="overflow-hidden rounded-xl border border-foreground/25 bg-card shadow-md"
    >
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-muted/50 px-6 py-3 sm:px-9">
        <h2
          id="diagnosis-eyebrow"
          className="text-sm font-semibold text-foreground"
        >
          AI diagnosis
        </h2>
        {subtitle ? (
          <span className="text-sm text-muted-foreground">{subtitle}</span>
        ) : null}
        {diagnosis ? (
          <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            {diagnosis.from_cache ? (
              <span className="rounded-sm border border-border px-1.5 py-0.5 font-medium">
                Cached
              </span>
            ) : null}
            {/* An integer on the wire, not the opaque string this was first
                written for. Prefixed so a bare `53` in the corner of a card
                does not read as a count of something. */}
            {diagnosis.trace_id ? (
              <span
                className="tnum"
                title="Trace id — every diagnosis is reproducible from this."
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
          compact ? "py-4" : "py-7",
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

        <Row
          first
          margin={<TotalsMargin atStake={atStake} findings={findings} />}
        >
          {/* The hero. Everything else on this card is the footnote to it. */}
          <p className="max-w-[40ch] font-serif text-2xl leading-[1.15] font-semibold tracking-tight text-balance text-foreground sm:text-3xl">
            {data.headline || "No diagnosis text was returned for this paper."}
          </p>
        </Row>

        {data.pattern_found ? null : (
          <Row>
            <NoPattern name={firstName(studentName)} />
          </Row>
        )}

        {findings && !data.pattern_found ? (
          <Row compact>
            <p className="text-sm font-semibold text-muted-foreground">
              Weak signals, shown for completeness
            </p>
          </Row>
        ) : null}

        {findings ? (
          <ul>
            {data.hypotheses.map((h) => (
              <li key={`${h.misconception_code}-${h.claim}`}>
                <HypothesisRow
                  hypothesis={h}
                  studentId={studentId}
                  studentName={studentName}
                />
              </li>
            ))}
          </ul>
        ) : null}

        {/* What it takes to fix sits beside the action it prices, not up with
            what the finding costs. */}
        {data.recommended_action ? (
          <Row
            margin={timeToFix ? <TimeToFixBand label={timeToFix} /> : undefined}
          >
            <h3 className="text-sm font-semibold text-foreground">
              Do this week
            </h3>
            <p className="mt-2 max-w-[60ch] font-serif text-lg leading-relaxed text-foreground">
              {data.recommended_action}
            </p>
          </Row>
        ) : null}
      </div>

      <VerdictBar studentId={studentId} paperId={paperId} data={data} />
    </>
  );
}

/**
 * The margin beside the headline: what the finding costs, named for who
 * produced it, because this is the figure a director will quote.
 */
function TotalsMargin({
  atStake,
  findings,
}: {
  atStake: number;
  findings: number;
}) {
  if (!(atStake > 0)) return null;

  return (
    <div>
      <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-5xl leading-none font-semibold tracking-tight text-foreground">
          {num(atStake)}
        </span>{" "}
        {/* Named as a total when there is more than one finding, so it does
            not read as a contradiction of the single figure the headline
            quotes for the strongest one. */}
        <span className="text-sm font-medium text-foreground">
          marks at stake
          {findings > 1 ? ` across ${findings} findings` : ""}
        </span>
      </p>
      <p className="mt-2.5 max-w-[32ch] text-xs leading-snug text-muted-foreground">
        Counted from the answer sheet by the system. The AI is never asked for
        a number.
      </p>
    </div>
  );
}

/**
 * How long this takes to fix, as a band.
 *
 * It used to be free text, and the model — asked for a number of minutes —
 * answered "40 minutes", then "20", then "45" for the same student and the
 * same evidence, while the action it recommended never changed. The estimate
 * was noise wearing a number's clothes.
 *
 * So it is four bands now, and the label carries no digits. That is the point:
 * a director who spots one invented "45 minutes" has no way left to believe
 * the misconception above it, and the misconception is the product. "One
 * focused sitting" is a claim the system can actually defend — and a band, by
 * being visibly a band, tells the reader how precise the claim is meant to be
 * instead of implying a precision that was never there.
 */
function TimeToFixBand({ label }: { label: string }) {
  return (
    <div>
      <p className="text-sm font-medium text-foreground">
        <span className="text-muted-foreground">About </span>
        {label.toLowerCase()}
        <span className="text-muted-foreground"> to fix</span>
      </p>
      <p className="mt-1.5 max-w-[32ch] text-xs leading-snug text-muted-foreground">
        The AI&rsquo;s estimate, as a band. It is not asked for minutes: when it
        was, the answer changed every time.
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
          No systematic pattern — this looks like scattered carelessness
        </p>
        <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
          The wrong answers do not share a cause, so there is nothing to
          re-teach. That is a finding about {name}, not a gap in the analysis:
          a checking-and-pacing problem is fixed in a conversation, and
          re-teaching the chapter would waste the week.
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
 * One hypothesis
 * ------------------------------------------------------------------ */

function HypothesisRow({
  hypothesis,
  studentId,
  studentName,
}: {
  hypothesis: Hypothesis;
  studentId: number;
  studentName: string;
}) {
  // `evidence`, not `evidence_questions`. The latter is the labels the model
  // literally wrote and is display-only; this is the same list with each one
  // resolved against the student's own attempts.
  const { evidence } = hypothesis;

  return (
    <Row marginFirst margin={<HypothesisMargin hypothesis={hypothesis} />}>
      <p>
        <span className="inline-block rounded-sm bg-muted px-2 py-0.5 text-xs font-semibold tracking-wide text-foreground">
          {hypothesis.misconception_code}
        </span>
      </p>

      <p className="mt-3 max-w-[60ch] font-serif text-base leading-relaxed text-foreground">
        {hypothesis.claim}
      </p>

      {evidence.length ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-2">
          <span className="text-sm text-muted-foreground">Rests on</span>
          {/* Each chip carries the option this student actually picked, which
              is the difference between "he got D16 wrong" and "he picked C on
              D16" — the second is checkable against the paper in his hand.

              A citation the server could not tie to one of this student's wrong
              answers comes back with `question_id: null`, and is rendered as
              plain text rather than as something that looks openable. The
              contract is explicit about that, and it is right: a chip that
              opens an empty panel is worse than a chip that visibly is not
              one.

              A resolved chip is a button, and clicking it opens the question
              itself. That click is the whole point of tagging distractors: it
              turns "he chose C on D16" from a claim into the stem, the four
              options and the belief that produced C. The bubbles fill in one
              after another as the page inks in. */}
          {evidence.map((cited, i) => (
            <EvidenceChip
              key={cited.label}
              cited={cited}
              studentId={studentId}
              studentName={studentName}
              fillDelayMs={560 + i * 90}
            />
          ))}
          <span className="text-sm text-muted-foreground">
            {evidence.length === 1
              ? "1 question"
              : `${evidence.length} questions, same error`}
          </span>
        </div>
      ) : null}

      {hypothesis.counter_evidence ? (
        <CounterEvidence text={hypothesis.counter_evidence} />
      ) : null}
    </Row>
  );
}

function HypothesisMargin({ hypothesis }: { hypothesis: Hypothesis }) {
  return (
    <div className="space-y-4">
      <ConfidenceMeter level={hypothesis.confidence} />
      {hypothesis.marks_at_stake > 0 ? (
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="tnum text-3xl leading-none font-semibold tracking-tight text-foreground">
            {num(hypothesis.marks_at_stake)}
          </span>
          <span className="text-sm text-muted-foreground">marks at stake</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * One cited question.
 *
 * Resolved citations show the label and the option this student picked as a
 * filled bubble — the pencil mark — which is what makes the claim checkable
 * against the paper in the teacher's hand, and they *open* the question, which
 * makes it checkable without the paper in the teacher's hand at all.
 *
 * Unresolved ones — the model named a question that is not a wrong answer this
 * student gave on this paper — stay a dashed, inert span with a title saying
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
          "tnum inline-flex cursor-pointer items-center gap-2 rounded-sm border border-foreground/30 bg-card py-1 pl-2.5 text-sm font-semibold text-foreground shadow-xs transition-colors outline-none hover:border-foreground/60 hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35",
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
 * The counter-evidence.
 *
 * Given a rule, its own block and the largest body type on the page, because it
 * is the line that separates a diagnosis from a topic report. Anything can say
 * "weak at organic chemistry". Only a system that actually reasoned over the
 * questions can say "except on the two where the group was named, where he was
 * right" — and that exception is what makes the finding a trigger rather than
 * a subject gap, and what makes it fixable in one sitting rather than a term.
 *
 * The tick in a ring is the same mark a teacher uses for a correct answer.
 */
function CounterEvidence({ text }: { text: string }) {
  return (
    <div className="mt-7 border-l-[3px] border-foreground pl-5">
      <p className="flex items-center gap-2.5 text-sm font-semibold text-foreground">
        <span
          aria-hidden
          className="inline-grid size-5 place-items-center rounded-full border-[1.5px] border-foreground"
        >
          <Check className="size-3" strokeWidth={3} />
        </span>
        Why this is a trigger, not a topic gap
      </p>
      <p className="mt-2.5 max-w-[56ch] font-serif text-lg leading-relaxed text-foreground">
        {text}
      </p>
    </div>
  );
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
 * The feature that turns a generic tool into *their* system. It is also the
 * only write path on this card, so it says plainly what the write does.
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
    <div className="border-t border-border bg-muted/50">
      <div className="flex max-w-[72rem] flex-wrap items-center justify-between gap-x-8 gap-y-4 px-6 py-5 sm:px-9">
        <div className="min-w-0">
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
            Your answer trains the system on your institute&rsquo;s students —
            agreeing raises this misconception&rsquo;s weight for your papers,
            disagreeing lowers it.
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
            variant={recorded === "agreed" ? "default" : "outline"}
            aria-pressed={recorded === "agreed"}
            disabled={verdict.isPending}
            onClick={() => send("agreed")}
          >
            <ThumbsUp aria-hidden />
            Agree
          </Button>
          <Button
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
 * gets the red error treatment.
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
        icon={<PlugZap aria-hidden className="size-5" />}
        title="The reasoning layer is not connected yet"
        body={
          <>
            Everything else on this page is computed from your own data and
            needs no model. This card is the one part that calls one, and no key
            is configured on this deployment — so it is showing you that,
            instead of a number it made up.
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
        icon={<Tags aria-hidden className="size-5" />}
        title="Not enough tagged evidence on this paper"
        body={
          <>
            A diagnosis reasons over questions tagged with the misconception
            they test. This paper does not have enough of them yet, so there is
            nothing honest to say — tag its questions and the diagnosis appears
            with no re-import.
          </>
        }
        detail={error.message}
        action={{ label: "Try again", onClick: onRetry }}
      />
    );
  }

  return <ErrorState error={error} onRetry={onRetry} className="m-6" />;
}

function CalmState({
  icon,
  title,
  body,
  detail,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: ReactNode;
  detail?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="px-6 py-8 sm:px-9">
      <div className="flex gap-4">
        <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
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
