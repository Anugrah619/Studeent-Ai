import { num } from "@/lib/format";

/**
 * `Flag.evidence` is typed as `{}` in the contract — an open bag with no shape
 * (see the report in src/api/gaps.ts). Until it is specified, render whatever
 * primitives come back and humanise the keys, rather than guessing at fields.
 */
export function EvidenceList({ evidence }: { evidence: unknown }) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return null;
  }

  const entries = Object.entries(evidence as Record<string, unknown>).filter(
    ([, value]) =>
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean",
  );

  if (!entries.length) return null;

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="flex items-baseline justify-between gap-2 border-b border-border/60 pb-1"
        >
          <dt className="text-[11px] text-muted-foreground">{humanise(key)}</dt>
          <dd className="tnum text-xs font-medium text-foreground">
            {typeof value === "number" ? num(value, value % 1 ? 2 : 0) : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function humanise(key: string): string {
  const label = key
    .replace(/_pct$/, " %")
    .replace(/_pts$/, " pts")
    .replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}
