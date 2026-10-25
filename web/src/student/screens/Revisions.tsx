import { useState } from "react";
import { Link } from "react-router-dom";
import type { MyRevision, TopicState } from "@/api/types";
import { useCompleteRevision, useMyRevisions, useMyTopicStates } from "@/api/student";
import { Bubble } from "@/components/brand/Bubble";
import { Button } from "@/components/ui/button";
import { daysFromToday, dueText, plural, shortDay } from "../lib";
import { Block, FormNotice, LoadingRows, Pending, Quiet, ScreenHeader, Sheet, SubjectLabel, Trouble } from "../ui";

/**
 * Revisions: the R1/R2/R3 cycles the system schedules for each chapter, due
 * ones first.
 *
 * A revision past its date is a fact about a calendar, not a verdict, so it
 * reads "was due 3 days ago" in the same ink as everything else — no red, no
 * "overdue" chip. It is still the most useful thing on the list, which is why
 * it comes first.
 */
export function Revisions() {
  const revisions = useMyRevisions();
  const complete = useCompleteRevision();
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const rows = revisions.data ?? [];
  const due = rows.filter((r) => r.is_overdue || daysFromToday(r.scheduled_for) <= 0);
  const later = rows.filter((r) => !due.includes(r));

  async function markDone(revision: MyRevision) {
    setFailed(null);
    setConfirmation(null);
    try {
      await complete.mutateAsync(revision.id);
      // The server schedules the next cycle in the same request, and the list
      // has been refetched by now — so say when it is.
      setConfirmation(revision.topic.name);
    } catch {
      setFailed(revision.topic.name);
    }
  }

  return (
    <>
      <ScreenHeader
        kicker="Revisions"
        title={
          revisions.isPending
            ? "Your revisions."
            : due.length
              ? `${plural(due.length, "revision is", "revisions are")} waiting.`
              : "Nothing is due. You're up to date."
        }
      >
        Going back over a chapter on time is what stops it fading. Each one is a short session,
        about half an hour.
      </ScreenHeader>

      <div aria-live="polite" className="empty:hidden">
        {confirmation ? <Confirmation topic={confirmation} rows={rows} /> : null}
        {failed ? (
          <FormNotice tone="problem">
            {failed} wasn&rsquo;t marked done. Check your connection, then try again.
          </FormNotice>
        ) : null}
      </div>

      {revisions.isPending ? (
        <LoadingRows rows={3} label="Loading your revisions" />
      ) : revisions.error ? (
        <Trouble error={revisions.error} what="your revisions" onRetry={() => void revisions.refetch()} />
      ) : (
        <>
          <Block title="Due now" className="mt-4">
            {due.length ? (
              <RevisionList
                rows={due}
                busyId={complete.isPending ? complete.variables : undefined}
                onDone={markDone}
              />
            ) : (
              <Quiet>No revision is due today.</Quiet>
            )}
          </Block>

          <Block title="Coming up" description="Doing one early is fine; the next is scheduled from when you do it.">
            {later.length ? (
              <RevisionList
                rows={later}
                busyId={complete.isPending ? complete.variables : undefined}
                onDone={markDone}
              />
            ) : (
              <Quiet>
                Nothing scheduled yet. A chapter&rsquo;s first revision is set for the day after
                you first study it.
              </Quiet>
            )}
          </Block>
        </>
      )}

      <Fading />
    </>
  );
}

function RevisionList({
  rows,
  busyId,
  onDone,
}: {
  rows: MyRevision[];
  busyId: number | undefined;
  onDone: (revision: MyRevision) => void;
}) {
  return (
    <Sheet as="ul" className="divide-y divide-border">
      {rows.map((revision) => (
        <li key={revision.id} className="flex items-center gap-3 px-4 py-3.5" data-revision-id={revision.id}>
          <div className="min-w-0 flex-1">
            <p className="text-base leading-snug font-semibold text-foreground">{revision.topic.name}</p>
            <p className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-muted-foreground">
              <SubjectLabel subject={revision.topic.subject} />
              <span>Revision {revision.cycle} of 3</span>
            </p>
            <p className="mt-1 text-sm font-medium text-foreground">{dueText(revision.scheduled_for)}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDone(revision)}
            disabled={busyId === revision.id}
            aria-label={`Mark ${revision.topic.name}, revision ${revision.cycle}, done`}
          >
            {busyId === revision.id ? <Pending>Saving</Pending> : "Mark done"}
          </Button>
        </li>
      ))}
    </Sheet>
  );
}

/** What happened, and what is next for that chapter. */
function Confirmation({ topic, rows }: { topic: string; rows: MyRevision[] }) {
  const next = rows
    .filter((r) => r.topic.name === topic)
    .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for))[0];
  return (
    <div className="mb-2 flex items-start gap-3 rounded-xl bg-brand-soft px-4 py-3">
      <Bubble size="sm" filled className="mt-0.5" />
      <p className="text-sm leading-relaxed text-foreground">
        Marked done.{" "}
        {next
          ? `Revision ${next.cycle} of ${topic} is set for ${shortDay(next.scheduled_for)}.`
          : `That was the last revision of ${topic} before the exam.`}
      </p>
    </div>
  );
}

/**
 * Chapters the forecast says are slipping: recall below one in two. Shown as
 * a likelihood, because it is one — a forecast from how long ago the chapter
 * was last touched, not a test result.
 */
function Fading() {
  const fading = useMyTopicStates({ forgetting: true });
  const [showAll, setShowAll] = useState(false);
  const rows = fading.data ?? [];
  if (fading.isPending || fading.error || !rows.length) return null;
  const shown = showAll ? rows : rows.slice(0, 5);

  return (
    <Block
      title="Starting to fade"
      description="Chapters you'd likely recall less than half of today. A short revise brings one back."
    >
      <Sheet as="ul" className="divide-y divide-border">
        {shown.map((state) => (
          <FadingRow key={state.id} state={state} />
        ))}
      </Sheet>
      {rows.length > shown.length ? (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAll(true)}>
          Show all {rows.length}
        </Button>
      ) : null}
    </Block>
  );
}

function FadingRow({ state }: { state: TopicState }) {
  const pct = Math.round((state.retention ?? 0) * 100);
  return (
    <li className="flex items-center gap-3 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-base leading-snug font-semibold text-foreground">{state.topic.name}</p>
        <div className="mt-1.5 flex items-center gap-3">
          <span
            aria-hidden
            className="relative h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-foreground/10"
          >
            <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/70" style={{ width: `${pct}%` }} />
          </span>
          <span className="tnum text-sm text-muted-foreground">Likely recall today about {pct}%</span>
        </div>
      </div>
      <Link
        to={`/log?topic=${state.topic.id}&mode=revise`}
        className="shrink-0 text-sm font-medium text-brand-ink underline decoration-brand-line underline-offset-4"
      >
        Log a revise
      </Link>
    </li>
  );
}
