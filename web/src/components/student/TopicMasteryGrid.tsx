import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Clock } from "lucide-react";
import type { TopicState } from "@/api/types";
import { Meter } from "@/components/common/StatTile";
import { EmptyState } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { daysAgo, num, pct } from "@/lib/format";
import { compareSubjects, resolveSubject, resolveSubjects } from "@/lib/subjects";
import { cn } from "@/lib/utils";

/**
 * Mastery is reported 0–1. Below this a chapter is treated as not yet learned.
 * The weak-topic detector's own floor (`detectors.py`, `MASTERY_FLOOR = 0.45`),
 * so a chapter a flag calls weak is never shown here as above the floor. It
 * was 0.35, which left a flagged chapter at 40% looking fine in this grid.
 */
const MASTERY_FLOOR = 0.45;
/**
 * A self-rating this far above measured mastery is a confidence mismatch —
 * but only from a student who rates the chapter 4/5 or more. Both are the
 * confidence-mismatch detector's (`GAP = 0.30`, `MIN_RATING = 4`): a 3/5 is a
 * student saying "about average", and the detector deliberately does not call
 * that overconfidence. The grid did, at 0.25 and any rating.
 */
const CONFIDENCE_GAP = 0.3;
const CONFIDENCE_MIN_RATING = 4;

function isMismatch(state: TopicState): boolean {
  return (
    (state.confidence_gap ?? 0) >= CONFIDENCE_GAP &&
    (state.self_rating ?? 0) >= CONFIDENCE_MIN_RATING
  );
}
const STALE_DAYS = 21;
/**
 * Rows per subject before "Show all". The grid is scanned for what is broken,
 * weakest first, so the first few rows are the answer and the rest is the
 * reference table behind it.
 */
const FOLDED_ROWS = 8;

type Filter = "all" | "weak" | "stale" | "mismatch";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All chapters" },
  { key: "weak", label: "Below floor" },
  { key: "stale", label: "Revision stale" },
  { key: "mismatch", label: "Confidence mismatch" },
];

