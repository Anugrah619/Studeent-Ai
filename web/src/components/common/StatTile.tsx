import type { ReactNode } from "react";
import { KpiCard } from "@/components/kit/KpiCard";
import { cn } from "@/lib/utils";

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
 * picks up the card look without a call site changing. The value arrives
 * pre-formatted, so it is shown as given rather than animated — a new screen
 * that has the raw number should use KpiCard directly and get the roll-in.
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
