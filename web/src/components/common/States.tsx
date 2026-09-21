import type { ReactNode } from "react";
import { CircleAlert, Inbox } from "lucide-react";
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
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-12 text-center",
        className,
      )}
    >
      <span className="mb-3 text-muted-foreground">
        {icon ?? <Inbox aria-hidden className="size-6" />}
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {body ? (
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
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
        "rounded-xl border border-status-critical/30 bg-status-critical/5 px-5 py-4",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-status-critical" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            Could not load this panel
          </p>
          <p className="mt-0.5 font-mono text-xs break-words text-muted-foreground">
            {error.message}
          </p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 text-xs font-medium text-foreground underline underline-offset-4"
            >
              Try again
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function PanelSkeleton({
  lines = 5,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-5", className)}>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-2 h-3 w-64" />
      <div className="mt-5 space-y-2.5">
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
      className={cn(
        "transition-opacity duration-200",
        active && "opacity-60",
      )}
    >
      {children}
    </div>
  );
}
