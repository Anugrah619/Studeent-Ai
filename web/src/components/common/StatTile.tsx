import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * A band of figures: one sheet, its cells divided by the rule showing through a
 * one-pixel gap.
 *
 * It replaces a grid of identical bordered tiles. Six boxes of equal weight say
 * "six things to look at"; one band says "here is the week" and lets a single
 * figure lead. Painting the container in the rule colour and the cells in the
 * sheet colour means the dividers follow the layout at every breakpoint — no
 * per-cell border logic, and no stray rule when a row wraps.
 *
 * Callers must give it a cell count that fills every row at each breakpoint
 * they choose, or the empty remainder shows the rule colour as a grey block.
 */
export function FigureBand({
  children,
  className,
  ...rest
}: ComponentProps<"div">) {
  return (
    <div
      {...rest}
      className={cn(
        "grid gap-px overflow-hidden rounded-xl border border-border bg-border shadow-xs",
        className,
      )}
    >
      {children}
    </div>
  );
}

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
 * One cell of a `FigureBand`. Proportional figures on the value — `tabular-nums`
 * makes a number like 121 look loose at display size; it is reserved for
 * columns.
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
      className={cn("flex min-w-0 flex-col justify-between bg-card px-5 py-4", className)}
      title={hint}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {trend}
      </div>

      {loading ? (
        <Skeleton className="mt-3 h-9 w-24" />
      ) : (
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-3xl leading-none font-semibold tracking-tight text-foreground">
            {value}
          </span>
          {delta ? (
            <span
              className={cn(
                "text-sm font-medium",
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
        <p className="mt-2 text-xs leading-snug text-muted-foreground">
          {caption ?? delta?.caption}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Meter: fill carries severity, track is a lighter step of the same ramp. Square
 * ended — a bar is a measurement, and round is reserved for answers.
 */
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
      className={cn("h-2 w-full overflow-hidden rounded-[2px]", className)}
      style={{ background: `color-mix(in oklab, ${color} 18%, transparent)` }}
    >
      <div
        className="h-full rounded-[2px]"
        style={{ width: `${share * 100}%`, background: color }}
      />
    </div>
  );
}
