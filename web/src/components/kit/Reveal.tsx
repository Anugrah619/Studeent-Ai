import type { ReactNode } from "react";
import { motion, type Variants } from "motion/react";
import { fadeUp, revealViewport, stagger, transition } from "@/lib/motion";

interface RevealProps {
  children: ReactNode;
  /** Seconds to wait after the block scrolls in. */
  delay?: number;
  /**
   * Release children one by one, `stagger` seconds apart. Children must be
   * `RevealItem`s (or any motion element using the "hidden"/"show" labels).
   */
  stagger?: number;
  as?: "div" | "section" | "ul" | "ol" | "li" | "article";
  className?: string;
  id?: string;
}

const MOTION = {
  div: motion.div,
  section: motion.section,
  ul: motion.ul,
  ol: motion.ol,
  li: motion.li,
  article: motion.article,
} as const;

/**
 * Reveals its content once, as it scrolls into view. For the story pages,
 * where the reader is walked through steps; a data screen should simply be
 * there when it loads.
 *
 * Content is in the DOM from the start (only its opacity and offset change),
 * so it is searchable, printable and read by assistive tech before it is seen.
 */
export function Reveal({
  children,
  delay = 0,
  stagger: step,
  as = "div",
  className,
  id,
}: RevealProps) {
  const Component = MOTION[as];
  const variants: Variants =
    step != null
      ? stagger(step, delay)
      : {
          hidden: fadeUp.hidden,
          show: { opacity: 1, y: 0, transition: { ...transition.slow, delay } },
        };

  return (
    <Component
      id={id}
      className={className}
      variants={variants}
      initial="hidden"
      whileInView="show"
      viewport={revealViewport}
    >
      {children}
    </Component>
  );
}

/** A child of a staggered `Reveal`. */
export function RevealItem({
  children,
  as = "div",
  className,
}: {
  children: ReactNode;
  as?: "div" | "li" | "article" | "section";
  className?: string;
}) {
  const Component = MOTION[as];
  return (
    <Component className={className} variants={fadeUp}>
      {children}
    </Component>
  );
}
