import { useMemo, useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import type { TopicState } from "@/api/types";
import { Meter } from "@/components/common/StatTile";
import { EmptyState } from "@/components/common/States";
import { daysAgo, num, pct } from "@/lib/format";
import { SUBJECT_LIST, resolveSubject, type SubjectKey } from "@/lib/subjects";
import { cn } from "@/lib/utils";

/** Mastery is reported 0–1. Below this a chapter is treated as not yet learned. */
const MASTERY_FLOOR = 0.35;
/** A self-rating this far above measured mastery is a confidence mismatch. */
const CONFIDENCE_GAP = 0.25;
const STALE_DAYS = 21;

type Filter = "all" | "weak" | "stale" | "mismatch";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All chapters" },
  { key: "weak", label: "Below floor" },
  { key: "stale", label: "Revision stale" },
  { key: "mismatch", label: "Confidence mismatch" },
];

export function TopicMasteryGrid({ states }: { states: TopicState[] }) {
  const [filter, setFilter] = useState<Filter>("all");

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

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Topic mastery</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Measured mastery per chapter, weakest first. The bar restates the
            number beside it — nothing here is colour-only.
          </p>
        </div>
        <div role="group" aria-label="Filter chapters" className="flex flex-wrap gap-1.5">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={filter === item.key}
              onClick={() => setFilter(item.key)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                filter === item.key
                  ? "border-transparent bg-secondary text-secondary-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
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
        <div className="grid gap-3 lg:grid-cols-3">
          {SUBJECT_LIST.map((subject) => {
            const rows = grouped[subject.key];
            const weak = rows.filter((r) => (r.mastery ?? 1) < MASTERY_FLOOR).length;
            return (
              <div
                key={subject.key}
                className="rounded-xl border border-border bg-card"
              >
                <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-[2px]"
                    style={{ background: subject.color }}
                  />
                  <h3 className="text-sm font-semibold">{subject.label}</h3>
                  <span className="tnum ml-auto text-[11px] text-muted-foreground">
                    {weak > 0 ? `${weak} below floor · ` : ""}
                    {rows.length} shown
                  </span>
                </div>
                <ul className="divide-y divide-border">
                  {rows.map((state) => (
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
      )}
    </section>
  );
}

function TopicRow({ state, color }: { state: TopicState; color: string }) {
  const mastery = state.mastery ?? 0;
  const weak = mastery < MASTERY_FLOOR;
  const mismatch = (state.confidence_gap ?? 0) >= CONFIDENCE_GAP;
  const stale =
    state.last_revised != null &&
    Date.now() - Date.parse(state.last_revised) > STALE_DAYS * 86_400_000;

  return (
    <li className="px-4 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {state.topic.name}
        </span>
        <span
          className={cn(
            "tnum text-xs font-semibold",
            weak ? "text-status-critical" : "text-foreground",
          )}
        >
          {pct(mastery * 100)}
        </span>
      </div>

      <Meter
        className="mt-1.5"
        value={mastery}
        color={weak ? "var(--status-critical)" : color}
        label={`${state.topic.name} mastery ${Math.round(mastery * 100)} percent`}
      />

      <div className="tnum mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span>
          {num(state.correct_n)}/{num(state.attempts_n)} correct
        </span>
        <span>{num(state.topic.weight, 1)}% of paper</span>
        {stale ? (
          <span className="inline-flex items-center gap-1 text-status-warn">
            <Clock aria-hidden className="size-2.5" />
            Revised {daysAgo(state.last_revised)}
          </span>
        ) : null}
        {mismatch ? (
          <span className="inline-flex items-center gap-1 text-status-warn">
            <AlertTriangle aria-hidden className="size-2.5" />
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
      return (state.confidence_gap ?? 0) >= CONFIDENCE_GAP;
    case "all":
    default:
      return true;
  }
}
