import type { ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  /** Kept so call sites need not change; there is nothing left to delay. */
  delay?: number;
  /** Kept for the same reason: children are no longer released one by one. */
  stagger?: number;
  as?: "div" | "section" | "ul" | "ol" | "li" | "article";
  className?: string;
  id?: string;
}

/**
 * A block of a story page. It is simply there.
 *
 * It used to fade and rise as it scrolled into view — eighteen blocks and
 * eleven staggered children across two pages, every one the same
 * fade-and-slide-up. A section that arrives on its own, every time, in the same
 * way, is not drawing attention to anything; it is the default of a generated
 * page. The page now gets one moment of motion where something is actually
 * being shown (a diagnosis inking in, a beam tracing a pipeline once), and the
 * rest is already in its place when the reader gets there.
 *
 * The name and the props are kept so the call sites stay readable as the
 * groupings they are. Content has always been in the DOM from the start, so it
 * is searchable, printable and read by assistive tech.
 */
export function Reveal({ children, as = "div", className, id }: RevealProps) {
  const Component = as;
  return (
    <Component id={id} className={className}>
      {children}
    </Component>
  );
}

/** A child of a `Reveal`. */
export function RevealItem({
  children,
  as = "div",
  className,
}: {
  children: ReactNode;
  as?: "div" | "li" | "article" | "section";
  className?: string;
}) {
  const Component = as;
  return <Component className={className}>{children}</Component>;
}
