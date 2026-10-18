import { cn } from "@/lib/utils";

/**
 * Four option bubbles in reading order — A B over C D — with the third filled.
 *
 * It is the product in one glyph: a question, four options, and the one the
 * student actually picked. (C is also the option the demo's first student picks
 * on the question every walkthrough opens.) The favicon is the same drawing.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 28 28"
      aria-hidden
      className={cn("size-7 shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
    >
      <circle cx="8" cy="8" r="5" />
      <circle cx="20" cy="8" r="5" />
      <circle cx="8" cy="20" r="5" fill="currentColor" />
      <circle cx="20" cy="20" r="5" />
    </svg>
  );
}
