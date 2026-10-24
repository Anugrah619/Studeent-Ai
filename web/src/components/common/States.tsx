import type { ReactNode } from "react";
import { CircleAlert, Inbox, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  body,
  icon,
  className,
}: {
  title: string;
  body?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-6 py-12 text-center",
        className,
      )}
    >
      <span className="mb-3 flex size-10 items-center justify-center rounded-md bg-card text-muted-foreground shadow-card ring-1 ring-border">
        {icon ?? <Inbox aria-hidden className="size-5" />}
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {body ? (
        <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {body}
        </p>
      ) : null}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: Error;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-xl border border-status-critical/25 bg-card px-5 py-4 shadow-card",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-status-critical/10 text-status-critical ring-1 ring-status-critical/20">
          <CircleAlert aria-hidden className="size-4" />
        </span>
        <div className="min-w-0 pt-0.5">
          <p className="text-sm font-semibold text-foreground">
            Could not load this panel
          </p>
          <p className="mt-0.5 font-mono text-xs wrap-break-word text-muted-foreground">
            {error.message}
          </p>
          {onRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry} className="mt-3">
              <RotateCw aria-hidden />
              Try again
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The shape of a panel before its data lands: a card at the right size, so
 * the page does not jump when it fills in.
 */
export function PanelSkeleton({
  lines = 5,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn("rounded-xl bg-card p-5 shadow-card ring-1 ring-foreground/10", className)}
    >
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-2 h-3 w-64 max-w-full" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className="h-3.5" style={{ width: `${95 - i * 9}%` }} />
        ))}
      </div>
    </div>
  );
}

/** Hold the previous render at reduced opacity rather than flashing a skeleton. */
export function Refetching({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div
      aria-busy={active || undefined}
      className={cn(
        "transition-opacity duration-200",
        active && "opacity-60",
      )}
    >
      {children}
    </div>
  );
}

/**
 * What a screen looks like while its code is still arriving: the headline's
 * shape, a row of figures and a panel, in the same places the real page puts
 * them, so the page fills in rather than jumps.
 *
 * Every route is its own chunk now, and on a laptop that chunk is usually in
 * before a skeleton would be seen at all. So this fades in only after 150 ms —
 * a fast load shows nothing, and a slow one shows a calm page, not a flash.
 */
export function RouteSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading this page"
      className="animate-in fill-mode-both delay-150 duration-200 fade-in-0"
    >
      <div aria-hidden className="pt-8 pb-6 sm:pt-10">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="mt-4 h-9 w-full max-w-2xl sm:h-11" />
        <Skeleton className="mt-3 h-4 w-full max-w-xl" />
      </div>
      <div aria-hidden className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-xl bg-card p-4 shadow-card ring-1 ring-foreground/10">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-8 w-16" />
          </div>
        ))}
      </div>
      <PanelSkeleton lines={6} className="mt-10" />
    </div>
  );
}
