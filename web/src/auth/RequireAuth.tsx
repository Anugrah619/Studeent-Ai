import { lazy, Suspense, type ReactNode } from "react";
import { PlugZap } from "lucide-react";
import { API_BASE } from "@/api/env";
import { useAuth } from "./AuthProvider";
import { Login } from "@/routes/Login";
import { ChangePassword } from "@/routes/ChangePassword";
import { Bubble } from "@/components/brand/Bubble";
import { Button } from "@/components/ui/button";

/** Its own chunk: a mentor never downloads the student app, nor a student the console. */
const StudentApp = lazy(() =>
  import("@/student/StudentApp").then((m) => ({ default: m.StudentApp })),
);

/**
 * The gate. Four states in, four different screens out — see `AuthStatus` for
 * why they are not collapsed. Two more apply once someone is signed in:
 *
 * - **A temporary password** (`must_change_password`) shows the change screen
 *   and nothing else. The server enforces this independently — every other
 *   route answers 403 `password_change_required` — so this is the friendly
 *   half of a rule that does not depend on it.
 * - **A student** gets the student app (`student/StudentApp.tsx`), with its
 *   own routes, instead of the console. Every console route is closed to
 *   student accounts, so the console is never mounted for one — not even at a
 *   console address, which the student app answers as a page it does not have.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, me, error, retry } = useAuth();

  if (status === "loading") return <BootScreen />;
  if (status === "unavailable") return <Unavailable error={error} onRetry={retry} />;
  if (status === "anonymous") return <Login />;
  if (me?.must_change_password) return <ChangePassword />;
  if (me?.role === "student") {
    return (
      <Suspense fallback={<BootScreen />}>
        <StudentApp />
      </Suspense>
    );
  }
  return <>{children}</>;
}

/**
 * Deliberately almost empty. This is on screen for one round trip to
 * `/api/me/`; a spinner-and-skeleton composition here would flash a layout the
 * user may never be shown. The four bubbles are the same marking-in-progress
 * the diagnosis card shows while it reads, for the same reason: to say the page
 * has not frozen.
 */
function BootScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <div role="status" aria-label="Loading your session" className="flex gap-2.5">
        {["A", "B", "C", "D"].map((letter, i) => (
          <Bubble
            key={letter}
            letter={letter}
            size="md"
            className="animate-bubble-read"
            style={{ animationDelay: `${i * 300}ms` }}
          />
        ))}
      </div>
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
        <span className="mx-auto mb-4 flex size-11 items-center justify-center rounded-md border border-border bg-card text-muted-foreground">
          <PlugZap aria-hidden className="size-5" />
        </span>
        <h1 className="text-xl font-semibold tracking-tight">
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
