import type { ComponentProps, ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A native `<select>` in the field's own clothes.
 *
 * Native rather than the Radix select the console's batch filter uses: these
 * sit inside forms (a paper's exam, a column's meaning, a saved mapping), where
 * the platform control is keyboard- and screen-reader-correct for free, works
 * the same on a phone, and posts the value it shows.
 */
export function NativeSelect({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select
      {...props}
      className={cn(
        "h-10 w-full min-w-0 rounded-md border border-input bg-card px-3 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm",
        className,
      )}
    >
      {children}
    </select>
  );
}

/** A field's own error, under it, tied to it by `id` for `aria-describedby`. */
export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="mt-1.5 flex items-start gap-1.5 text-sm text-status-critical">
      <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/**
 * A quiet sentence in a dashed box — the console's way of saying "this is how
 * things stand", as opposed to an error. Same device as the question panel's
 * notes.
 */
export function Note({
  icon,
  children,
  className,
}: {
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex gap-3 rounded-md border border-dashed border-border bg-muted/40 px-4 py-3 text-sm leading-relaxed text-muted-foreground",
        className,
      )}
    >
      {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
      <div className="max-w-prose min-w-0">{children}</div>
    </div>
  );
}

/** A refusal or failure the reader has to act on. `role="alert"`, so it is announced. */
export function Problem({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-status-critical/30 bg-status-critical/5 px-4 py-3 text-sm"
    >
      <p className="flex items-start gap-2 font-medium text-foreground">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-status-critical" />
        {title}
      </p>
      {children ? (
        <div className="mt-1 pl-6 leading-relaxed text-muted-foreground">{children}</div>
      ) : null}
    </div>
  );
}

/** "1 student", "3 students". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
}

/** A small card for one compact panel: a title, a count, and its body. */
export function MiniPanel({
  title,
  meta,
  children,
  className,
  labelId,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  labelId?: string;
}) {
  return (
    <section
      aria-labelledby={labelId}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-xl bg-card shadow-card ring-1 ring-border",
        className,
      )}
    >
      <header className="flex items-baseline justify-between gap-3 border-b border-border px-5 py-3">
        <h3 id={labelId} className="text-sm font-semibold text-foreground">
          {title}
        </h3>
        {meta ? (
          <span className="tnum shrink-0 text-xs text-muted-foreground">{meta}</span>
        ) : null}
      </header>
      <div className="flex-1">{children}</div>
    </section>
  );
}
