import { Link, useParams } from "react-router-dom";
import { Check, ChevronLeft, Hand } from "lucide-react";
import type { MyQuestion, MyQuestionOption } from "@/api/types";
import { statusOf, useMyQuestion } from "@/api/student";
import { Bubble } from "@/components/brand/Bubble";
import { MathText } from "@/components/kit/MathText";
import { Skeleton } from "@/components/ui/skeleton";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Sheet, Trouble } from "../ui";

/**
 * One question I answered: the stem, the options, what I chose, the right
 * answer, and the working.
 *
 * The two facts about an option are drawn as an answer sheet draws them —
 * my pencil mark is a filled bubble, the right answer is circled — and both are
 * also said in words, so neither depends on colour. There is no red: a wrong
 * answer being reviewed is the student doing exactly the right thing.
 *
 * The working is folded away, with a nudge to try the question again first —
 * the one moment in the app where not showing something straight away is the
 * kinder choice.
 */
export function MistakeDetail() {
  const { questionPk } = useParams();
  const pk = Number(questionPk);
  const question = useMyQuestion(pk);

  return (
    <div className="pt-5">
      <Link
        to="/mistakes"
        className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-brand-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronLeft aria-hidden className="size-4" />
        All your mistakes
      </Link>

      {!Number.isInteger(pk) || pk <= 0 || statusOf(question.error) === 404 ? (
        <NotOpenable />
      ) : question.isPending ? (
        <div role="status" aria-label="Loading the question" className="mt-6 space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="mt-6 h-48 w-full rounded-xl" />
        </div>
      ) : question.error ? (
        <div className="mt-6">
          <Trouble error={question.error} what="this question" onRetry={() => void question.refetch()} />
        </div>
      ) : (
        <QuestionBody q={question.data} />
      )}
    </div>
  );
}

function NotOpenable() {
  return (
    <div className="mt-6">
      <h1 className="font-serif text-2xl font-semibold tracking-tight">This question can&rsquo;t be opened.</h1>
      <p className="mt-2 max-w-[56ch] text-base leading-relaxed text-muted-foreground">
        Only questions you have answered open here, so that nobody sees a paper before sitting it.
        This one isn&rsquo;t among yours.
      </p>
    </div>
  );
}

function statusLine(q: MyQuestion, right: MyQuestionOption | undefined): string {
  const answer = right ? ` The right answer is (${right.label}).` : "";
  switch (q.status) {
    case "correct":
      return "You got this one right.";
    case "wrong":
      return q.chosen_label ? `You chose (${q.chosen_label}).${answer}` : `Your answer was wrong.${answer}`;
    case "blank":
      return `You left this one blank.${answer}`;
    case "not_reached":
      return `You didn't reach this one in time.${answer}`;
    default:
      return answer.trim();
  }
}

function QuestionBody({ q }: { q: MyQuestion }) {
  const right = q.options.find((o) => o.is_correct);
  const minutes = q.time_spent ? Math.floor(q.time_spent / 60) : 0;
  const seconds = q.time_spent ? q.time_spent % 60 : 0;

  return (
    <article className="mt-5" aria-labelledby="question-heading">
      <p className="text-sm text-muted-foreground">
        {[q.paper_name, q.subject, q.topic].filter(Boolean).join(", ")}
      </p>
      <h1 id="question-heading" className="mt-1 text-2xl font-semibold tracking-tight">
        Question <span className="tnum">{q.label}</span>
      </h1>
      <p className="mt-2 text-base font-medium text-foreground">{statusLine(q, right)}</p>
      <p className="tnum mt-0.5 text-sm text-muted-foreground">
        {q.marks !== null ? `${q.marks > 0 ? "+" : ""}${num(q.marks)} ${Math.abs(q.marks) === 1 ? "mark" : "marks"}` : null}
        {q.marks !== null && q.time_spent ? ", " : null}
        {q.time_spent ? `${minutes ? `${minutes} min ` : ""}${seconds} s on it` : null}
      </p>

      <Sheet className="mt-5 px-4 py-5 sm:px-6">
        <MathText as="p" className="max-w-[60ch] font-serif text-[1.25rem] leading-normal text-pretty text-foreground">
          {q.question_text || "This question has no text on file."}
        </MathText>

        {q.options.length ? (
          <ol className="-mx-2 mt-5 space-y-1" aria-label="Options">
            {q.options.map((option) => (
              <OptionRow key={option.label} option={option} />
            ))}
          </ol>
        ) : null}
      </Sheet>

      {q.solution ? (
        <details className="group mt-4 rounded-xl border border-border bg-card">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3.5 text-sm font-medium text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <span aria-hidden className="transition-transform group-open:rotate-90">
              &rsaquo;
            </span>
            Show the working
            <span className="font-normal text-muted-foreground">Try it once more first</span>
          </summary>
          <MathText as="p" className="max-w-[60ch] px-4 pb-4 font-serif text-base leading-relaxed text-foreground">
            {q.solution}
          </MathText>
        </details>
      ) : null}

      <p className="mt-6 text-sm text-muted-foreground">
        Still unsure after the working? Take it to your teacher; the guide doesn&rsquo;t solve
        questions.
      </p>
    </article>
  );
}

function OptionRow({ option }: { option: MyQuestionOption }) {
  const picked = option.chosen === true;
  const right = option.is_correct === true;
  return (
    <li className={cn("flex gap-4 rounded-md px-2 py-2.5", right && "bg-muted/60")} style={{ ["--bubble-gap" as string]: right ? "var(--muted)" : undefined }}>
      <Bubble letter={option.label} filled={picked} ringed={right} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="font-serif text-base leading-relaxed text-foreground">
          <span className="sr-only">Option {option.label}: </span>
          <MathText>{option.text}</MathText>
        </p>
        {right || picked ? (
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold text-foreground">
            {right ? (
              <span className="inline-flex items-center gap-1.5">
                <Check aria-hidden className="size-4" />
                Right answer
              </span>
            ) : null}
            {picked ? (
              <span className="inline-flex items-center gap-1.5">
                <Hand aria-hidden className="size-4" />
                Your answer
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
    </li>
  );
}
