import { useEffect, useRef, useState } from "react";
import NumberFlow from "@number-flow/react";
import { useInView, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export type NumberFormat = "int" | "decimal" | "percent" | "signed";

export interface AnimatedNumberProps {
  /** null, undefined or NaN render an em dash — "no figure", never a zero. */
  value: number | null | undefined;
  /**
   * - `int` — 1,23,456 (en-IN grouping, like `num()`).
   * - `decimal` — fixed fraction digits, 1 by default.
   * - `percent` — the value is ALREADY 0–100, like `pct()`; this appends "%"
   *   and never multiplies. A 0–1 share must be scaled by the caller, on
   *   purpose, where the reader of the code can see it.
   * - `signed` — "+12" / "−37" / "0", with a true minus sign, like `signed()`.
   */
  format?: NumberFormat;
  /** Fraction digits. Defaults: 0, except `decimal` which defaults to 1. */
  digits?: number;
  prefix?: string;
  suffix?: string;
  /** Count up from zero when first scrolled into view. On by default. */
  animateOnMount?: boolean;
  className?: string;
}

const LOCALE = "en-IN";
const MINUS = "−";

/**
 * The exact string the static formatters in `lib/format.ts` would print. The
 * screen-reader text and the no-animation fallback both use it, so a number
 * reads the same whether or not it is animated.
 */
export function formatNumber(
  value: number,
  format: NumberFormat = "int",
  digits?: number,
): string {
  const d = digits ?? (format === "decimal" ? 1 : 0);
  const opts = { minimumFractionDigits: d, maximumFractionDigits: d };
  if (format === "signed") {
    const body = Math.abs(value).toLocaleString(LOCALE, opts);
    if (value === 0) return body;
    return `${value > 0 ? "+" : MINUS}${body}`;
  }
  const body = value.toLocaleString(LOCALE, opts);
  return format === "percent" ? `${body}%` : body;
}

/**
 * NumberFlow is a custom element that only registers itself in a real
 * browser. Outside one — the jsdom test run — it would print a fallback copy
 * of the digits into the light DOM beside our own text, and every number would
 * read twice. So it is used only when it is actually there.
 */
function numberFlowAvailable(): boolean {
  return (
    typeof customElements !== "undefined" &&
    customElements.get("number-flow-react") !== undefined
  );
}

/**
 * How long a figure waits for the viewport before it shows its value anyway.
 * An observer that never reports — no IntersectionObserver, a print, a capture
 * tool that never scrolls — must not leave a real figure reading 0.
 */
const START_FALLBACK_MS = 2000;

/**
 * A figure that rolls to its value on first view and on every change.
 *
 * The visible digits are aria-hidden and a plain-text copy carries the value
 * for assistive tech and for `textContent`, so it is never announced as an
 * image of a number, or announced mid-roll.
 *
 * Until it starts, the rolled digits read 0 — a wrong number, not a blank — so
 * starting never depends on the observer alone: reduced motion starts it at
 * once (no count-up), and `START_FALLBACK_MS` starts it if the viewport never
 * reports. Every branch keeps the same root `<span>` holding the ref, so the
 * element `useInView` observes is the one on screen.
 */
export function AnimatedNumber({
  value,
  format = "int",
  digits,
  prefix = "",
  suffix = "",
  animateOnMount = true,
  className,
}: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const reduceMotion = useReducedMotion();
  const [flow] = useState(numberFlowAvailable);
  const missing = value == null || Number.isNaN(value);
  const [started, setStarted] = useState(!animateOnMount);
  const live = started || reduceMotion === true;

  useEffect(() => {
    if (inView) setStarted(true);
  }, [inView]);

  useEffect(() => {
    if (live || missing) return;
    if (typeof IntersectionObserver === "undefined") {
      setStarted(true);
      return;
    }
    const timer = window.setTimeout(() => setStarted(true), START_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [live, missing]);

  const text = missing ? "—" : `${prefix}${formatNumber(value, format, digits)}${suffix}`;

  if (missing || !flow) {
    return (
      <span ref={ref} className={className}>
        {text}
      </span>
    );
  }

  const d = digits ?? (format === "decimal" ? 1 : 0);
  const shown = live ? value : 0;
  const signedFormat = format === "signed";
  const sign = signedFormat && shown !== 0 ? (shown > 0 ? "+" : MINUS) : "";

  return (
    <span ref={ref} className={cn("inline-flex items-baseline", className)}>
      <span className="sr-only">{text}</span>
      <NumberFlow
        aria-hidden="true"
        value={signedFormat ? Math.abs(shown) : shown}
        locales={LOCALE}
        format={{ minimumFractionDigits: d, maximumFractionDigits: d }}
        prefix={`${prefix}${sign}`}
        suffix={`${format === "percent" ? "%" : ""}${suffix}`}
        // A count-up of 0→312 should land, not crawl: a touch under a second.
        transformTiming={{ duration: 750, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}
        spinTiming={{ duration: 750, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}
      />
    </span>
  );
}
