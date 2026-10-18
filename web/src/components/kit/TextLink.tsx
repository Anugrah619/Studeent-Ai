import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * An in-app text link in brand ink. A router `Link`, so it never reloads the
 * page (a reload would also restart the demo's mock data).
 */
export function TextLink({
  to,
  children,
  arrow = false,
  className,
}: {
  to: string;
  children: ReactNode;
  /** A trailing arrow, for "go there next" links. */
  arrow?: boolean;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "group/link inline-flex items-center gap-1 rounded-sm font-medium text-brand-ink underline decoration-brand-line underline-offset-4 transition-colors outline-none hover:decoration-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      {children}
      {arrow ? (
        <ArrowRight
          aria-hidden
          className="size-3.5 transition-transform duration-150 group-hover/link:translate-x-0.5"
        />
      ) : null}
    </Link>
  );
}
