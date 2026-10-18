import { motion, useReducedMotion } from "motion/react";
import { EASE_OUT_SOFT } from "@/lib/motion";

interface Props {
  values: number[];
  width?: number;
  height?: number;
  /** Accent for the current point; the line itself stays de-emphasised. */
  accent?: string;
  label: string;
}

/**
 * A shape, not a chart. It has no axis, so every value it hints at is printed elsewhere.
 *
 * It draws itself once, left to right, and only then shows the current point —
 * so the eye lands where the series ends, which is the only point the tile
 * names. Stays hand-built SVG: at 72×22 there is nothing for a chart library
 * to add, and no tooltip, because the figure beside it is the value.
 */
export function Sparkline({
  values,
  width = 72,
  height = 22,
  accent = "var(--foreground)",
  label,
}: Props) {
  const reduce = useReducedMotion() ?? false;
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const x = (i: number) => (i / (values.length - 1)) * (width - pad * 2) + pad;
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);

  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={label}
      className="overflow-visible"
    >
      <motion.path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        className="text-muted-foreground/60"
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.6, ease: EASE_OUT_SOFT, delay: 0.15 }}
      />
      <motion.circle
        cx={x(values.length - 1)}
        cy={y(values[values.length - 1])}
        r={2.5}
        fill={accent}
        stroke="var(--chart-surface)"
        strokeWidth={1.5}
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, delay: 0.7 }}
      />
    </svg>
  );
}
