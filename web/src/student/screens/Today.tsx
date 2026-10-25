import { Link } from "react-router-dom";
import type { PlanBlock } from "@/api/types";
import {
  statusOf,
  detailOf,
  fieldErrors,
  useExplainPlan,
  useGeneratePlan,
  useMyGuidance,
  useMyOnboarding,
  useMyPlan,
  useMyProfile,
  usePlanNote,
  useTickBlock,
} from "@/api/student";
import { Bubble } from "@/components/brand/Bubble";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  firstName,
  greeting,
  minutesSpoken,
  minutesText,
  modeLabel,
  todayLine,
} from "../lib";
import {
  ActionCard,
  Block,
  FormNotice,
  LoadingRows,
  Pending,
  ScreenHeader,
  Sheet,
  SubjectLabel,
  Trouble,
} from "../ui";

/**
 * Today — the screen a student opens every morning.
 *
 * The day's plan is drawn as an answer sheet: one row per block, numbered in
 * the order to do them, and a bubble to fill in when it is done. It is the one
 * bold idea in the app, and it is the product's own glyph — the four-bubble
 * mark, a question with the chosen option filled — turned into "today, with
 * what you did filled in". Every row says why it is there, in the serif,
 * because a plan a student cannot argue with is a plan they stop following.
 */
