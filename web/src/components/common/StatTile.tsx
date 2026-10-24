import type { ComponentProps, ReactNode } from "react";
import { KpiCard } from "@/components/kit/KpiCard";
import { cn } from "@/lib/utils";

/**
 * A band of figures: one sheet, its cells divided by the rule showing through a
 * one-pixel gap.
 *
 * It replaces a grid of identical bordered cards. Six boxes of equal weight say
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
        "grid gap-px overflow-hidden rounded-xl border border-border bg-border shadow-card",
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
 * Stat tile: the original API over the kit's KpiCard, so every existing tile
 * picks up the look without a call site changing. It is one cell of a
 * `FigureBand`. The value arrives pre-formatted, so it is shown as given rather
 * than animated — a screen that has the raw number should use KpiCard directly.
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
    <KpiCard
      variant="cell"
      label={label}
      display={value}
      delta={
        delta
          ? { text: delta.text, tone: delta.tone, caption: delta.caption || undefined }
          : undefined
      }
      caption={caption}
      hint={hint}
      trend={trend}
      loading={loading}
      className={className}
    />
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
