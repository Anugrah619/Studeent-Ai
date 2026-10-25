import { History } from "lucide-react";
import { useFlagInterventions } from "@/api/staff";
import { Skeleton } from "@/components/ui/skeleton";
import { longDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * What was done about one flag — the middle of "flag, act, outcome".
 *
 * Until `GET /api/flags/{id}/interventions/` existed an intervention was
 * write-only: a mentor could log one and nothing could show it back. Newest
 * first, as the route returns them.
 *
 * `line` is one sentence for a dense list (the closed-loop panel); `list` is
 * every entry, for a flag's own card.
 */
export function FlagInterventions({
  flagId,
  variant = "list",
  className,
}: {
  flagId: number;
  variant?: "list" | "line";
  className?: string;
}) {
  const query = useFlagInterventions(flagId);

  if (query.isPending) {
    return <Skeleton aria-hidden className={cn("h-4 w-48", className)} />;
  }
  if (query.error) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        What was done could not be loaded.
      </p>
    );
  }

  const rows = query.data ?? [];

  if (variant === "line") {
    const latest = rows[0];
    return (
      <p
        data-flag-interventions={flagId}
        className={cn("flex items-start gap-1.5 text-xs text-muted-foreground", className)}
      >
        <History aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        {latest ? (
          <span>
            <span className="font-medium text-foreground">{latest.action}</span>
            {", "}
            {latest.mentor_name}, {longDate(latest.taken_at)}
            {rows.length > 1 ? ` (and ${rows.length - 1} earlier)` : null}
          </span>
        ) : (
          <span>Nothing was logged against it.</span>
        )}
      </p>
    );
  }

  return (
    <div data-flag-interventions={flagId} className={className}>
      <h4 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <History aria-hidden className="size-3.5" />
        What was done about it
      </h4>
      {rows.length ? (
        <ol className="mt-1.5 space-y-1">
          {rows.map((row) => (
            <li key={row.id} className="text-sm leading-snug">
              <span className="text-foreground">{row.action}</span>
              <span className="text-xs text-muted-foreground">
                {" "}
                {row.mentor_name}, {longDate(row.taken_at)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">Nothing logged yet.</p>
      )}
    </div>
  );
}
