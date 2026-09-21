import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">
        No such screen
      </h1>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        The console has three views: the director console, a student&rsquo;s 360,
        and one mock&rsquo;s attribution.
      </p>
      <Button asChild className="mt-4">
        <Link to="/">Back to the director console</Link>
      </Button>
    </div>
  );
}
