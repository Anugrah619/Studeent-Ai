import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CircleCheck,
  OctagonAlert,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hoverLift } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { AnimatedNumber, type NumberFormat } from "./AnimatedNumber";

export type KpiTone = "neutral" | "good" | "warn" | "critical";

/**
 * Signed, and always named against a period — a bare delta is a rumour.
 * `tone` is whether the movement is good news, which is not the same as its
 * direction: revision debt going down is good. `direction` only picks the
 * arrow, so the words and the arrow carry it and the colour is the third cue.
 */
export interface KpiDelta {
  text: string;
  tone: "good" | "bad" | "neutral";
  direction?: "up" | "down" | "flat";
  caption?: string;
}

export interface KpiCardProps {
  label: ReactNode;
  /** The figure, animated. Ignored when `display` is given. */
  value?: number | null;
  format?: NumberFormat;
  digits?: number;
  prefix?: string;
  suffix?: string;
  /** A pre-formatted figure, for values that are not one plain number. */
  display?: ReactNode;
  /** Small text set right after the figure — "of 298 active". */
  unit?: ReactNode;
  delta?: KpiDelta;
  caption?: ReactNode;
  /**
   * Status of the figure. Shown as a rail, an icon and — when given —
   * `toneLabel` in words. Uses the reserved status colours, so only for a
   * real judgement about the number, never for decoration.
   */
  tone?: KpiTone;
  toneLabel?: string;
  /** Top-right slot for a sparkline. */
  trend?: ReactNode;
  /** Top-right slot for a chip, e.g. a SeverityChip. */
  badge?: ReactNode;
  /** `hero` is the ONE figure a screen leads with: 48px and up. */
  size?: "default" | "hero";
  loading?: boolean;
  /** Native tooltip on the whole card. */
  hint?: string;
  /** Makes the whole card a link, with hover lift. */
  to?: string;
  footer?: ReactNode;
  className?: string;
}

const TONES: Record<
  Exclude<KpiTone, "neutral">,
  { icon: LucideIcon; text: string; rail: string; chip: string; name: string }
> = {
  good: {
    icon: CircleCheck,
    text: "text-status-good",
    rail: "bg-status-good",
    chip: "bg-status-good/10 text-status-good ring-status-good/25",
    name: "good",
  },
  warn: {
    icon: AlertTriangle,
    text: "text-status-warn",
    rail: "bg-status-warn",
    chip: "bg-status-warn/10 text-status-warn ring-status-warn/25",
    name: "needs attention",
  },
  critical: {
    icon: OctagonAlert,
    text: "text-status-critical",
    rail: "bg-status-critical",
    chip: "bg-status-critical/10 text-status-critical ring-status-critical/25",
    name: "critical",
  },
};

const DELTA_TEXT = {
  good: "text-status-good",
  bad: "text-status-critical",
  neutral: "text-muted-foreground",
} as const;

const DELTA_ICON = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  flat: ArrowRight,
} as const;

/**
 * The KPI card. Proportional figures on the value — `tabular-nums` makes a
 * number like 121 look loose at display size; it is reserved for columns.
 *
 * Figures line up across a row because every card puts the label first and
 * the figure directly under it, and pushes the caption to the bottom.
 */
export function KpiCard({
  label,
  value,
  format,
  digits,
  prefix,
  suffix,
  display,
  unit,
  delta,
  caption,
  tone = "neutral",
  toneLabel,
  trend,
  badge,
  size = "default",
  loading,
  hint,
  to,
  footer,
  className,
}: KpiCardProps) {
  const hero = size === "hero";
  const t = tone === "neutral" ? null : TONES[tone];
  const captionText = caption ?? delta?.caption;
  const DeltaIcon = delta?.direction ? DELTA_ICON[delta.direction] : null;

  const card = (
    <Card
      title={hint}
      className={cn(
        "relative h-full min-w-0 gap-0 py-0",
        to && "transition-shadow duration-200 group-hover/kpi:shadow-raised",
        className,
      )}
    >
      {t ? (
        <span
          aria-hidden
          className={cn("absolute inset-y-3 left-0 w-[3px] rounded-r-full", t.rail)}
        />
      ) : null}

      <div className={cn("flex flex-1 flex-col", hero ? "p-5" : "p-4")}>
        <div className="flex min-h-6 items-start justify-between gap-2">
          <span
            className={cn(
              "pt-0.5 font-medium text-muted-foreground",
              hero ? "text-sm" : "text-[13px] leading-snug",
            )}
          >
            {label}
          </span>
          {t || badge || trend ? (
            <div className="flex shrink-0 items-center gap-2">
              {t ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                    t.chip,
                  )}
                >
                  <t.icon aria-hidden className="size-3" />
                  {toneLabel ?? <span className="sr-only">{t.name}</span>}
                </span>
              ) : null}
              {badge}
              {trend}
            </div>
          ) : null}
        </div>

        {loading ? (
          <Skeleton className={cn("mt-3", hero ? "h-14 w-28" : "h-8 w-20")} />
        ) : (
          <div
            className={cn(
              "flex flex-wrap items-baseline gap-x-2 gap-y-1",
              hero ? "mt-3" : "mt-2",
            )}
          >
            <span
              className={cn(
                "leading-none font-semibold tracking-tight text-foreground",
                hero ? "text-5xl sm:text-6xl" : "text-[30px]",
              )}
            >
              {display !== undefined ? (
                display
              ) : (
                <AnimatedNumber
                  value={value}
                  format={format}
                  digits={digits}
                  prefix={prefix}
                  suffix={suffix}
                />
              )}
            </span>
            {unit ? (
              <span className={cn("text-muted-foreground", hero ? "text-base" : "text-sm")}>
                {unit}
              </span>
            ) : null}
            {delta ? (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 text-xs font-semibold",
                  DELTA_TEXT[delta.tone],
                )}
              >
                {DeltaIcon ? <DeltaIcon aria-hidden className="size-3.5" /> : null}
                {delta.text}
              </span>
            ) : null}
          </div>
        )}

        <div className="flex-1" />

        {captionText && !loading ? (
          <p
            className={cn(
              "leading-snug text-muted-foreground",
              hero ? "mt-3 text-sm" : "mt-2.5 text-xs",
            )}
          >
            {captionText}
          </p>
        ) : null}
      </div>

      {footer ? (
        <div className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </Card>
  );

  if (!to) return card;

  return (
    <motion.div {...hoverLift} className="h-full rounded-xl">
      <Link
        to={to}
        className="group/kpi block h-full rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {card}
      </Link>
    </motion.div>
  );
}
