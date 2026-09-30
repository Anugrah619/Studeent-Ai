import { useState, type ReactNode } from "react";
import {
  Check,
  CircleHelp,
  Hand,
  Lightbulb,
  Quote,
  Stethoscope,
  Timer,
  Unlink,
} from "lucide-react";
import {
  STATUS_LABEL,
  askedAboutStudent,
  chosenMisconception,
  chosenOption,
  correctOption,
  hasAttempt,
  isQuestionMissing,
  otherTaggedOptions,
  type QuestionDetail,
  type QuestionOption,
} from "@/api/questions";
import { useQuestion } from "@/api/queries";
import { ErrorState } from "@/components/common/States";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * One cited question, in full — the proof behind an evidence chip.
 *
 * The diagnosis card makes a claim and cites `D16`. Until this panel existed the
 * citation was an assertion: the reader could see *that* a question was cited
 * and not *what it was*, which is the difference between a system a teacher
 * trusts and a system a teacher is asked to take on faith. So the panel is
 * ordered as the argument a teacher actually needs, and that order is not the
 * order the API returns:
 *
 *   1  the stem            the artefact under discussion, at reading size
 *   2  the four options    the student's pick and the right answer, marked
 *                          DIFFERENTLY — never by colour alone
 *   3  the belief          what picking *that* option reveals, in the student's
 *                          own voice. The most valuable sentence on the screen
 *   4  the remedy          the lesson that fixes it
 *   5  the worked method   folded away, because a teacher already knows the
 *                          answer — they are here for why this student chose
 *                          otherwise
 *
 * Point 3 is why the endpoint is worth opening at all. "He got D16 wrong" is a
 * mark. "A catalyst speeds the forward reaction up, so it pushes the equilibrium
 * towards the products" is a *belief*, stated as the student holds it, and it is
 * teachable on Monday morning. It gets the largest quoted type on the panel and
 * its own rule, not a tooltip.
 */
