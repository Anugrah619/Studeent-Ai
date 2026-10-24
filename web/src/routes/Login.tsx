import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { USE_MOCKS } from "@/api/env";
import { Wordmark } from "@/components/brand/Wordmark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The three claims the product is built to keep, in the words the explainer
 * pages use. Nothing here is a figure, so nothing here can go stale.
 */
const PROMISES = [
  {
    title: "Counted, never guessed",
    body: "Marks at stake are recounted from the answer sheet. The AI's job is the judgement, not the arithmetic.",
  },
  {
    title: "Each finding cites its questions",
    body: "Each diagnosis names the questions behind it, so a teacher can check the working.",
  },
  {
    title: "A teacher checks the AI",
    body: "A mentor can agree or disagree with each diagnosis, and the verdict is saved with it.",
  },
];

/**
 * The console's front door.
 *
 * It posts to `/api/auth/login/`, which sets a session cookie and rotates the
 * CSRF token. Nothing is stored in `localStorage`: the session lives in an
 * HttpOnly cookie the page cannot read, which is the point of using sessions —
 * an XSS on this origin cannot walk away with the credential.
 *
 * This is the one screen with room to say what the product is: there is no data
 * on it to compete with, and it is the first thing a director sees. It says it
 * in the product's own two voices — the claim in the serif, the promises in the
 * grotesque — and in nothing else: no gradient on a phrase, no wash or grid
 * behind it, and no entrance.
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
    <div className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <aside className="hidden border-r border-border bg-muted/50 px-12 py-12 lg:flex lg:flex-col xl:px-16">
        <Wordmark tagline="Mentor & director console" />

        <div className="my-auto max-w-lg py-12">
          <p className="text-sm font-medium text-muted-foreground">
            For coaching institutes, JEE and NEET
          </p>
          <h2 className="mt-4 font-serif text-4xl leading-[1.1] font-semibold tracking-tight text-foreground xl:text-[44px]">
            Not just the score. What each student misunderstands.
          </h2>
          <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground">
            Student AI works out the mistake behind the marks a student lost on a
            mock, and tells the teacher what to do about it this week.
          </p>

          <ul className="mt-10 space-y-5">
            {PROMISES.map((item) => (
              <li key={item.title} className="flex gap-3.5">
                <span
                  aria-hidden
                  className="mt-2 size-2 shrink-0 rounded-[2px] bg-brand"
                />
                <div>
                  <p className="text-sm font-semibold text-foreground">{item.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                    {item.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* The form. On a phone this is the whole screen. */}
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <Wordmark tagline="Mentor & director console" className="mb-9 lg:hidden" />

          <h1 className="font-heading text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Your institute is read from your account. You will only ever see your
            own institute&rsquo;s students.
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
                  className="rounded-md border border-status-critical/30 bg-status-critical/5 px-3.5 py-2.5 text-sm leading-relaxed text-foreground"
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
      </main>
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
        On the live server, <code className="font-mono">pinnacle.rao</code>{" "}
        belongs to a second institute — sign in as them to see only its three
        students and none of Aarambh&rsquo;s. The demo dataset has one institute.
      </p>
    </div>
  );
}