export function Today() {
  const profile = useMyProfile();
  const plan = useMyPlan();
  const name = profile.data ? firstName(profile.data.name) : "";

  const blocks = plan.data ?? [];
  const done = blocks.filter((b) => b.completed);
  const allDone = blocks.length > 0 && done.length === blocks.length;

  return (
    <>
      <ScreenHeader kicker={todayLine()} title={`${greeting()}${name ? `, ${name}` : ""}.`}>
        {allDone
          ? "That's everything on today's plan done. Well kept."
          : blocks.length
            ? "Here is today, in the order to do it."
            : null}
      </ScreenHeader>

      {plan.isPending ? (
        <LoadingRows rows={3} label="Loading today's plan" />
      ) : plan.error ? (
        <Trouble error={plan.error} what="today's plan" onRetry={() => void plan.refetch()} />
      ) : blocks.length ? (
        <PlanSheet blocks={blocks} />
      ) : (
        <NoPlanYet />
      )}

      <NextForYou />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The plan, when there is one
 * ------------------------------------------------------------------ */

function PlanSheet({ blocks }: { blocks: PlanBlock[] }) {
  const note = usePlanNote();
  const tick = useTickBlock();
  const total = blocks.reduce((a, b) => a + b.minutes, 0);
  const doneBlocks = blocks.filter((b) => b.completed);
  const doneMinutes = doneBlocks.reduce((a, b) => a + b.minutes, 0);

  return (
    <section aria-labelledby="plan-heading">
      {note ? (
        <p className="mb-5 border-l-2 border-brand-line pl-4 font-serif text-base leading-relaxed text-foreground">
          {note}
        </p>
      ) : null}

      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <h2 id="plan-heading" className="text-lg font-semibold tracking-tight">
          Today&rsquo;s plan
        </h2>
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex gap-1">
            {blocks.map((b) => (
              <Bubble key={b.id} size="xs" filled={!!b.completed} />
            ))}
          </span>
          <p className="tnum text-sm text-muted-foreground" aria-live="polite" data-testid="day-progress">
            {doneBlocks.length} of {blocks.length} done, {minutesText(doneMinutes)} of {minutesText(total)}
          </p>
        </div>
      </div>

      <Sheet as="ol" className="divide-y divide-border">
        {blocks.map((block, i) => (
          <PlanRow
            key={block.id}
            block={block}
            n={i + 1}
            busy={tick.isPending && tick.variables?.id === block.id}
            onToggle={() => tick.mutate({ id: block.id, done: !block.completed })}
          />
        ))}
      </Sheet>

      {tick.error ? (
        <div className="mt-3">
          <FormNotice tone="problem">
            {statusOf(tick.error) === 404
              ? "That block isn't on your plan any more. Reload the page to see the plan as it is now."
              : "That tick didn't save, so it's been put back. Check your connection and try again."}
          </FormNotice>
        </div>
      ) : null}

      <ExplainPlan />
    </section>
  );
}

function PlanRow({
  block,
  n,
  busy,
  onToggle,
}: {
  block: PlanBlock;
  n: number;
  busy: boolean;
  onToggle: () => void;
}) {
  const done = !!block.completed;
  return (
    <li className="flex gap-3.5 px-3 py-4 sm:gap-4 sm:px-4" data-block-id={block.id}>
      {/* The bubble is the control: a 44px target around a 28px circle. It is
          never disabled while saving: a second tap is queued behind the first
          (`useTickBlock`), so a quick tick-and-untick is never swallowed. */}
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={`${done ? "Done" : "Not done yet"}: ${modeLabel(block.mode)} ${block.topic_name}`}
        aria-busy={busy || undefined}
        onClick={onToggle}
        className="-m-2 flex size-11 shrink-0 items-start justify-center rounded-md pt-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Bubble
          letter={String(n)}
          filled={done}
          className={cn(done && "animate-bubble-fill")}
        />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3 text-sm text-muted-foreground">
          <span className="font-medium">{modeLabel(block.mode)}</span>
          <span className="tnum shrink-0" aria-label={minutesSpoken(block.minutes)}>
            {minutesText(block.minutes)}
          </span>
        </div>
        <p
          className={cn(
            "mt-0.5 text-base leading-snug font-semibold",
            done ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {block.topic_name}
        </p>
        <SubjectLabel subject={block.subject} className="mt-0.5 text-sm text-muted-foreground" />
        {block.reason_text ? (
          <p className="mt-2 max-w-[56ch] font-serif text-[0.97rem] leading-relaxed text-foreground/85">
            <span className="sr-only">Why: </span>
            {block.reason_text}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * "Why this plan?" — two or three sentences on the whole day. The server
 * always answers; when the guide is offline it answers with a fixed summary
 * from the blocks' own reasons, which is shown the same way and simply said to
 * be that. It is not an error, so it never looks like one.
 */
function ExplainPlan() {
  const explain = useExplainPlan();
  const result = explain.data;

  return (
    <div className="mt-4">
      {!result ? (
        <Button variant="outline" onClick={() => explain.mutate()} disabled={explain.isPending}>
          {explain.isPending ? <Pending>Reading your plan…</Pending> : "Why this plan?"}
        </Button>
      ) : null}

      <div aria-live="polite">
        {result ? (
          <figure className="mt-1 rounded-xl bg-muted/50 px-4 py-4">
            <figcaption className="text-sm font-semibold text-foreground">Why this plan</figcaption>
            <p className="mt-1.5 max-w-[60ch] font-serif text-base leading-relaxed text-foreground">
              {result.summary}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {result.available
                ? "Written by the guide from the reasons on each block."
                : "A short summary put together from the reasons on each block."}
            </p>
          </figure>
        ) : explain.error ? (
          <p className="mt-2 text-sm text-muted-foreground" role="status">
            The explanation didn&rsquo;t load. The reason on each block above says the same
            thing, one block at a time.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * No plan yet
 * ------------------------------------------------------------------ */

function NoPlanYet() {
  const generate = useGeneratePlan();
  const onboarding = useMyOnboarding();
  const minutes = onboarding.data?.daily_minutes;
  const nothingToPlan = generate.isSuccess && generate.data.blocks.length === 0;

  return (
    <Sheet className="px-4 py-5 sm:px-5">
      <h2 className="font-serif text-xl font-semibold tracking-tight">
        {nothingToPlan ? "There's nothing to plan yet." : "Nothing planned for today yet."}
      </h2>
      <p className="mt-1.5 max-w-[56ch] text-sm leading-relaxed text-muted-foreground">
        {nothingToPlan ? (
          <>
            Once you&rsquo;ve logged some study or sat a mock, your plan has something to work
            with. <Link to="/log" className="font-medium text-brand-ink underline decoration-brand-line underline-offset-4">Log a session</Link> to start.
          </>
        ) : (
          <>
            Your plan puts your due revisions and weakest chapters in order, and fits them to{" "}
            {minutes ? `the ${minutesText(minutes)} a day you said you have` : "the time you usually study"}.
          </>
        )}
      </p>

      {!nothingToPlan ? (
        <Button size="lg" className="mt-4" onClick={() => generate.mutate()} disabled={generate.isPending}>
          {generate.isPending ? <Pending>Making your plan…</Pending> : "Make today's plan"}
        </Button>
      ) : null}

      <div aria-live="polite" className="mt-3 empty:hidden">
        {generate.error ? <GenerateRefusal error={generate.error} /> : null}
      </div>
    </Sheet>
  );
}

function GenerateRefusal({ error }: { error: Error }) {
  const status = statusOf(error);
  const fields = fieldErrors(error);
  const message =
    status === 429
      ? "You've made several plans in the last hour. Try again a little later; anything already on your plan still stands."
      : status === 400
        ? (Object.values(fields).flat()[0] ?? detailOf(error) ?? "That day can't be planned.")
        : "Your plan couldn't be made just now. Check your connection, then try again.";
  return <FormNotice tone="problem">{message}</FormNotice>;
}

/* ------------------------------------------------------------------ *
 * Next for you
 * ------------------------------------------------------------------ */

/**
 * The guide's next actions, minus the ones about today's plan — the plan is
 * right above. A strip that scrolls sideways on a phone, so it never pushes
 * the plan down; nothing at all when there is nothing to suggest.
 */
function NextForYou() {
  const guidance = useMyGuidance();
  const actions = (guidance.data?.next_actions ?? []).filter(
    (a) => a.kind !== "start_plan" && a.kind !== "make_plan",
  );
  if (guidance.isPending || guidance.error || !actions.length) return null;

  return (
    <Block
      title="Next for you"
      actions={
        <Link
          to="/guide"
          className="text-sm font-medium text-brand-ink underline decoration-brand-line underline-offset-4"
        >
          All of it
        </Link>
      }
    >
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
        {actions.map((action) => (
          <li key={action.kind} className="w-64 shrink-0 snap-start sm:w-72">
            <ActionCard action={action} />
          </li>
        ))}
      </ul>
    </Block>
  );
}
