import { CircleDashed } from "lucide-react";
import type { Severity } from "@/api/types";
import { SEVERITY, riskBand } from "@/lib/severity";
import { cn } from "@/lib/utils";

/**
 * Severity is never colour alone. Every chip carries an icon and the word, so
 * it survives greyscale print, a projector with the contrast wound down, and a
 * director with deuteranopia.
 *
 * A chip is a small tab with square corners, not a pill: round is reserved for
 * answers, so a circle on screen always means an option.
 */
export function SeverityChip({
  severity,
  size = "sm",
  label,
  className,
}: {
  severity: Severity | "ok";
  size?: "sm" | "md";
  /** Override the token's word — e.g. a flag outcome rather than a severity. */
  label?: string;
  className?: string;
}) {
  const token = SEVERITY[severity];
  const Icon = token.icon;
  return (
    <span
      className={cn(
        // Inset ring, so a chip sits in a table row at exactly its text
        // height and never nudges the row taller than its neighbours.
        "inline-flex items-center gap-1.5 rounded-sm font-semibold tracking-tight whitespace-nowrap ring-inset",
        size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-sm",
        token.chip,
        className,
      )}
    >
      <Icon
        aria-hidden
        strokeWidth={2.25}
        className={size === "sm" ? "size-3.5" : "size-4"}
      />
      {label ?? token.label}
    </span>
  );
}

/**
 * The same chip driven by `risk_score`, which is on a **0–1** scale. The band
 * boundaries are the server's — see `RISK_BANDS` in `lib/severity.ts`.
 *
 * A null score is "not scored" (too little data — `features.py` stores None
 * rather than guess), and says so. It used to chip "On track", which is a
 * reassurance the system has no basis for.
 */
export function RiskChip({
  score,
  size = "sm",
  className,
}: {
  score: number | null | undefined;
  size?: "sm" | "md";
  className?: string;
}) {
  if (score == null) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-sm bg-muted font-semibold tracking-tight whitespace-nowrap text-muted-foreground ring-1 ring-border ring-inset",
          size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-sm",
          className,
        )}
      >
        <CircleDashed
          aria-hidden
          strokeWidth={2.25}
          className={size === "sm" ? "size-3.5" : "size-4"}
        />
        Not scored
      </span>
    );
  }
  return (
    <SeverityChip severity={riskBand(score).key} size={size} className={className} />
  );
}
