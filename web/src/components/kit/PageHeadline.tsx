import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeadlineProps {
  /** A short line above the headline — the screen's name or its date. */
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
  /** Id for the heading, so a landmark can be `aria-labelledby` it. */
  headingId?: string;
  className?: string;
}

/**
 * One headline per screen: a line of context, a big plain-English sentence, a
 * supporting line, and the screen's actions.
 *
 * It is plain type on the plain page. It used to enter with a staggered
 * fade-up, sit on an optional gradient wash or a grid, and pick one phrase out
 * in a gradient of the brand colour. Every one of those is the same device —
 * decoration that announces "designed" — and a headline that already says the
 * thing a director needs to know does not need to perform it.
 */
export function PageHeadline({
  eyebrow,
  title,
  support,
  meta,
  actions,
  as = "h1",
  size = "lg",
  headingId,
  className,
}: PageHeadlineProps) {
  const Heading = as;
  const lg = size === "lg";

  return (
    <header className={cn("relative", lg ? "pt-8 pb-6 sm:pt-10" : "pt-2 pb-2", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="max-w-4xl min-w-0">
          {eyebrow ? (
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              {eyebrow}
            </div>
          ) : null}

          <Heading
            id={headingId}
            className={cn(
              "font-heading font-semibold tracking-tight text-foreground",
              lg
                ? "text-3xl leading-[1.12] sm:text-4xl sm:leading-[1.1]"
                : "text-2xl leading-tight",
            )}
          >
            {title}
          </Heading>

          {support ? (
            <div
              className={cn(
                "max-w-[62ch] leading-relaxed text-muted-foreground",
                lg ? "mt-3 text-base" : "mt-2 text-sm",
              )}
            >
              {support}
            </div>
          ) : null}

          {meta ? (
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              {meta}
            </div>
          ) : null}
        </div>

        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
