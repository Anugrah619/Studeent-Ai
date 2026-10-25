import { useId, useState } from "react";
import { CircleCheck, Image as ImageIcon, Loader2 } from "lucide-react";
import { ApiError } from "@/api/client";
import { useDisagreements, useReviewDecision, type ReviewFilter } from "@/api/staff";
import type { KeyDisagreement, KeyReviewDecision } from "@/api/types";
import { Bubble } from "@/components/brand/Bubble";
import { EmptyState, ErrorState, PanelSkeleton } from "@/components/common/States";
import { MathText } from "@/components/kit/MathText";
import { PageHeadline } from "@/components/kit/PageHeadline";
import { Section } from "@/components/kit/Section";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { longDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Problem, plural } from "../common";

/**
 * The three decisions, each in one sentence of what it does — the reviewer
 * should never have to guess what a button will change.
 */
export const DECISIONS: { value: KeyReviewDecision; label: string; means: string }[] = [
  {
    value: "key_stands",
    label: "Official key stands",
    means:
      "The published answer is right: the question is trusted, and its wrong options can be tagged.",
  },
  {
    value: "key_wrong",
    label: "Key is wrong",
    means:
      "The answer as stored is wrong (usually a misread question): the question stays untrusted and its options cannot be tagged until it is corrected.",
  },
  {
    value: "unclear",
    label: "Unclear",
    means:
      "It needs a subject expert: the question stays untrusted, but leaves the waiting list. A later decision can replace this one.",
  },
];

const STATUS_LABEL: Record<KeyDisagreement["review"]["status"], string> = {
  unreviewed: "Not reviewed yet",
  key_stands: "Official key stands",
  key_wrong: "Key is wrong",
  unclear: "Unclear",
};

/** "2" → ["2"]; "1,2" → ["1", "2"]. A key can accept more than one option. */
const labelsIn = (answer: string) =>
  answer
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * The answer-key review queue.
 *
 * When a past paper is loaded, the AI solves every question without being
 * shown the answer, and its answer is compared with the official key. Every
 * question goes into the bank with the official key, never the AI's — the ones
 * listed here are where the two disagreed, and a person decides.
 */
