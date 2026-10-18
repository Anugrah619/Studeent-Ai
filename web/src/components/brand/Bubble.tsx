import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export type BubbleSize = "xs" | "sm" | "md" | "lg";

const SIZE: Record<BubbleSize, string> = {
  /** A step on a confidence rating. */
  xs: "size-3.5 border-[1.25px]",
  /** Beside a question label: "D16 chose (C)". */
  sm: "size-5 border-[1.5px] text-xs",
  /** The letter of an option on a question. */
  md: "size-7 border-[1.5px] text-sm",
  /** A row being filled in while a reading is under way. */
  lg: "size-9 border-2 text-base",
};

/**
 * The answer bubble — the OMR circle every exam-hall student has filled in.
 *
 * It is the one round thing in this interface. Corners everywhere else are
 * tight, so a circle on screen always means "an option, or a judgement about
 * one": the letter on a question's option, the option a student picked beside a
 * citation, the steps of a confidence rating, the marking-in-progress state.
 *
 * Two independent facts can be true of an option, and they are drawn by two
 * independent means — never by hue:
 *
 *   filled  the student picked it: the pencil mark
 *   ringed  it is the correct answer: circled the way a teacher circles it
 *
 * A student who chose the right option gets both. It is `aria-hidden` on
 * purpose: a bubble restates something the surrounding text already says in
 * words ("chose C", "Correct answer"), and is never the only place it lives.
 */
export function Bubble({
  letter,
  filled = false,
  ringed = false,
  size = "md",
  className,
  style,
}: {
  letter?: string;
  filled?: boolean;
  ringed?: boolean;
  size?: BubbleSize;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      data-filled={filled || undefined}
      data-ringed={ringed || undefined}
      style={style}
      className={cn(
        "tnum inline-grid shrink-0 place-items-center rounded-full border-current leading-none font-semibold select-none",
        SIZE[size],
        filled
          ? "border-foreground bg-foreground text-primary-foreground"
          : "text-muted-foreground",
        // The gap is painted in the surface the bubble sits on, so a dialog
        // (which is `--popover`, not `--card`) can say so with one variable.
        ringed &&
          "shadow-[0_0_0_2px_var(--bubble-gap,var(--card)),0_0_0_3.5px_var(--foreground)]",
        className,
      )}
    >
      {letter}
    </span>
  );
}
