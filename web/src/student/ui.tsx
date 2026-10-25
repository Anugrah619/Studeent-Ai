import { useId, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Loader2, RotateCw } from "lucide-react";
import type { NextAction } from "@/api/types";
import { detailOf } from "@/api/student";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { subjectColor, targetPath } from "./lib";

/**
 * The student app's few building blocks, on the console's tokens.
 *
 * The rule the console states for its two typefaces holds here too: figures,
 * labels and controls are set in Archivo; a sentence written for the student —
 * a greeting, the reason a block is on the plan, what a teacher agreed — is set
 * in Source Serif 4, the way a note in a margin is handwritten rather than
 * printed.
 */

/** One per screen: a short line of context, then one sentence in the serif. */
export function ScreenHeader({
  kicker,
  title,
  children,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="pt-7 pb-5 sm:pt-10">
      {kicker ? <p className="text-sm font-medium text-muted-foreground">{kicker}</p> : null}
      <h1 className="mt-1.5 font-serif text-[1.875rem] leading-[1.15] font-semibold tracking-tight text-foreground sm:text-[2.125rem]">
        {title}
      </h1>
      {children ? (
        <div className="mt-2.5 max-w-[60ch] text-base leading-relaxed text-muted-foreground">
          {children}
        </div>
      ) : null}
    </header>
  );
}

/** A titled part of a screen. */
export function Block({
  id,
  title,
  description,
  actions,
  children,
  className,
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId} className={cn("mt-9 scroll-mt-20", className)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id={headingId} className="text-lg font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          {description ? (
            <div className="mt-0.5 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
              {description}
            </div>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A sheet of paper: white, a hairline, a soft fall-off. */
export function Sheet({
  children,
  className,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "ol" | "ul" | "section" | "article";
}) {
  const Component = as;
  return (
    <Component
      className={cn("overflow-hidden rounded-xl bg-card shadow-card ring-1 ring-foreground/10", className)}
    >
      {children}
    </Component>
  );
}

/** Rows held in place while a list loads, so the page does not jump. */
export function LoadingRows({ rows = 3, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label}>
      <Sheet className="divide-y divide-border">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} aria-hidden className="space-y-2 px-4 py-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-4" style={{ width: `${80 - i * 12}%` }} />
          </div>
        ))}
      </Sheet>
    </div>
  );
}

/**
 * A part of the screen that could not load. Says so in a sentence, offers to
 * try again, and keeps the rest of the screen working. The server's own
 * sentence is shown when it sent one; a status code never is.
 */
export function Trouble({
  error,
  what,
  onRetry,
}: {
  error: unknown;
  what: string;
  onRetry?: () => void;
}) {
  const detail = detailOf(error);
  return (
    <div role="alert" className="rounded-xl border border-border bg-card px-4 py-4 shadow-card">
      <p className="text-sm font-medium text-foreground">We couldn&rsquo;t load {what}.</p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        {detail ?? "Check your connection, then try again."}
      </p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          <RotateCw aria-hidden />
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** An empty list, said as what it means and what to do. */
export function Quiet({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "rounded-xl border border-dashed border-border px-4 py-4 text-sm leading-relaxed text-muted-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** The server's reasons for refusing one field, in its own words. */
export function FieldMessages({ id, messages }: { id?: string; messages?: string[] }) {
  if (!messages?.length) return null;
  return (
    <ul id={id} className="mt-1.5 space-y-0.5 text-sm leading-snug text-foreground">
      {messages.map((m) => (
        <li key={m} className="flex gap-2">
          <span aria-hidden className="mt-[0.45em] size-1.5 shrink-0 rounded-[1px] bg-foreground/60" />
          <span>{m}</span>
        </li>
      ))}
    </ul>
  );
}

/** A refusal or a confirmation for the whole form, announced as it changes. */
export function FormNotice({
  tone,
  children,
}: {
  tone: "problem" | "done";
  children: ReactNode;
}) {
  return (
    <p
      role={tone === "problem" ? "alert" : "status"}
      className={cn(
        "rounded-md px-3.5 py-2.5 text-sm leading-relaxed text-foreground",
        tone === "problem" ? "border border-border bg-muted/60" : "bg-brand-soft",
      )}
    >
      {children}
    </p>
  );
}

export function Pending({ children }: { children: ReactNode }) {
  return (
    <>
      <Loader2 aria-hidden className="size-4 animate-spin" />
      {children}
    </>
  );
}

/** A subject's name with its own colour beside it, where it has one. */
export function SubjectLabel({ subject, className }: { subject: string; className?: string }) {
  const color = subjectColor(subject);
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {color ? (
        <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: color }} />
      ) : null}
      {subject}
    </span>
  );
}

/** One next action, as a card that goes where it says. */
export function ActionCard({ action, wide = false }: { action: NextAction; wide?: boolean }) {
  return (
    <Link
      to={targetPath(action.target)}
      className={cn(
        "group flex h-full gap-3 rounded-xl bg-card px-4 py-3.5 shadow-card ring-1 ring-foreground/10 outline-none transition-shadow hover:shadow-raised focus-visible:ring-3 focus-visible:ring-ring/50",
        wide && "items-center",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-snug text-foreground">{action.title}</span>
        <span
          className={cn(
            "mt-1 block text-sm leading-snug text-muted-foreground",
            !wide && "line-clamp-3",
          )}
        >
          {action.detail}
        </span>
      </span>
      <ChevronRight
        aria-hidden
        className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}
