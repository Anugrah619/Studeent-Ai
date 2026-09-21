import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Signed, and always named against a period — a bare delta is a rumour. */
  delta?: { text: string; tone: "good" | "bad" | "neutral"; caption: string };
  caption?: ReactNode;
  hint?: string;
  trend?: ReactNode;
  loading?: boolean;
  className?: string;
}

/**
 * Stat tile. Proportional figures on the value — `tabular-nums` makes a number
 * like 121 look loose at display size; it is reserved for columns.
 */
export function StatTile({
  label,
  value,
  delta,
  caption,
  hint,
  trend,
  loading,
  className,
}: StatTileProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col justify-between rounded-xl border border-border bg-card p-4",
        className,
      )}
      title={hint}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {trend}
      </div>

      {loading ? (
        <Skeleton className="mt-3 h-8 w-20" />
      ) : (
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-[28px] leading-none font-semibold tracking-tight text-foreground">
            {value}
          </span>
          {delta ? (
            <span
              className={cn(
                "text-xs font-medium",
                delta.tone === "good"
                  ? "text-status-good"
                  : delta.tone === "bad"
                    ? "text-status-critical"
                    : "text-muted-foreground",
              )}
            >
              {delta.text}
            </span>
          ) : null}
        </div>
      )}

      {(caption || delta?.caption) && !loading ? (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
          {caption ?? delta?.caption}
        </p>
      ) : null}
    </div>
  );
}

/** Meter: fill carries severity, track is a lighter step of the same ramp. */
export function Meter({
  value,
  max = 1,
  color,
  label,
  className,
}: {
  value: number;
  max?: number;
  color: string;
  label: string;
  className?: string;
}) {
  const share = Math.max(0, Math.min(1, value / max));
  return (
    <div
      role="meter"
      aria-valuenow={Math.round(share * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn("h-1.5 w-full overflow-hidden rounded-full", className)}
      style={{ background: `color-mix(in oklab, ${color} 18%, transparent)` }}
    >
      <div
        className="h-full rounded-full"
        style={{ width: `${share * 100}%`, background: color }}
      />
    </div>
  );
}
