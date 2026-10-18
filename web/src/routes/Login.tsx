import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { USE_MOCKS } from "@/api/env";
import { BrandMark } from "@/components/brand/BrandMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The console's front door.
 *
 * It posts to `/api/auth/login/`, which sets a session cookie and rotates the
 * CSRF token. Nothing is stored in `localStorage`: the session lives in an
 * HttpOnly cookie the page cannot read, which is the point of using sessions —
 * an XSS on this origin cannot walk away with the credential.
 */
export function Login() {
  const { login, loginPending, loginError } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const canSubmit = username.trim() !== "" && password !== "" && !loginPending;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    try {
      await login({ username: username.trim(), password });
    } catch {
      // Rendered from `loginError` below; the throw is expected, not exceptional.
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex items-center gap-3.5">
          <BrandMark className="size-10 text-foreground" />
          <div className="leading-tight">
            <div className="font-serif text-2xl font-semibold tracking-tight">
              Student AI
            </div>
            <div className="text-sm text-muted-foreground">
              Mentor &amp; director console
            </div>
          </div>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Your institute is read from your account. You will only ever see your
          own students.
        </p>

        <form onSubmit={onSubmit} className="mt-7 space-y-5" noValidate>
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              name="username"
              autoComplete="username"
              autoFocus
              spellCheck={false}
              autoCapitalize="none"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-invalid={loginError ? true : undefined}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={loginError ? true : undefined}
            />
          </div>

          {/* One live region, so a screen reader hears the failure without
              the form having to steal focus back from the password field. */}
          <div aria-live="polite">
            {loginError ? (
              <p
                role="alert"
                className="rounded-md border border-status-critical/30 bg-status-critical/5 px-3.5 py-2.5 text-sm text-foreground"
              >
                {loginError.message}
              </p>
            ) : null}
          </div>

          <Button type="submit" size="lg" className="w-full" disabled={!canSubmit}>
            {loginPending ? (
              <>
                <Loader2 aria-hidden className="size-4 animate-spin" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>

        <DemoHint />
      </div>
    </div>
  );
}

/**
 * Seeded credentials, shown only against the demo dataset. Printing them on a
 * screen that might one day face a real institute is how a demo convenience
 * becomes a published password.
 */
function DemoHint() {
  if (!USE_MOCKS && !import.meta.env.DEV) return null;
  return (
    <div className="mt-8 rounded-md border border-dashed border-border px-4 py-3.5 text-sm leading-relaxed text-muted-foreground">
      <p className="font-medium text-foreground">Seeded demo accounts</p>
      <p className="mt-1.5">
        Mentors at Aarambh Classes:{" "}
        <code className="font-mono">aarambh.bhatia</code>,{" "}
        <code className="font-mono">aarambh.nagarajan</code>,{" "}
        <code className="font-mono">aarambh.kulkarni</code>. The password is{" "}
        <code className="font-mono">demo12345</code>.
      </p>
      <p className="mt-2">
        <code className="font-mono">pinnacle.rao</code> belongs to the second
        institute — sign in as them to watch tenant isolation empty the console.
      </p>
    </div>
  );
}
