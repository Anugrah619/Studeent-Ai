import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * An in-app text link in brand ink. A router `Link`, so it never reloads the
 * page (a reload would also restart the demo's mock data).
 *
 * It is underlined text and nothing more. A trailing arrow on every "go there
 * next" link is the same mark on every link, and the underline already says
 * it is one.
 */
export function TextLink({
  to,
  children,
  className,
}: {
  to: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "rounded-sm font-medium text-brand-ink underline decoration-brand-line underline-offset-4 transition-colors outline-none hover:decoration-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      {children}
    </Link>
  );
}
