import type { ReactNode } from "react";
import { motion } from "motion/react";
import { fadeUp, stagger } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface PageHeadlineProps {
  /** Small uppercase label above the headline — the screen's name or context. */
  eyebrow?: ReactNode;
  /**
   * The one big sentence. It answers "what do I need to know?" in plain
   * English, from the screen's own data — "6 students need you this week; 2
   * are critical", not "Director console". The kit renders it; the screen
   * writes it, and never says more than the data does.
   */
  title: ReactNode;
  /** One or two supporting sentences under the headline. */
  support?: ReactNode;
  /** A row under the support line — honesty labels, chips, a link. */
  meta?: ReactNode;
  /** Right-aligned controls: a primary action, a filter. */
  actions?: ReactNode;
  as?: "h1" | "h2";
  /** `md` for a headline inside a page rather than at its top. */
  size?: "lg" | "md";
  /**
   * A static decorative wash behind the headline. Story pages only — a data
   * screen's headline stands on the plain page.
   */
  backdrop?: "none" | "hero" | "grid";
  /** Id for the heading, so a landmark can be `aria-labelledby` it. */
  headingId?: string;
  className?: string;
}

/**
 * One headline per screen: eyebrow, a big plain-English sentence, a
 * supporting line, and the screen's actions. Enters once, top to bottom.
 */
export function PageHeadline({
  eyebrow,
  title,
  support,
  meta,
  actions,
  as = "h1",
  size = "lg",
  backdrop = "none",
  headingId,
  className,
}: PageHeadlineProps) {
  const Heading = as === "h2" ? motion.h2 : motion.h1;
  const lg = size === "lg";

  return (
    <motion.header
      variants={stagger(0.06)}
      initial="hidden"
      animate="show"
      className={cn(
        "relative isolate",
        lg ? "pt-8 pb-6 sm:pt-10" : "pt-2 pb-2",
        backdrop !== "none" && "-mx-4 px-4 sm:-mx-6 sm:px-6",
        className,
      )}
    >
      {backdrop === "hero" ? (
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-hero" />
      ) : backdrop === "grid" ? (
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-hero">
          <div className="absolute inset-0 bg-grid-faint" />
        </div>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="max-w-4xl min-w-0">
          {eyebrow ? (
            <motion.div
              variants={fadeUp}
              className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-[0.08em] text-brand-ink uppercase"
            >
              {eyebrow}
            </motion.div>
          ) : null}

          <Heading
            id={headingId}
            variants={fadeUp}
            className={cn(
              "font-heading font-semibold tracking-tight text-foreground",
              lg
                ? "text-[28px] leading-[1.15] sm:text-4xl sm:leading-[1.1] lg:text-[42px]"
                : "text-2xl leading-tight sm:text-[28px]",
            )}
          >
            {title}
          </Heading>

          {support ? (
            <motion.div
              variants={fadeUp}
              className={cn(
                "max-w-3xl leading-relaxed text-muted-foreground",
                lg ? "mt-3 text-base sm:text-lg" : "mt-2 text-sm sm:text-base",
              )}
            >
              {support}
            </motion.div>
          ) : null}

          {meta ? (
            <motion.div
              variants={fadeUp}
              className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm"
            >
              {meta}
            </motion.div>
          ) : null}
        </div>

        {actions ? (
          <motion.div variants={fadeUp} className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </motion.div>
        ) : null}
      </div>
    </motion.header>
  );
}

/**
 * The one phrase in a headline the eye should land on — usually the number
 * that matters. Brand ink, so it is emphasis and never a status: a critical
 * count in a headline is still worded "critical", not coloured red.
 */
export function Accent({
  children,
  gradient = false,
  className,
}: {
  children: ReactNode;
  /** A brand-ink gradient instead of flat ink. Story pages. */
  gradient?: boolean;
  className?: string;
}) {
  return (
    <span className={cn(gradient ? "text-brand-gradient" : "text-brand-ink", className)}>
      {children}
    </span>
  );
}