export function ReviewPage() {
  const [status, setStatus] = useState<ReviewFilter>("unreviewed");
  const queue = useDisagreements(status);
  const [recorded, setRecorded] = useState<string | null>(null);
  const rows = queue.data ?? [];

  return (
    <div className="space-y-8 pb-6">
      <PageHeadline
        eyebrow="Answer-key review"
        title={
          queue.isPending
            ? "Answer-key review"
            : status === "unreviewed"
              ? rows.length
                ? `${plural(rows.length, "question")} where the AI's answer differs from the official key.`
                : "Nothing is waiting for review."
              : rows.length
                ? `${plural(rows.length, "decision")} recorded.`
                : "No decisions recorded yet."
        }
        support="The AI solved each past-paper question on its own, without the answer. These are the ones where it disagreed with the official key. The official key stays in the bank until a person decides."
      />

      <Section title="What each decision does">
        <dl className="grid gap-3 md:grid-cols-3">
          {DECISIONS.map((d) => (
            <div key={d.value} className="rounded-lg bg-card px-4 py-3 shadow-card ring-1 ring-border">
              <dt className="text-sm font-semibold text-foreground">{d.label}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{d.means}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section
        title={status === "unreviewed" ? "Waiting for a decision" : "Decided"}
        actions={
          <div
            role="group"
            aria-label="Show questions"
            className="flex rounded-md border border-border bg-card p-0.5"
          >
            {(["unreviewed", "reviewed"] as ReviewFilter[]).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={status === key}
                onClick={() => {
                  setStatus(key);
                  setRecorded(null);
                }}
                className={cn(
                  "rounded-sm px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  status === key
                    ? "bg-foreground text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {key === "unreviewed" ? "Waiting" : "Reviewed"}
              </button>
            ))}
          </div>
        }
      >
        <div aria-live="polite" className="mb-3">
          {recorded ? (
            <p className="flex items-center gap-2 text-sm font-medium text-status-good">
              <CircleCheck aria-hidden className="size-4" />
              {recorded}
            </p>
          ) : null}
        </div>

        {queue.isPending ? (
          <PanelSkeleton lines={8} />
        ) : queue.error ? (
          <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={status === "unreviewed" ? "The queue is empty" : "Nothing decided yet"}
            body={
              status === "unreviewed"
                ? "Every disagreement between the AI and the official key has a decision."
                : "Decisions appear here once a reviewer records one."
            }
          />
        ) : (
          <ol className="space-y-4" aria-label="Disagreements">
            {rows.map((item) => (
              <DisagreementCard
                key={item.id}
                item={item}
                onRecorded={(text) => setRecorded(text)}
              />
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

function DisagreementCard({
  item,
  onRecorded,
}: {
  item: KeyDisagreement;
  onRecorded: (text: string) => void;
}) {
  const decide = useReviewDecision();
  const [decision, setDecision] = useState<KeyReviewDecision | null>(
    item.review.status === "unreviewed" ? null : (item.review.status as KeyReviewDecision),
  );
  const [note, setNote] = useState(item.review.note ?? "");
  const noteId = useId();
  const groupName = useId();

  const official = labelsIn(item.official_answer);
  const model = labelsIn(item.model_answer);
  const reviewed = item.review.status !== "unreviewed";

  const record = () => {
    if (!decision) return;
    decide.mutate(
      { questionPk: item.id, decision, note: note.trim() },
      {
        onSuccess: (saved) =>
          onRecorded(
            `Recorded for ${saved.label} (${saved.paper_name}): ${STATUS_LABEL[saved.review.status]}.`,
          ),
      },
    );
  };

  return (
    <li
      data-disagreement={item.id}
      className="overflow-hidden rounded-xl bg-card shadow-card ring-1 ring-border"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border bg-muted/40 px-5 py-3">
        <span className="tnum text-base font-semibold text-foreground">{item.label}</span>
        <span className="text-sm text-muted-foreground">{item.paper_name}</span>
        {item.subject ? <span className="text-sm text-muted-foreground">{item.subject}</span> : null}
        {reviewed ? (
          <span className="ml-auto text-xs text-muted-foreground">
            {STATUS_LABEL[item.review.status]}
            {item.review.reviewed_by ? `, by ${item.review.reviewed_by}` : ""}
            {item.review.reviewed_at ? `, ${longDate(item.review.reviewed_at)}` : ""}
          </span>
        ) : null}
      </header>

      <div className="space-y-5 px-5 py-5">
        <MathText
          as="p"
          className="max-w-[62ch] font-serif text-lg leading-normal text-foreground"
        >
          {item.question_text || "No question text on file."}
        </MathText>
        {item.has_diagram ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <ImageIcon aria-hidden className="size-4" />
            The question has a figure, which is not shown here.
          </p>
        ) : null}

        {item.answer_type === "mcq" && item.options.length ? (
          <ol aria-label="Options" className="space-y-1">
            {item.options.map((option) => {
              const isOfficial = official.includes(option.label);
              const isModel = model.includes(option.label);
              return (
                <li
                  key={option.label}
                  className={cn("flex gap-3 rounded-md px-3 py-2", isOfficial && "bg-muted/60")}
                >
                  <Bubble letter={option.label} ringed={isOfficial} filled={isModel} />
                  <div className="min-w-0 flex-1">
                    <MathText as="p" className="font-serif text-base leading-relaxed text-foreground">
                      {option.text}
                    </MathText>
                    {isOfficial || isModel ? (
                      <p className="mt-0.5 flex flex-wrap gap-x-4 text-sm font-medium">
                        {isOfficial ? <span className="text-foreground">Official key</span> : null}
                        {isModel ? <span className="text-muted-foreground">The AI&rsquo;s answer</span> : null}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}

        <dl className="tnum flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">Official answer</dt>
            <dd className="font-semibold text-foreground">{item.official_answer || "—"}</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-muted-foreground">The AI&rsquo;s answer</dt>
            <dd className="font-semibold text-foreground">{item.model_answer || "—"}</dd>
          </div>
        </dl>

        {item.model_working ? (
          <details className="group rounded-md border border-border">
            <summary className="cursor-pointer list-none rounded-md px-4 py-3 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
              <span aria-hidden className="mr-2 inline-block transition-transform group-open:rotate-90">
                &rsaquo;
              </span>
              The AI&rsquo;s working
            </summary>
            <MathText
              as="p"
              className="max-w-[62ch] px-4 pt-0.5 pb-4 font-serif text-base leading-relaxed text-muted-foreground"
            >
              {item.model_working}
            </MathText>
          </details>
        ) : null}

        {item.detail_summary ? (
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Notes from the cross-check: </span>
            {item.detail_summary}
          </p>
        ) : null}

        <fieldset className="space-y-3 border-t border-border pt-4">
          <legend className="text-sm font-semibold text-foreground">
            {reviewed ? "Change the decision" : "Your decision"}
          </legend>
          <div className="grid gap-2 md:grid-cols-3">
            {DECISIONS.map((d) => (
              <label
                key={d.value}
                className={cn(
                  "flex cursor-pointer gap-2.5 rounded-md border px-3 py-2.5 text-sm transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                  decision === d.value
                    ? "border-foreground/40 bg-muted"
                    : "border-border hover:bg-muted/50",
                )}
              >
                <input
                  type="radio"
                  name={groupName}
                  value={d.value}
                  checked={decision === d.value}
                  onChange={() => setDecision(d.value)}
                  className="mt-0.5 accent-[var(--foreground)]"
                />
                <span>
                  <span className="block font-medium text-foreground">{d.label}</span>
                  <span className="block text-xs leading-relaxed text-muted-foreground">
                    {d.means}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div>
            <Label htmlFor={noteId} className="mb-1.5">
              Note <span className="font-normal text-muted-foreground">(optional, kept with the decision)</span>
            </Label>
            <Textarea
              id={noteId}
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Why, in a sentence: the working that settles it."
            />
          </div>
          {decide.error ? (
            <Problem title="The decision was not recorded.">
              {decide.error instanceof ApiError && decide.error.status === 404
                ? "This question is no longer in the review queue for your institute."
                : decide.error.message}
            </Problem>
          ) : null}
          <Button disabled={!decision || decide.isPending} onClick={record}>
            {decide.isPending ? <Loader2 aria-hidden className="animate-spin" /> : null}
            Record decision
          </Button>
        </fieldset>
      </div>
    </li>
  );
}
