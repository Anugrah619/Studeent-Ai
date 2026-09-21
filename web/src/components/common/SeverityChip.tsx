import type { Severity } from "@/api/types";
import { SEVERITY, riskBand } from "@/lib/severity";
import { cn } from "@/lib/utils";

/**
 * Severity is never colour alone. Every chip carries an icon and the word, so
 * it survives greyscale print, a projector with the contrast wound down, and a
 * director with deuteranopia.
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
        "inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        token.chip,
        className,
      )}
    >
      <Icon aria-hidden className={size === "sm" ? "size-3" : "size-3.5"} />
      {label ?? token.label}
    </span>
  );
}

/**
 * The same chip driven by `risk_score`. The band boundaries are a UI decision —
 * the contract documents no scale (see API_GAPS.RISK_SCORE_BANDS).
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
  return (
    <SeverityChip severity={riskBand(score).key} size={size} className={className} />
  );
}