export function QuestionPanel({
  questionId,
  studentId,
  studentName,
  children,
}: {
  questionId: number;
  /**
   * Omit to fetch the question on its own. The per-student fields then come
   * back **null, not false** — "not asked", which the panel says explicitly
   * rather than rendering as "chose nothing".
   */
  studentId?: number;
  studentName?: string;
  /** The chip that opens this. Radix returns focus to it on close. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Nothing is fetched until the chip is clicked: a hypothesis carries five of
  // these and a paper carries forty.
  const query = useQuestion(questionId, studentId, open);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="max-h-[88vh] w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl"
        aria-describedby="question-panel-meta"
      >
        {query.isPending ? (
          <QuestionSkeleton />
        ) : query.error ? (
          <QuestionFailure
            error={query.error}
            questionId={questionId}
            onRetry={() => void query.refetch()}
          />
        ) : query.data ? (
          <QuestionBody data={query.data} studentName={studentName} />
        ) : (
          <QuestionSkeleton />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * Body
 * ------------------------------------------------------------------ */

function QuestionBody({
  data,
  studentName,
}: {
  data: QuestionDetail;
  studentName?: string;
}) {
  const asked = askedAboutStudent(data);
  const attempted = hasAttempt(data);
  const chosen = chosenOption(data);
  const correct = correctOption(data);
  const belief = chosenMisconception(data);
  const alsoTagged = otherTaggedOptions(data);
  const who = studentName ? firstName(studentName) : "This student";

  return (
    <>
      <DialogHeader className="gap-1 border-b border-border bg-muted/40 py-3.5 pr-12 pl-5 sm:pl-7">
        <DialogTitle className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-base">
          <span className="tnum font-mono text-sm font-semibold">
            {data.label || `#${data.id}`}
          </span>
          <span className="text-sm font-normal text-muted-foreground">
            {[data.subject, data.topic].filter(Boolean).join(" · ") ||
              "Unmapped question"}
          </span>
        </DialogTitle>
        <DialogDescription
          id="question-panel-meta"
          className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
        >
          {data.paper_name ? <span>{data.paper_name}</span> : null}
          {data.difficulty ? (
            <>
              <span aria-hidden className="text-border">
                ·
              </span>
              <span className="capitalize">{data.difficulty}</span>
            </>
          ) : null}
          {attempted && data.status ? (
            <>
              <span aria-hidden className="text-border">
                ·
              </span>
              <span className="font-medium text-foreground">
                {STATUS_LABEL[data.status]}
              </span>
            </>
          ) : null}
          {attempted && data.marks !== null ? (
            <>
              <span aria-hidden className="text-border">
                ·
              </span>
              {/* Signed and singularised. "-1 marks" is what a negative mark
                  reads as when nobody looks, and this number is the one a
                  director can check against the paper in a minute. */}
              <span
                className="tnum"
                title={
                  data.marks < 0
                    ? "Negative marking: a wrong answer costs a mark."
                    : undefined
                }
              >
                {data.marks > 0 ? `+${num(data.marks)}` : num(data.marks)}{" "}
                {Math.abs(data.marks) === 1 ? "mark" : "marks"}
              </span>
            </>
          ) : null}
          {attempted && data.time_spent !== null ? (
            <>
              <span aria-hidden className="text-border">
                ·
              </span>
              <span className="tnum inline-flex items-center gap-1">
                <Timer aria-hidden className="size-3" />
                {data.time_spent}s
              </span>
            </>
          ) : null}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5 px-5 py-5 sm:px-7 sm:py-6">
        {/* 1 — the stem. The artefact. Biggest reading-size text on the panel. */}
        <p className="max-w-[58ch] text-base leading-relaxed font-medium text-balance text-foreground sm:text-[1.0625rem]">
          {data.question_text || "This question has no stem on file."}
        </p>

        {/* 2 — the options. */}
        {data.options.length ? (
          <ol className="space-y-1.5" aria-label="Options">
            {data.options.map((option) => (
              <li key={option.label}>
                <OptionRow option={option} who={who} asked={asked} />
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">
            No options are recorded for this question, so there is nothing to
            show about which one was picked.
          </p>
        )}

        {/* The three per-student states, told apart. `chosen: null` is "not
            asked" and `chosen: false` everywhere with a null `status` is "asked,
            never answered here" — the API distinguishes them and so must this. */}
        {!asked ? (
          <Note icon={<CircleHelp aria-hidden className="size-4" />}>
            Shown as the paper prints it. No student was named, so nothing here
            says which option anyone picked — not even that they picked none.
          </Note>
        ) : !attempted ? (
          <Note icon={<Hand aria-hidden className="size-4" />}>
            {who} has no attempt recorded on this question, so no option is
            marked as theirs.
          </Note>
        ) : null}

        {/* 3 — the belief. The reason this panel exists. */}
        {belief ? (
          <Belief
            who={who}
            optionLabel={chosen?.label ?? data.chosen_label ?? ""}
            name={belief.name}
            code={belief.code}
            description={belief.description}
          />
        ) : attempted && chosen && !chosen.is_correct ? (
          <Note icon={<Unlink aria-hidden className="size-4" />}>
            Nobody has tagged option ({chosen.label}) with the belief that
            produces it, so this wrong answer cannot feed a diagnosis. That is a
            gap in the question bank, not a gap in {who}&rsquo;s understanding —
            tag the distractor and it starts counting.
          </Note>
        ) : null}

        {/* 4 — the remedy. */}
        {belief?.remedy ? (
          <Remedy text={belief.remedy} />
        ) : belief ? (
          <Note icon={<Lightbulb aria-hidden className="size-4" />}>
            This misconception has a name but no recorded remedy, so the panel
            has nothing to tell you to run. {belief.code} is the code to add one
            against.
          </Note>
        ) : null}

        {alsoTagged.length ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {alsoTagged.length === 1
              ? `One other distractor on this question carries a belief of its own (${alsoTagged[0].label} — ${alsoTagged[0].misconception?.name}). `
              : `${alsoTagged.length} other distractors here carry beliefs of their own. `}
            {attempted && chosen && !chosen.is_correct
              ? "Only the one above fired, because only one option can be chosen."
              : "None of them fired."}
          </p>
        ) : null}

        {/* 5 — the worked method, folded away. A teacher knows the answer. */}
        {data.solution ? <Solution text={data.solution} correct={correct} /> : null}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * One option
 *
 * Two independent facts can be true of a row — "this is the right answer" and
 * "this student picked it" — and they are marked by two different means so
 * neither depends on hue: the correct answer gets a tick and the word Correct;
 * the student's pick gets a filled letter, a pointing hand and their name. A
 * reader in greyscale, or with any colour-vision deficiency, still gets both.
 * ------------------------------------------------------------------ */

function OptionRow({
  option,
  who,
  asked,
}: {
  option: QuestionOption;
  who: string;
  asked: boolean;
}) {
  // `=== true` on purpose. `null` is "not asked" and `false` is "not picked",
  // and only the former must leave the row completely unmarked.
  const picked = option.chosen === true;
  const wrongPick = picked && !option.is_correct;

  return (
    <div
      className={cn(
        "flex gap-3 rounded-lg border px-3 py-2.5",
        option.is_correct
          ? "border-status-good/45 bg-status-good/[0.06]"
          : wrongPick
            ? "border-status-critical/45 bg-status-critical/[0.06]"
            : "border-border",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "tnum mt-px flex size-6 shrink-0 items-center justify-center rounded-md border font-mono text-[11px] font-semibold",
          picked
            ? "border-transparent bg-foreground text-background"
            : "border-border bg-muted text-muted-foreground",
        )}
      >
        {option.label}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm leading-relaxed text-foreground">
          <span className="sr-only">Option {option.label}: </span>
          {option.text}
        </p>

        {option.is_correct || (asked && picked) ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-semibold tracking-wide uppercase">
            {option.is_correct ? (
              <span className="inline-flex items-center gap-1 text-status-good">
                <Check aria-hidden className="size-3.5" />
                Correct answer
              </span>
            ) : null}
            {asked && picked ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1",
                  option.is_correct ? "text-foreground" : "text-status-critical",
                )}
              >
                <Hand aria-hidden className="size-3.5" />
                {who} chose this
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The belief
 *
 * Given the largest quoted type on the panel, its own rule and no colour that
 * reads as an error. It is not a warning — it is a sentence the student would
 * agree with, which is exactly what makes it teachable. A teacher who reads it
 * knows what to say at the board; a mark out of four never told them that.
 * ------------------------------------------------------------------ */

function Belief({
  who,
  optionLabel,
  name,
  code,
  description,
}: {
  who: string;
  optionLabel: string;
  name: string;
  code: string;
  description: string;
}) {
  return (
    <section
      aria-labelledby="belief-heading"
      className="rounded-lg border border-foreground/20 bg-muted/40 px-4 py-4 sm:px-5"
    >
      <h3
        id="belief-heading"
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold tracking-[0.08em] text-foreground uppercase"
      >
        <Stethoscope aria-hidden className="size-3.5" />
        {optionLabel
          ? `What choosing (${optionLabel}) reveals — in ${who}'s own words`
          : `What this choice reveals — in ${who}'s own words`}
      </h3>

      <blockquote className="mt-2.5 flex gap-2.5">
        <Quote
          aria-hidden
          className="mt-1 size-4 shrink-0 text-muted-foreground"
        />
        <p className="max-w-[52ch] text-[0.9375rem] leading-relaxed text-foreground sm:text-base">
          {description}
        </p>
      </blockquote>

      <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <code className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium text-foreground">
          {code}
        </code>
        {name ? <span>{name}</span> : null}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The remedy
 * ------------------------------------------------------------------ */

function Remedy({ text }: { text: string }) {
  return (
    <section
      aria-labelledby="remedy-heading"
      className="border-l-[3px] border-status-good bg-status-good/[0.07] py-3 pr-4 pl-3.5"
    >
      <h3
        id="remedy-heading"
        className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-foreground uppercase"
      >
        <Lightbulb aria-hidden className="size-3.5" />
        What fixes it
      </h3>
      <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-foreground">
        {text}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The worked method
 *
 * A native `<details>`: closed by default, keyboard-operable without any focus
 * management of its own, and it cannot fight the dialog's focus trap. Last on
 * the panel because a teacher already knows the answer — what they came for is
 * three blocks up.
 * ------------------------------------------------------------------ */

function Solution({
  text,
  correct,
}: {
  text: string;
  correct: { label: string } | null;
}) {
  return (
    <details className="group rounded-lg border border-border">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3.5 py-2.5 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        <span
          aria-hidden
          className="transition-transform group-open:rotate-90"
        >
          &rsaquo;
        </span>
        The worked method
        {correct?.label ? (
          <span className="font-normal">· answer ({correct.label})</span>
        ) : null}
      </summary>
      <p className="max-w-prose px-3.5 pt-0.5 pb-3.5 text-sm leading-relaxed text-muted-foreground">
        {text}
      </p>
    </details>
  );
}

/* ------------------------------------------------------------------ *
 * Notes, loading, failure
 * ------------------------------------------------------------------ */

function Note({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex gap-2.5 rounded-lg border border-dashed border-border bg-muted/30 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
      <span className="mt-px shrink-0">{icon}</span>
      <span className="max-w-prose">{children}</span>
    </p>
  );
}

function QuestionSkeleton() {
  return (
    <>
      <DialogHeader className="gap-1 border-b border-border bg-muted/40 py-3.5 pr-12 pl-5 sm:pl-7">
        <DialogTitle className="text-base">
          <span className="sr-only">Loading the cited question</span>
          {/* A `<span>`, not the `Skeleton` div: these live inside the Radix
              `h2`/`p` the header renders, and a div in a `p` is reparented by
              the browser's own parser — which unmounts React's node. */}
          <span
            aria-hidden
            className="inline-block h-4 w-44 animate-pulse rounded-md bg-muted align-middle"
          />
        </DialogTitle>
        <DialogDescription id="question-panel-meta">
          <span
            aria-hidden
            className="inline-block h-3 w-56 animate-pulse rounded-md bg-muted align-middle"
          />
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-5 px-5 py-5 sm:px-7 sm:py-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-[92%]" />
          <Skeleton className="h-4 w-[64%]" />
        </div>
        <div className="space-y-1.5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-28 rounded-lg" />
      </div>
    </>
  );
}

/**
 * The two ways this can fail, and they are not the same claim.
 *
 * A **404** means the citation did not resolve to a question this institute
 * holds. It will still not resolve on a second attempt, so the panel says that
 * in a sentence and offers no retry — a spinner that never ends, or a "try
 * again" that never can, both read as a broken console rather than as the
 * honest answer this is. Anything else is a real failure and gets the ordinary
 * error state with a retry.
 */
function QuestionFailure({
  error,
  questionId,
  onRetry,
}: {
  error: Error;
  questionId: number;
  onRetry: () => void;
}) {
  if (isQuestionMissing(error)) {
    return (
      <>
        <DialogHeader className="gap-1 border-b border-border bg-muted/40 py-3.5 pr-12 pl-5 sm:pl-7">
          <DialogTitle className="text-base">
            This citation has no question behind it
          </DialogTitle>
          <DialogDescription id="question-panel-meta" className="text-xs">
            Question #{questionId} is not in this institute&rsquo;s papers.
          </DialogDescription>
        </DialogHeader>
        <div className="px-5 py-5 sm:px-7">
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            The diagnosis cited a question the server could resolve to an id, but
            that id no longer answers — the paper may have been re-imported since
            the diagnosis was cached. Nothing is claimed for it, and the marks
            above do not count it.
          </p>
          <p className="mt-2.5 font-mono text-[11px] break-words text-muted-foreground/80">
            {error.message}
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <DialogHeader className="gap-1 border-b border-border bg-muted/40 py-3.5 pr-12 pl-5 sm:pl-7">
        <DialogTitle className="text-base">Could not load the question</DialogTitle>
        <DialogDescription id="question-panel-meta" className="text-xs">
          Question #{questionId}
        </DialogDescription>
      </DialogHeader>
      <div className="px-5 py-5 sm:px-7">
        <ErrorState error={error} onRetry={onRetry} />
      </div>
    </>
  );
}

/**
 * The name to address a student by in prose. Same rule as the diagnosis card:
 * "Md. Faizan Ali" must not become "Md.".
 */
function firstName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return parts.find((part) => !part.endsWith(".")) ?? parts[0] ?? full;
}
