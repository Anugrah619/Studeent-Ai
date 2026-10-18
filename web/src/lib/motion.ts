import type { HTMLMotionProps, Transition, Variants } from "motion/react";

/**
 * The motion vocabulary, in one place, so every screen moves the same way.
 *
 * THE RULE: motion guides the eye once. Something arrives, settles, and stays
 * still. On a data screen — the console, Student 360, a mock — that means no
 * loops, no bounce, no shimmer, nothing perpetual: a director reading a number
 * must never have to wait for it to stop moving, and a projector turns any
 * idle animation into the one thing the room watches. The story pages (How it
 * works, Data & trust) may be richer — a beam that traces a pipeline once, a
 * section that reveals as it scrolls in — but still nothing that runs forever
 * behind text someone is reading.
 *
 * Reduced motion is honoured globally: `<MotionConfig reducedMotion="user">`
 * at the root turns every transform and layout animation into an instant
 * change, leaving opacity fades. Nothing here needs its own check.
 *
 * Durations sit between 150 and 400 ms. Shorter reads as a glitch on a
 * projector; longer reads as the app being slow.
 */

/** easeOutQuint-ish: a fast start and a long, soft landing. No overshoot. */
export const EASE_OUT_SOFT = [0.22, 1, 0.36, 1] as const;

export const DURATION = {
  /** Hover, press, small state changes. */
  fast: 0.15,
  /** The default entrance. */
  base: 0.28,
  /** A large element, or the one focal headline on a screen. */
  slow: 0.4,
} as const;

export const transition = {
  fast: { duration: DURATION.fast, ease: EASE_OUT_SOFT },
  base: { duration: DURATION.base, ease: EASE_OUT_SOFT },
  slow: { duration: DURATION.slow, ease: EASE_OUT_SOFT },
  /**
   * For shared-layout movement (`layoutId`), e.g. the active-tab pill. Damped
   * hard enough that it lands without a visible overshoot.
   */
  layout: { type: "spring", stiffness: 420, damping: 38, mass: 0.9 },
} satisfies Record<string, Transition>;

/*
 * Variants all use the same two labels, "hidden" and "show", so a parent's
 * `initial="hidden" animate="show"` (or `whileInView="show"`) drives any mix of
 * children below it.
 */

/** The default entrance: rise 8px and fade in. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: transition.base },
};

/** Fade only — for things whose position must not appear to change. */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: transition.base },
};

/** For a card, chip or popover arriving in place. */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.97 },
  show: { opacity: 1, scale: 1, transition: transition.base },
};

/**
 * A parent that releases its children one after another. Pair with
 * `staggerChild` (or any variant using "hidden"/"show") on the children.
 * Keep `step` small: a KPI row of six should be fully in by ~300 ms.
 */
export function stagger(step = 0.05, delay = 0): Variants {
  return {
    hidden: {},
    show: { transition: { staggerChildren: step, delayChildren: delay } },
  };
}

export const staggerParent: Variants = stagger();
export const staggerChild: Variants = fadeUp;

/**
 * Spread onto a `motion.*` element that is clickable as a whole (a card that
 * opens a student, a step tile). Lifts 2px; pair it with
 * `hover:shadow-raised` so the shadow grows with it. Never on a card that is
 * not a link or button — lift promises a click.
 */
export const hoverLift = {
  whileHover: { y: -2 },
  whileTap: { y: 0, scale: 0.995 },
  transition: transition.fast,
} satisfies Pick<HTMLMotionProps<"div">, "whileHover" | "whileTap" | "transition">;

/** The route-change entrance used by AppShell. Deliberately smaller than fadeUp. */
export const pageEnter = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.24, ease: EASE_OUT_SOFT },
} satisfies Pick<HTMLMotionProps<"div">, "initial" | "animate" | "transition">;

/** Viewport options for scroll-triggered reveals: once, slightly before fully in. */
export const revealViewport = { once: true, amount: 0.2 } as const;
