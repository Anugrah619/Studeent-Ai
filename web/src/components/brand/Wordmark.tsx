import { BrandMark } from "./BrandMark";
import { cn } from "@/lib/utils";

/**
 * The product's name, set the way the product speaks: the mark, then "Student
 * AI" in the serif, with what this screen is underneath. Used wherever the
 * product introduces itself — the sign-in page and the pages a student lands on
 * before there is a console to show — and never inside the console, where the
 * masthead belongs to the institute.
 */
export function Wordmark({
  tagline,
  className,
}: {
  tagline?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3.5", className)}>
      <BrandMark className="size-10 text-brand-ink" />
      <div className="leading-tight">
        <div className="font-serif text-2xl font-semibold tracking-tight text-foreground">
          Student AI
        </div>
        {tagline ? (
          <div className="text-sm text-muted-foreground">{tagline}</div>
        ) : null}
      </div>
    </div>
  );
}
