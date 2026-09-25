import { useState, type ReactNode } from "react";
import {
  Clock,
  LoaderCircle,
  PlugZap,
  Scale,
  Shuffle,
  Sparkles,
  Tags,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import type { Confidence, Diagnosis, Hypothesis } from "@/api/diagnosis";
import {
  isNotEnoughEvidence,
  isReasoningUnavailable,
  useDiagnosis,
  useDiagnosisVerdict,
} from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common/States";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The AI diagnosis.
 *
 * Every other panel on this screen reports what happened. This one says what
 * the student *misunderstands*, and the whole product claim rests on it being
 * legible to a teacher in about four seconds. The layout is therefore an
 * argument, in order:
 *
 *   headline        the claim, at hero size — one sentence, actionable
 *   marks + time    what it costs and what it takes to fix, on one line
 *   hypotheses      the claim broken out, each with the question ids behind it
 *   counter-evidence the observation that argues *against* each claim
 *   action          what to do this week
 *   verdict         agree / disagree, which trains the system
 *
 * The counter-evidence is deliberately given body-text size and its own block
 * rather than a grey footnote. "He was correct on the two questions where the
 * group was stated explicitly" is the sentence that proves the finding is a
 * specific trigger and not a topic gap — it is the most load-bearing line on
 * the screen, and it is the one a lesser product cannot produce.
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

  if (!query.data) return <DiagnosisSkeleton />;

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
      className="overflow-hidden rounded-xl border border-foreground/20 bg-card shadow-sm"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted/40 px-5 py-2.5">
        <h2
          id="diagnosis-eyebrow"
          className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-foreground uppercase"
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
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                Cached
              </span>
            ) : null}
            {diagnosis.trace_id ? (
              <span
                className="font-mono text-[10px] text-muted-foreground"
                title="Trace id — every diagnosis is reproducible from this."
              >
                {diagnosis.trace_id}
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
      <div className="space-y-5 px-5 py-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-[85%]" />
          <Skeleton className="h-7 w-[55%]" />
        </div>
        <Skeleton className="h-4 w-64" />
        <div className="space-y-3">
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
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
  const atStake = data.hypotheses.reduce((sum, h) => sum + h.marks_at_stake, 0);

  return (
    <div className="px-5 pt-5 pb-4 sm:px-7 sm:pt-7">
      {/* The hero. Everything else on this card is the footnote to it. */}
      <p className="max-w-[46ch] text-xl leading-[1.25] font-semibold tracking-tight text-balance text-foreground sm:text-2xl md:text-[1.75rem]">
        {data.headline || "No diagnosis text was returned for this paper."}
      </p>

      {/* The cost and the price of fixing it, on one line, directly under the
          claim. A 20-mark finding that takes forty minutes to fix is the whole
          pitch in eleven words, and it belongs where the eye already is. */}
      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        {atStake > 0 ? (
          <>
            <span className="tnum font-semibold text-foreground">
              {num(atStake)} marks
            </span>
            {/* Named as a total when there is more than one finding, so it does
                not read as a contradiction of the single figure the headline
                quotes for the strongest one. */}
            <span>
              at stake
              {data.hypotheses.length > 1
                ? ` across ${data.hypotheses.length} findings`
                : ""}
            </span>
            <span aria-hidden className="text-border">
              ·
            </span>
          </>
        ) : null}
        {data.time_to_fix ? (
          <span className="inline-flex items-center gap-1.5">
            <Clock aria-hidden className="size-3.5" />
            {data.time_to_fix}
          </span>
        ) : null}
      </p>

      {data.pattern_found ? null : <NoPattern name={firstName(studentName)} />}

      {data.hypotheses.length ? (
        <div className="mt-6">
          <h3 className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {data.pattern_found
              ? `What the evidence says (${data.hypotheses.length})`
              : "Weak signals, shown for completeness"}
          </h3>
          <ul className="mt-3 space-y-3">
            {data.hypotheses.map((h) => (
              <li key={`${h.misconception_code}-${h.claim}`}>
                <HypothesisBlock hypothesis={h} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.recommended_action ? (
        <div className="mt-6 rounded-lg border border-border bg-muted/40 px-4 py-3.5">
          <h3 className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Do this week
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-foreground">
            {data.recommended_action}
          </p>
        </div>
      ) : null}

      <VerdictBar studentId={studentId} paperId={paperId} data={data} />
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
    <div className="mt-6 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-4">
      <div className="flex gap-3">
        <Shuffle aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            No systematic pattern — this looks like scattered carelessness
          </p>
          <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
            The wrong answers do not share a cause, so there is nothing to
            re-teach. That is a finding about {name}, not a gap in the analysis:
            a checking-and-pacing problem is fixed in a conversation, and
            re-teaching the chapter would waste the week.
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
 * One hypothesis
 * ------------------------------------------------------------------ */

function HypothesisBlock({ hypothesis }: { hypothesis: Hypothesis }) {
  const { evidence_questions: evidence } = hypothesis;

  return (
    <article className="rounded-lg border border-border bg-background/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <code className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground">
            {hypothesis.misconception_code}
          </code>
          <ConfidenceMeter level={hypothesis.confidence} />
        </div>
        {hypothesis.marks_at_stake > 0 ? (
          <div className="shrink-0 text-right">
            <div className="tnum text-xl leading-none font-semibold text-foreground">
              {num(hypothesis.marks_at_stake)}
            </div>
            <div className="mt-0.5 text-[10px] tracking-wide text-muted-foreground uppercase">
              marks at stake
            </div>
          </div>
        ) : null}
      </div>

      <p className="mt-3 max-w-prose text-sm leading-relaxed text-foreground">
        {hypothesis.claim}
      </p>

      {evidence.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Rests on
          </span>
          {/* Not links: nothing in the contract maps a question id to anything
              openable — API_GAPS.DIAGNOSIS_EVIDENCE_NOT_LINKABLE. Showing them
              as inert chips is honest; a dead link would not be. */}
          {evidence.map((q) => (
            <span
              key={String(q)}
              className="tnum rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground"
            >
              {String(q)}
            </span>
          ))}
          <span className="text-[11px] text-muted-foreground">
            {evidence.length === 1
              ? "· 1 question"
              : `· ${evidence.length} questions, same error`}
          </span>
        </div>
      ) : null}

      {hypothesis.counter_evidence ? (
        <CounterEvidence text={hypothesis.counter_evidence} />
      ) : null}
    </article>
  );
}

/**
 * The counter-evidence.
 *
 * Given a rule, its own block and body text, because it is the line that
 * separates a diagnosis from a topic report. Anything can say "weak at organic
 * chemistry". Only a system that actually reasoned over the questions can say
 * "except on the two where the group was named, where he was right" — and that
 * exception is what makes the finding a trigger rather than a subject gap, and
 * what makes it fixable in forty minutes rather than a term.
 */
function CounterEvidence({ text }: { text: string }) {
  return (
    <div className="mt-3.5 border-l-[3px] border-status-good bg-status-good/[0.07] py-2.5 pr-3 pl-3.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-foreground uppercase">
        <Scale aria-hidden className="size-3.5" />
        Why this is a trigger, not a topic gap
      </p>
      <p className="mt-1 max-w-prose text-sm leading-relaxed text-foreground">
        {text}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Confidence
 *
 * Three steps of one ordinal ramp plus the word, never a status hue: green for
 * "high confidence" would read as good news, and a confidently-diagnosed
 * misconception is not good news. Filled steps survive greyscale and every
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

function ConfidenceMeter({ level }: { level: Confidence }) {
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
    <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-border pt-4">
      <div className="min-w-0">
        {recorded ? (
          <p className="text-sm font-medium text-foreground">
            {recorded === "agreed"
              ? "You agreed with this diagnosis."
              : "You disagreed with this diagnosis."}{" "}
            <span className="font-normal text-muted-foreground">
              Recorded against {data.trace_id || "this diagnosis"}.
            </span>
          </p>
        ) : (
          <p className="text-sm font-medium text-foreground">
            Does this match what you see in class?
          </p>
        )}
        <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-muted-foreground">
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
          size="sm"
          variant={recorded === "agreed" ? "default" : "outline"}
          aria-pressed={recorded === "agreed"}
          disabled={verdict.isPending}
          onClick={() => send("agreed")}
        >
          <ThumbsUp aria-hidden />
          Agree
        </Button>
        <Button
          size="sm"
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

  return <ErrorState error={error} onRetry={onRetry} className="m-5" />;
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
    <div className="px-5 py-7 sm:px-7">
      <div className="flex gap-4">
        <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
        <div className="min-w-0">
          <p className="text-base font-semibold text-foreground">{title}</p>
          <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
            {body}
          </p>
          {detail ? (
            <p className="mt-2.5 max-w-prose font-mono text-[11px] leading-relaxed break-words text-muted-foreground/80">
              {detail}
            </p>
          ) : null}
          {action ? (
            <Button
              size="sm"
              variant="outline"
              className="mt-3.5"
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
