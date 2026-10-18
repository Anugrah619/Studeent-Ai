import { ChevronDown } from "lucide-react";
import { longDate, num, pct, signed } from "@/lib/format";

/**
 * `Flag.evidence` is typed as `{}` in the contract — an open bag with no shape
 * (see the report in src/api/gaps.ts). Live detectors put a dozen keys in it,
 * from the facts that raised the flag to bookkeeping such as `topic_id`,
 * `rule_version` and an ISO `last_seen`. Printed flat, a director reads a
 * database row and misses the one number that matters.
 *
 * So the keys we know are ranked: the first few that are present lead, with
 * plain labels and units. Everything else — unknown keys included — stays one
 * click away under "All recorded evidence", never dropped, because the point of
 * a flag is that its evidence can be checked.
 */
const LEAD_COUNT = 4;

type Format =
  | "int" | "dec" | "pct" | "spct" | "ratio" | "pts" | "signed" | "marks" | "days" | "min" | "rating";

/** In priority order — earlier keys lead when several are present. */
const KNOWN: [key: string, label: string, format: Format][] = [
  ["mastery_pct", "Mastery", "pct"],
  ["mastery", "Mastery", "ratio"],
  ["measured_mastery_pct", "Measured mastery", "pct"],
  ["self_rating", "Self-rating", "rating"],
  ["attempts", "Attempts", "int"],
  ["marks_lost", "Marks lost", "marks"],
  ["share_of_lost_marks_pct", "Share of all marks lost", "pct"],
  ["time_share_pct", "Share of study time", "pct"],
  ["marks_lost_share_pct", "Share of marks lost", "pct"],
  ["marks_trend", "Marks trend", "marks"],
  ["hours_change_pct", "Study hours change", "spct"],
  ["accuracy_change_pts", "Accuracy change", "pts"],
  ["days_since_last_log", "Days since last study log", "int"],
  ["attempt_rate_pct", "Questions attempted", "pct"],
  ["optimal_pct", "Best attempt rate", "pct"],
  ["overdue", "Revisions overdue", "int"],
  ["due_total", "Revisions due", "int"],
  ["overdue_share_pct", "Share overdue", "pct"],
  ["oldest_overdue_days", "Oldest overdue", "days"],
  ["mean_marks", "Average marks", "dec"],
  ["slope_marks_per_paper", "Change per mock", "signed"],
  ["papers", "Mocks", "int"],
  ["score_range_marks", "Score range", "marks"],
  ["minutes_per_logged_day", "Minutes per study day", "min"],
  ["logged_days_28d", "Days with study logged (28 d)", "int"],
  ["gap", "Confidence gap", "dec"],
  ["floor", "Mastery floor", "ratio"],
  ["slope_per_mock", "Mastery change per mock", "dec"],
  ["correct", "Correct", "int"],
];
const KNOWN_INDEX = new Map(KNOWN.map(([key], index) => [key, index]));

type Entry = { key: string; label: string; value: string };

export function EvidenceList({ evidence }: { evidence: unknown }) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return null;
  }

  const primitives = Object.entries(evidence as Record<string, unknown>).filter(
    (pair): pair is [string, string | number | boolean] =>
      typeof pair[1] === "string" ||
      typeof pair[1] === "number" ||
      typeof pair[1] === "boolean",
  );
  if (!primitives.length) return null;

  const lead: Entry[] = primitives
    .filter(([key]) => KNOWN_INDEX.has(key))
    .sort(([a], [b]) => KNOWN_INDEX.get(a)! - KNOWN_INDEX.get(b)!)
    .slice(0, LEAD_COUNT)
    .map(([key, value]) => {
      const [, label, format] = KNOWN[KNOWN_INDEX.get(key)!];
      return { key, label, value: formatValue(value, format) };
    });
  const leadKeys = new Set(lead.map((entry) => entry.key));
  const rest: Entry[] = primitives
    .filter(([key]) => !leadKeys.has(key))
    .map(([key, value]) => ({
      key,
      label: KNOWN_INDEX.has(key) ? KNOWN[KNOWN_INDEX.get(key)!][1] : humanise(key),
      value: KNOWN_INDEX.has(key)
        ? formatValue(value, KNOWN[KNOWN_INDEX.get(key)!][2])
        : plain(value),
    }));

  // A bag with no key we recognise still has to show something up front.
  const shown = lead.length ? lead : rest.slice(0, LEAD_COUNT);
  const folded = lead.length ? rest : rest.slice(LEAD_COUNT);

  return (
    <div className="space-y-2">
      <Pairs entries={shown} emphasis />
      {folded.length ? (
        <details className="group">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
            All recorded evidence ({primitives.length})
            <ChevronDown
              aria-hidden
              className="size-3 transition-transform group-open:rotate-180"
            />
          </summary>
          <div className="mt-2">
            <Pairs entries={folded} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function Pairs({ entries, emphasis = false }: { entries: Entry[]; emphasis?: boolean }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
      {entries.map(({ key, label, value }) => (
        <div
          key={key}
          className="flex items-baseline justify-between gap-2 border-b border-border/60 pb-1"
        >
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd
            className={
              emphasis
                ? "tnum text-right text-sm font-semibold text-foreground"
                : "tnum text-right text-xs font-medium text-foreground"
            }
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function formatValue(value: string | number | boolean, format: Format): string {
  if (typeof value !== "number") return plain(value);
  switch (format) {
    case "int":
      return num(value);
    case "dec":
      return num(value, value % 1 ? 2 : 0);
    case "pct":
      return pct(value, value % 1 ? 1 : 0);
    case "spct":
      return `${signed(value)}%`;
    case "ratio":
      return pct(value * 100);
    case "pts":
      return `${signed(value)} pts`;
    case "signed":
      return signed(value, value % 1 ? 2 : 0);
    case "marks":
      return `${num(value, value % 1 ? 1 : 0)} marks`;
    case "days":
      return `${num(value)} days`;
    case "min":
      return `${num(value)} min`;
    case "rating":
      return `${num(value)} / 5`;
  }
}

/** ISO timestamps read as dates; everything else prints as it came. */
function plain(value: string | number | boolean): string {
  if (typeof value === "number") return num(value, value % 1 ? 2 : 0);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return longDate(value);
  }
  return String(value);
}

function humanise(key: string): string {
  const label = key
    .replace(/_pct$/, " %")
    .replace(/_pts$/, " pts")
    .replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}
