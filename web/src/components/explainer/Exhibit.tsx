import type { ReactNode } from "react";
import { Database, Info, Radio } from "lucide-react";
import { USE_MOCKS } from "@/api/env";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The building blocks the two explainer pages share.
 *
 * Both pages make the same promise — "this example is the system, not a
 * picture of it" — so the thing that keeps that promise is one component: every
 * live panel is an `Exhibit`, and every `Exhibit` says where its figures came
 * from. Against the live API it says so; on fixtures it says *that*, because an
 * explainer that implies live data while running on a mock is exactly the
 * overclaim the "Data & trust" page tells a director we never make.
 */

/** Where an exhibit's figures came from, said in words a director reads. */
export function SourceTag({
  endpoints,
  className,
}: {
  /** The routes behind the exhibit — in the tooltip and for screen readers. */
  endpoints: string[];
  className?: string;
}) {
  const detail = `${USE_MOCKS ? "Served from offline demo fixtures" : "Read from the API as this page loaded"}: ${endpoints.join(", ")}`;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground",
        className,
      )}
      title={detail}
    >
      {USE_MOCKS ? (
        <Database aria-hidden className="size-3" />
      ) : (
        <Radio aria-hidden className="size-3 text-status-good" />
      )}
      {USE_MOCKS ? "Demo fixtures" : "Live data"}
      <span className="sr-only">. {detail}</span>
    </span>
  );
}

/** One live illustration: a titled card that names its source. */
export function Exhibit({
  title,
  endpoints,
  children,
  footer,
  className,
  labelledBy,
}: {
  title: ReactNode;
  endpoints: string[];
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <figure
      aria-labelledby={labelledBy}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card",
        className,
      )}
    >
      <figcaption className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-border bg-muted/40 px-4 py-2.5">
        <span
          id={labelledBy}
          className="min-w-0 text-[11px] font-semibold tracking-[0.06em] text-foreground uppercase"
        >
          {title}
        </span>
        <SourceTag endpoints={endpoints} />
      </figcaption>
      <div className="min-w-0 flex-1 px-4 py-4 sm:px-5">{children}</div>
      {footer ? (
        <div className="border-t border-border px-4 py-2.5 text-xs leading-relaxed text-muted-foreground sm:px-5">
          {footer}
        </div>
      ) : null}
    </figure>
  );
}

export function ExhibitSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="space-y-2.5" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-4" style={{ width: `${92 - i * 11}%` }} />
      ))}
    </div>
  );
}

/**
 * The exhibit could not show its example — said calmly, in a sentence.
 *
 * Not the red error state: on these pages a missing example is not the reader's
 * problem and not an outage they need to act on. It is a gap in the
 * illustration, and the explanation beside it still stands.
 */
export function ExhibitNote({
  children,
  detail,
}: {
  children: ReactNode;
  detail?: string;
}) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-dashed border-border bg-muted/30 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
      <Info aria-hidden className="mt-px size-4 shrink-0" />
      <div className="min-w-0">
        <p>{children}</p>
        {detail ? (
          <p className="mt-1.5 font-mono text-[11px] break-words text-muted-foreground/80">
            {detail}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Small uppercase label over a group inside an exhibit. */
export function Eyebrow({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <p
      id={id}
      className={cn(
        "text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** A figure with its label, for a dense row of counts. */
export function Figure({
  label,
  value,
  of,
  caption,
}: {
  label: string;
  value: ReactNode;
  /** The denominator, said in words: "of 184". Omitted when there is none. */
  of?: ReactNode;
  caption?: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-background/60 px-3 py-2.5">
      <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1">
        <span className="text-2xl leading-none font-semibold tracking-tight text-foreground">
          {value}
        </span>
        {of ? (
          <span className="ml-1.5 text-xs text-muted-foreground">{of}</span>
        ) : null}
        {caption ? (
          <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
            {caption}
          </span>
        ) : null}
      </dd>
    </div>
  );
}
