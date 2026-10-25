import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import type { MyTopic, TopicState } from "@/api/types";
import { fieldErrors, statusOf, useMyTopicStates, useMyTopics, useRateConfidence } from "@/api/student";
import { Bubble } from "@/components/brand/Bubble";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { uniq } from "../lib";
import { Block, LoadingRows, ScreenHeader, Sheet, SubjectLabel, Trouble } from "../ui";

const SCALE: Record<number, string> = {
  1: "Not at all sure",
  2: "A little sure",
  3: "Fairly sure",
  4: "Quite sure",
  5: "Completely sure",
};

/**
 * How sure do you feel about each chapter, 1 to 5.
 *
 * The rating is set beside measured mastery to find chapters a student feels
 * better about than their answers show, so it has to be the student's honest
 * answer now — which is why mastery is never shown here, beside the question.
 * Weak chapters and chapters never rated are asked about first; every chapter
 * can be rated from the list below.
 *
 * The scale is drawn as a row of answer bubbles, the one round thing in the
 * product: a rating is a judgement about an option, and filling one in is the
 * gesture every exam-hall student already knows.
 */
export function Confidence() {
  const topics = useMyTopics();
  const states = useMyTopicStates();
  const rate = useRateConfidence();
  const [query, setQuery] = useState("");
  const [showAllFirst, setShowAllFirst] = useState(false);
  const [saved, setSaved] = useState<{ topic: string; rating: number } | null>(null);
  const [failed, setFailed] = useState<{ topicId: number; message: string } | null>(null);
  /** Ratings made on this visit, so the row shows the tap at once. */
  const [local, setLocal] = useState<Record<number, number>>({});

  const stateByTopic = useMemo(
    () => new Map((states.data ?? []).map((s) => [s.topic.id, s] as const)),
    [states.data],
  );

  const ratingOf = (id: number) => local[id] ?? stateByTopic.get(id)?.self_rating ?? null;

  const suggested = useMemo(() => {
    const rows = (topics.data ?? []).filter((t) => {
      const s = stateByTopic.get(t.id);
      const weak = s?.mastery !== null && s?.mastery !== undefined && s.mastery < 0.5;
      return s?.self_rating == null || weak;
    });
    // Weak and never rated, then never rated, then weak.
    const rank = (t: MyTopic) => {
      const s: TopicState | undefined = stateByTopic.get(t.id);
      const weak = s?.mastery != null && s.mastery < 0.5;
      const unrated = s?.self_rating == null;
      return weak && unrated ? 0 : unrated ? (s?.mastery == null ? 2 : 1) : 3;
    };
    return [...rows].sort((a, b) => rank(a) - rank(b));
  }, [topics.data, stateByTopic]);

  // Which chapters are asked about first is decided once, when the data
  // arrives — so rating one does not pull it out from under the finger.
  const [firstIds, setFirstIds] = useState<number[] | null>(null);
  useEffect(() => {
    if (firstIds === null && topics.data && states.data) setFirstIds(suggested.map((t) => t.id));
  }, [firstIds, topics.data, states.data, suggested]);
  const topicById = useMemo(
    () => new Map((topics.data ?? []).map((t) => [t.id, t] as const)),
    [topics.data],
  );
  const first = (firstIds ?? suggested.map((t) => t.id))
    .map((id) => topicById.get(id))
    .filter((t): t is MyTopic => t !== undefined);

  async function onRate(topic: MyTopic, rating: number) {
    setFailed(null);
    setSaved(null);
    setLocal((prev) => ({ ...prev, [topic.id]: rating }));
    try {
      await rate.mutateAsync({ topic: topic.id, self_rating: rating });
      setSaved({ topic: topic.name, rating });
    } catch (error) {
      setLocal((prev) => {
        const next = { ...prev };
        delete next[topic.id];
        return next;
      });
      const fields = Object.values(fieldErrors(error)).flat();
      setFailed({
        topicId: topic.id,
        message: fields.length
          ? fields.join(" ")
          : statusOf(error) === 429
            ? "You've rated a lot in the last hour. Try again in a little while."
            : "That rating didn't save. Check your connection, then try again.",
      });
    }
  }

  const loading = topics.isPending || states.isPending;
  const error = topics.error ?? states.error;
  const shownFirst = showAllFirst ? first : first.slice(0, 6);

  const needle = query.trim().toLowerCase();
  const all = (topics.data ?? []).filter((t) =>
    needle ? `${t.name} ${t.unit} ${t.subject}`.toLowerCase().includes(needle) : true,
  );

  const row = (topic: MyTopic) => (
    <RatingRow
      key={topic.id}
      topic={topic}
      rating={ratingOf(topic.id)}
      busy={rate.isPending && rate.variables?.topic === topic.id}
      problem={failed?.topicId === topic.id ? failed.message : null}
      onRate={(n) => void onRate(topic, n)}
    />
  );

  return (
    <>
      <ScreenHeader kicker="Confidence" title="How sure do you feel?">
        Rate each chapter from 1 to 5: 1 means not at all sure, 5 means completely sure. Your
        honest answer, set beside your scores, shows where practice will help most. Nobody marks
        this.
      </ScreenHeader>

      <p className="sr-only" aria-live="polite">
        {saved ? `Saved: ${saved.topic}, ${saved.rating} of 5.` : ""}
      </p>

      {loading ? (
        <LoadingRows rows={4} label="Loading your chapters" />
      ) : error ? (
        <Trouble
          error={error}
          what="your chapters"
          onRetry={() => {
            void topics.refetch();
            void states.refetch();
          }}
        />
      ) : (
        <>
          <Block
            title="Start with these"
            description="Chapters you haven't rated yet, and the ones your answers say are hardest for you."
            className="mt-2"
          >
            {first.length ? (
              <>
                <Sheet as="ul" className="divide-y divide-border">
                  {shownFirst.map(row)}
                </Sheet>
                {first.length > shownFirst.length ? (
                  <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAllFirst(true)}>
                    Show all {first.length}
                  </Button>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                You&rsquo;ve rated every chapter. Rate one again whenever how you feel about it
                changes.
              </p>
            )}
          </Block>

          <Block title="All chapters">
            <div className="relative mb-3">
              <label htmlFor="confidence-search" className="sr-only">
                Search chapters
              </label>
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="confidence-search"
                type="search"
                placeholder="Search chapters"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
                autoComplete="off"
              />
            </div>
            {all.length ? (
              <div className="space-y-3">
                {uniq(all.map((t) => t.subject)).map((subject) => {
                  const inSubject = all.filter((t) => t.subject === subject);
                  const rated = inSubject.filter((t) => ratingOf(t.id) !== null).length;
                  return (
                    <details key={subject} className="group" open={needle !== ""}>
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md px-1 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                        <span className="font-semibold text-foreground">
                          <SubjectLabel subject={subject} />
                        </span>
                        <span className="tnum text-muted-foreground">
                          {rated} of {inSubject.length} rated
                          <span aria-hidden className="ml-2 inline-block transition-transform group-open:rotate-90">
                            &rsaquo;
                          </span>
                        </span>
                      </summary>
                      <Sheet as="ul" className="mt-1 divide-y divide-border">
                        {inSubject.map(row)}
                      </Sheet>
                    </details>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No chapter matches &ldquo;{query}&rdquo;.</p>
            )}
          </Block>

          <p className="mt-8 text-sm text-muted-foreground">
            <Link to="/log" className="font-medium text-brand-ink underline decoration-brand-line underline-offset-4">
              Back to logging study
            </Link>
          </p>
        </>
      )}
    </>
  );
}

function RatingRow({
  topic,
  rating,
  busy,
  problem,
  onRate,
}: {
  topic: MyTopic;
  rating: number | null;
  busy: boolean;
  problem: string | null;
  onRate: (n: number) => void;
}) {
  return (
    <li className="px-4 py-3.5" data-topic-id={topic.id}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-sm leading-snug font-semibold text-foreground">{topic.name}</p>
          <p className="text-xs text-muted-foreground">
            {rating === null ? "Not rated yet" : `You said ${rating}: ${SCALE[rating].toLowerCase()}`}
          </p>
        </div>
        <div role="radiogroup" aria-label={`How sure are you about ${topic.name}?`} className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n}, ${SCALE[n].toLowerCase()}`}
              title={SCALE[n]}
              disabled={busy}
              onClick={() => onRate(n)}
              className={cn(
                "flex size-10 items-center justify-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
              )}
            >
              <Bubble letter={String(n)} filled={rating === n} className={cn(rating === n && "animate-bubble-fill")} />
            </button>
          ))}
        </div>
      </div>
      {problem ? (
        <p role="alert" className="mt-2 text-sm text-foreground">
          {problem}
        </p>
      ) : null}
    </li>
  );
}
