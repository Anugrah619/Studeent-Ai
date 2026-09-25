import type { ReactNode } from "react";
import { Loader2, PlugZap } from "lucide-react";
import { API_BASE } from "@/api/env";
import { useAuth } from "./AuthProvider";
import { Login } from "@/routes/Login";
import { Button } from "@/components/ui/button";

/**
 * The gate. Four states in, four different screens out — see `AuthStatus` for
 * why they are not collapsed.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, error, retry } = useAuth();

  if (status === "loading") return <BootScreen />;
  if (status === "unavailable") return <Unavailable error={error} onRetry={retry} />;
  if (status === "anonymous") return <Login />;
  return <>{children}</>;
}

/**
 * Deliberately almost empty. This is on screen for one round trip to
 * `/api/me/`; a spinner-and-skeleton composition here would flash a layout the
 * user may never be shown.
 */
function BootScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <Loader2
        aria-label="Loading your session"
        role="status"
        className="size-5 animate-spin text-muted-foreground"
      />
    </div>
  );
}

/**
 * The API did not answer. This is not a login problem and must not be dressed
 * as one — the user's password will not help, and asking for it teaches them to
 * type it at whatever is on the other end.
 */
function Unavailable({
  error,
  onRetry,
}: {
  error: Error | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto mb-4 flex size-10 items-center justify-center rounded-full border border-border text-muted-foreground">
          <PlugZap aria-hidden className="size-5" />
        </span>
        <h1 className="text-lg font-semibold tracking-tight">
          Cannot reach the API
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          The console is running against{" "}
          <code className="font-mono text-xs">
            {API_BASE || "this origin (via the dev proxy)"}
          </code>{" "}
          and got no usable answer from{" "}
          <code className="font-mono text-xs">/api/me/</code>. Start the backend
          with <code className="font-mono text-xs">manage.py runserver</code>, or
          set <code className="font-mono text-xs">VITE_USE_MOCKS=true</code> to
          run on fixtures.
        </p>
        {error ? (
          <p className="mt-3 font-mono text-xs break-words text-muted-foreground">
            {error.message}
          </p>
        ) : null}
        <Button variant="outline" size="sm" className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}