export function TopicMasteryGrid({ states }: { states: TopicState[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState(false);

  /**
   * One column per subject of this student's syllabus — whatever the exam has
   * (three for JEE, four for NEET) — in the order the exam prints them. The
   * columns come from every chapter, not the filtered ones, so a filter empties
   * a column rather than removing it and reshuffling the grid.
   */
  const subjects = useMemo(
    () =>
      resolveSubjects(
        [...new Set(states.map((s) => s.topic.subject))].sort(compareSubjects),
      ),
    [states],
  );

  const grouped = useMemo(() => {
    const now = Date.now();
    const buckets = new Map<string, TopicState[]>(subjects.map((s) => [s.key, []]));

    for (const state of states) {
      if (!matches(state, filter, now)) continue;
      buckets.get(resolveSubject(state.topic.subject).key)?.push(state);
    }

    // Weakest first: this grid is scanned for what is broken, not admired.
    for (const rows of buckets.values()) {
      rows.sort((a, b) => (a.mastery ?? 1) - (b.mastery ?? 1));
    }
    return buckets;
  }, [states, filter, subjects]);

  const rowsOf = (key: string) => grouped.get(key) ?? [];
  const total = subjects.reduce((acc, s) => acc + rowsOf(s.key).length, 0);
  const folds = subjects.some((s) => rowsOf(s.key).length > FOLDED_ROWS);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          Measured mastery per chapter, weakest first. The bar restates the
          number beside it — nothing here is colour-only.
        </p>
        <div
          role="group"
          aria-label="Filter chapters"
          className="flex flex-wrap rounded-md border border-border bg-card p-0.5"
        >
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={filter === item.key}
              onClick={() => setFilter(item.key)}
              className={cn(
                "rounded-sm px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                filter === item.key
                  ? "bg-foreground text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {total === 0 ? (
        <EmptyState
          title="Nothing matches that filter"
          body="No chapter in this student's tree meets the condition."
        />
      ) : (
        <>
          <div
            className={cn(
              "grid gap-3",
              subjects.length >= 4
                ? "md:grid-cols-2 2xl:grid-cols-4"
                : subjects.length === 3
                  ? "lg:grid-cols-3"
                  : subjects.length === 2
                    ? "md:grid-cols-2"
                    : undefined,
            )}
          >
            {subjects.map((subject) => {
              const rows = rowsOf(subject.key);
              const shown = expanded ? rows : rows.slice(0, FOLDED_ROWS);
              const weak = rows.filter((r) => (r.mastery ?? 1) < MASTERY_FLOOR).length;
              return (
                <div
                  key={subject.key}
                  className="overflow-hidden rounded-xl bg-card shadow-card ring-1 ring-border"
                >
                  <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-xs"
                      style={{ background: subject.color }}
                    />
                    <h3 className="text-sm font-semibold">{subject.label}</h3>
                    <span className="tnum ml-auto flex gap-x-3 text-xs text-muted-foreground">
                      {weak > 0 ? <span>{weak} below floor</span> : null}
                      <span>
                        {shown.length < rows.length
                          ? `${shown.length} of ${rows.length} shown`
                          : `${rows.length} shown`}
                      </span>
                    </span>
                  </div>
                  <ul className="divide-y divide-border">
                    {shown.map((state) => (
                      <TopicRow key={state.id} state={state} color={subject.color} />
                    ))}
                    {rows.length === 0 ? (
                      <li className="px-5 py-6 text-center text-xs text-muted-foreground">
                        Nothing in {subject.label}
                      </li>
                    ) : null}
                  </ul>
                </div>
              );
            })}
          </div>

          {folds ? (
            <div className="flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={expanded}
                onClick={() => setExpanded((open) => !open)}
              >
                {expanded ? "Show the weakest only" : "Show every chapter"}
                <ChevronDown
                  aria-hidden
                  className={cn("transition-transform", expanded && "rotate-180")}
                />
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function TopicRow({ state, color }: { state: TopicState; color: string }) {
  // Null is below the evidence floor (fewer than four attempts — `features.py`
  // stores None rather than a confident 0.33 from three answers). It used to
  // render as "0%" in red with "Below floor": a wrong number, said loudly.
  const scored = state.mastery != null;
  const mastery = state.mastery ?? 0;
  const weak = scored && mastery < MASTERY_FLOOR;
  const mismatch = isMismatch(state);
  const stale =
    state.last_revised != null &&
    Date.now() - Date.parse(state.last_revised) > STALE_DAYS * 86_400_000;

  return (
    <li className="px-5 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {state.topic.name}
        </span>
        <span
          className={cn(
            "tnum text-sm font-semibold",
            weak ? "text-status-critical" : "text-foreground",
          )}
        >
          {scored ? pct(mastery * 100) : "—"}
        </span>
      </div>

      <Meter
        className="mt-2"
        value={mastery}
        color={weak ? "var(--status-critical)" : color}
        label={
          scored
            ? `${state.topic.name} mastery ${Math.round(mastery * 100)} percent`
            : `${state.topic.name}: not enough attempts to measure mastery yet`
        }
      />

      <div className="tnum mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {num(state.correct_n)}/{num(state.attempts_n)} correct
        </span>
        <span>{num(state.topic.weight, 1)}% of paper</span>
        {weak ? <span className="font-medium text-status-critical">Below floor</span> : null}
        {scored ? null : <span>Not enough attempts yet</span>}
        {stale ? (
          <span className="inline-flex items-center gap-1 text-status-warn">
            <Clock aria-hidden className="size-3" />
            Revised {daysAgo(state.last_revised)}
          </span>
        ) : null}
        {mismatch ? (
          <span className="inline-flex items-center gap-1 text-status-warn">
            <AlertTriangle aria-hidden className="size-3" />
            Rates it {num(state.self_rating)}/5
          </span>
        ) : null}
      </div>
    </li>
  );
}

function matches(state: TopicState, filter: Filter, now: number): boolean {
  switch (filter) {
    case "weak":
      return (state.mastery ?? 1) < MASTERY_FLOOR;
    case "stale":
      return (
        state.last_revised != null &&
        now - Date.parse(state.last_revised) > STALE_DAYS * 86_400_000
      );
    case "mismatch":
      return isMismatch(state);
    case "all":
    default:
      return true;
  }
}
