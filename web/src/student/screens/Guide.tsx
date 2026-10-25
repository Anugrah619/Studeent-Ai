import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Finding } from "@/api/types";
import { detailOf, fieldErrors, statusOf, useAskGuide, useMyGuidance } from "@/api/student";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { shortDay, todayISO } from "../lib";
import { ActionCard, Block, FieldMessages, FormNotice, LoadingRows, Pending, Quiet, ScreenHeader, Trouble } from "../ui";

const MAX_QUESTION = 500;
const SUGGESTIONS = [
  "What should I focus on this week?",
  "Which revision should I do first?",
  "How should I split my time between subjects?",
];

/** For a 503 without a sentence of its own. */
const GUIDE_AWAY =
  "The guide can't answer right now. Your plan, revisions and results all still work; ask again in a few minutes, or ask your mentor.";
const GUIDE_DONE_FOR_TODAY =
  "That's all the questions the guide can take today. It will answer again tomorrow, and your plan, revisions and results keep working meanwhile.";

/**
 * The guide: what to do next, what your teacher agreed the AI found, and a
 * place to ask about your preparation.
 *
 * A finding reaches this screen only after the student's mentor agreed with
 * it; the server decides that, and this screen shows the findings it is given
 * and nothing else. It never asks for a diagnosis itself.
 */
export function Guide() {
  const guidance = useMyGuidance();

  return (
    <>
      <ScreenHeader kicker="Guide" title="What to do next.">
        Suggestions from your own plan, revisions and mocks, and what your teacher agreed the guide
        noticed in your answers.
      </ScreenHeader>

      {guidance.isPending ? (
        <LoadingRows rows={3} label="Loading your guide" />
      ) : guidance.error ? (
        <Trouble error={guidance.error} what="your guide" onRetry={() => void guidance.refetch()} />
      ) : (
        <>
          <Block title="Next for you" className="mt-2">
            {guidance.data.next_actions.length ? (
              <ul className="space-y-2.5">
                {guidance.data.next_actions.map((action) => (
                  <li key={`${action.kind}-${action.title}`}>
                    <ActionCard action={action} wide />
                  </li>
                ))}
              </ul>
            ) : (
              <Quiet>Nothing to suggest right now. You&rsquo;re on top of things.</Quiet>
            )}
          </Block>

          <Block
            title="What your teacher agreed"
            description="Patterns the guide noticed in your answers, shown once your teacher has checked them and agreed."
          >
            {guidance.data.findings.length ? (
              <div className="space-y-4">
                {guidance.data.findings.map((finding, i) => (
                  <FindingCard key={`${finding.paper_id ?? "all"}-${i}`} finding={finding} />
                ))}
              </div>
            ) : (
              <Quiet>
                Nothing here yet. When the guide notices a pattern in a mock, your teacher looks at
                it first, and it appears here once they agree with it.
              </Quiet>
            )}
          </Block>
        </>
      )}

      <Ask />
    </>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  return (
    <article
      className="rounded-xl bg-card px-4 py-5 shadow-card ring-1 ring-foreground/10 sm:px-5"
      data-finding-paper={finding.paper_id ?? "all"}
    >
      <p className="text-sm text-muted-foreground">
        {finding.paper_name ?? "Across your papers"}
        {finding.approved_at ? `, agreed by your teacher on ${shortDay(todayISO(new Date(finding.approved_at)))}` : ", agreed by your teacher"}
      </p>
      <h3 className="mt-1.5 font-serif text-xl leading-snug font-semibold tracking-tight text-foreground">
        {finding.title}
      </h3>
      <p className="mt-2 max-w-[60ch] font-serif text-base leading-relaxed text-foreground">
        {finding.explanation}
      </p>
      <div className="mt-4 border-l-2 border-brand-line pl-4">
        <h4 className="text-sm font-semibold text-foreground">What to do</h4>
        <p className="mt-0.5 max-w-[60ch] text-sm leading-relaxed text-foreground">{finding.what_to_do}</p>
      </div>
      {finding.questions.length ? (
        <div className="mt-4">
          <p className="text-sm text-muted-foreground">The questions it&rsquo;s about</p>
          <ul className="mt-1.5 flex flex-wrap gap-2">
            {finding.questions.map((q) => (
              <li key={q.question_pk}>
                <Link
                  to={`/mistakes/${q.question_pk}`}
                  aria-label={`Open question ${q.label}`}
                  className="tnum inline-flex h-9 items-center rounded-md border border-border bg-card px-3 text-sm font-semibold text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {q.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

/**
 * Ask about your preparation. Answers come from the student's own data;
 * questions that ask the guide to solve something are declined by the server,
 * and the box says so up front so nobody spends a question finding out.
 */
function Ask() {
  const ask = useAskGuide();
  const [question, setQuestion] = useState("");
  const trimmed = question.trim();
  const tooLong = question.length > MAX_QUESTION;
  const status = statusOf(ask.error);
  const fields = fieldErrors(ask.error);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmed || tooLong || ask.isPending) return;
    ask.mutate(trimmed);
  }

  return (
    <Block
      id="ask"
      title="Ask about your preparation"
      description="What to focus on, why something is in your plan, how to split your week. The guide doesn't solve exam questions; take those to your teacher."
    >
      <form onSubmit={onSubmit} noValidate className="rounded-xl bg-card px-4 py-4 shadow-card ring-1 ring-foreground/10 sm:px-5">
        <Label htmlFor="guide-question">Your question</Label>
        <Textarea
          id="guide-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={3}
          placeholder="For example: what should I focus on this week?"
          className="mt-2"
          aria-invalid={tooLong || fields.question ? true : undefined}
          aria-describedby="guide-question-count guide-question-errors"
        />
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <p
            id="guide-question-count"
            className={cn("tnum text-xs", tooLong ? "font-medium text-foreground" : "text-muted-foreground")}
          >
            {question.length} of {MAX_QUESTION} characters
            {tooLong ? ". Shorten it a little." : ""}
          </p>
        </div>
        <FieldMessages id="guide-question-errors" messages={fields.question} />

        <div className="mt-3 flex flex-wrap gap-2" aria-label="Questions you could ask" role="group">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setQuestion(s)}
              className="rounded-md border border-border bg-background px-2.5 py-1.5 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {s}
            </button>
          ))}
        </div>

        <Button type="submit" className="mt-4" disabled={!trimmed || tooLong || ask.isPending}>
          {ask.isPending ? <Pending>Asking…</Pending> : "Ask the guide"}
        </Button>
      </form>

      <div aria-live="polite" className="mt-3 empty:hidden">
        {ask.isPending ? null : ask.data ? (
          <figure className="rounded-xl bg-muted/50 px-4 py-4">
            <figcaption className="text-sm font-semibold text-foreground">The guide says</figcaption>
            <p className="mt-1.5 max-w-[60ch] font-serif text-base leading-relaxed text-foreground">
              {ask.data.answer}
            </p>
            {ask.data.from_cache ? (
              <p className="mt-2 text-xs text-muted-foreground">You asked this before, so this is the same answer.</p>
            ) : null}
          </figure>
        ) : ask.error && status !== 400 ? (
          <FormNotice tone="problem">
            {status === 429
              ? GUIDE_DONE_FOR_TODAY
              : status === 503
                ? (detailOf(ask.error) ?? GUIDE_AWAY)
                : "The guide couldn't answer just now. Check your connection, then try again."}
          </FormNotice>
        ) : null}
      </div>
    </Block>
  );
}
