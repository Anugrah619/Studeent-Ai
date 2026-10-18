import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Clock } from "lucide-react";
import type { TopicState } from "@/api/types";
import { Meter } from "@/components/common/StatTile";
import { EmptyState } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { daysAgo, num, pct } from "@/lib/format";
import { SUBJECT_LIST, resolveSubject, type SubjectKey } from "@/lib/subjects";
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

  const grouped = useMemo(() => {
    const now = Date.now();
    const buckets: Record<SubjectKey, TopicState[]> = {
      physics: [],
      chemistry: [],
      maths: [],
    };

    for (const state of states) {
      if (!matches(state, filter, now)) continue;
      const key = resolveSubject(state.topic.subject).key;
      buckets[key].push(state);
    }

    // Weakest first: this grid is scanned for what is broken, not admired.
    for (const key of Object.keys(buckets) as SubjectKey[]) {
      buckets[key].sort((a, b) => (a.mastery ?? 1) - (b.mastery ?? 1));
    }
    return buckets;
  }, [states, filter]);

  const total = SUBJECT_LIST.reduce((acc, s) => acc + grouped[s.key].length, 0);
  const folds = SUBJECT_LIST.some((s) => grouped[s.key].length > FOLDED_ROWS);

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
          className="flex flex-wrap gap-1 rounded-lg bg-muted p-0.75"
        >
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={filter === item.key}
              onClick={() => setFilter(item.key)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                filter === item.key
                  ? "bg-card text-foreground shadow-card"
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
          <div className="grid gap-3 lg:grid-cols-3">
            {SUBJECT_LIST.map((subject) => {
              const rows = grouped[subject.key];
              const shown = expanded ? rows : rows.slice(0, FOLDED_ROWS);
              const weak = rows.filter((r) => (r.mastery ?? 1) < MASTERY_FLOOR).length;
              return (
                <div
                  key={subject.key}
                  className="overflow-hidden rounded-xl bg-card shadow-card ring-1 ring-border"
                >
                  <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-xs"
                      style={{ background: subject.color }}
                    />
                    <h3 className="text-sm font-semibold">{subject.label}</h3>
                    <span className="tnum ml-auto text-xs text-muted-foreground">
                      {weak > 0 ? `${weak} below floor · ` : ""}
                      {shown.length < rows.length
                        ? `${shown.length} of ${rows.length} shown`
                        : `${rows.length} shown`}
                    </span>
                  </div>
                  <ul className="divide-y divide-border">
                    {shown.map((state) => (
                      <TopicRow key={state.id} state={state} color={subject.color} />
                    ))}
                    {rows.length === 0 ? (
                      <li className="px-4 py-6 text-center text-xs text-muted-foreground">
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
    <li className="px-4 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {state.topic.name}
        </span>
        <span
          className={cn(
            "tnum text-[13px] font-semibold",
            weak ? "text-status-critical" : "text-foreground",
          )}
        >
          {scored ? pct(mastery * 100) : "—"}
        </span>
      </div>

      <Meter
        className="mt-1.5"
        value={mastery}
        color={weak ? "var(--status-critical)" : color}
        label={
          scored
            ? `${state.topic.name} mastery ${Math.round(mastery * 100)} percent`
            : `${state.topic.name}: not enough attempts to measure mastery yet`
        }
      />

      <div className="tnum mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
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
