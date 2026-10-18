import { Link } from "react-router-dom";
import { Bubble } from "@/components/brand/Bubble";
import { Button } from "@/components/ui/button";

/**
 * Four options, none of them picked: there is no answer on this page.
 */
export function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div aria-hidden className="mb-6 flex gap-2.5">
        {["A", "B", "C", "D"].map((letter) => (
          <Bubble key={letter} letter={letter} size="md" />
        ))}
      </div>
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        No such screen
      </h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        The console has five views: the director console, a student&rsquo;s 360,
        one mock&rsquo;s attribution, how it works, and data &amp; trust.
      </p>
      <Button asChild className="mt-6">
        <Link to="/">Back to the director console</Link>
      </Button>
    </div>
  );
}
