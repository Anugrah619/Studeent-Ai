import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionProps {
  title?: ReactNode;
  /** One sentence on what the reader is looking at, under the title. */
  description?: ReactNode;
  /** Small uppercase label above the title. */
  eyebrow?: ReactNode;
  /** Right-aligned slot: a count, a filter, a "see all" link. */
  actions?: ReactNode;
  /** In-page anchor. The section scrolls clear of the sticky header. */
  id?: string;
  as?: "h2" | "h3";
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

/**
 * A titled block of a page. Every screen's sections share one rhythm — title,
 * a line of description, 16px, content — so a page reads as a sequence of
 * answers rather than a pile of panels. Stack sections with `space-y-10`.
 */
export function Section({
  title,
  description,
  eyebrow,
  actions,
  id,
  as = "h2",
  children,
  className,
  contentClassName,
}: SectionProps) {
  const headingId = useId();
  const Heading = as;
  const hasHeader = title || description || eyebrow || actions;

  return (
    <section
      id={id}
      aria-labelledby={title ? headingId : undefined}
      className={cn("scroll-mt-32", className)}
    >
      {hasHeader ? (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            {eyebrow ? (
              <div className="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-brand-ink uppercase">
                {eyebrow}
              </div>
            ) : null}
            {title ? (
              <Heading
                id={headingId}
                className={cn(
                  "font-heading font-semibold tracking-tight text-foreground",
                  as === "h2" ? "text-lg sm:text-xl" : "text-base",
                )}
              >
                {title}
              </Heading>
            ) : null}
            {description ? (
              <div className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
                {description}
              </div>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={contentClassName}>{children}</div>
    </section>
  );
}
