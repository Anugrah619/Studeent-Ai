import { Link } from "react-router-dom";
import { Bubble } from "@/components/brand/Bubble";
import { Button } from "@/components/ui/button";
import { TextLink } from "@/components/kit/TextLink";

/**
 * A wrong URL in a demo is usually a typo in the address bar. Say what exists
 * and give one way back — the console — plus the pages someone was most likely
 * reaching for. Four options, none of them picked: there is no answer here.
 */
export function NotFound() {
  return (
    <div className="flex min-h-[65vh] flex-col items-center justify-center py-16 text-center">
      <div aria-hidden className="mb-6 flex gap-2.5">
        {["A", "B", "C", "D"].map((letter) => (
          <Bubble key={letter} letter={letter} size="md" />
        ))}
      </div>
      <p className="text-sm font-medium text-muted-foreground">404, not found</p>
      <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
        No such screen
      </h1>
      <p className="mt-2 max-w-md text-base leading-relaxed text-muted-foreground">
        Nothing lives at this address. Start from the director console, or open a
        student from the switcher above.
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
        <Button asChild>
          <Link to="/">Back to the director console</Link>
        </Button>
        <TextLink to="/how-it-works">How it works</TextLink>
        <TextLink to="/trust">Data &amp; trust</TextLink>
      </div>
    </div>
  );
}
