import { useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { GraduationCap, Loader2 } from "lucide-react";
import { useAuth } from "@/auth/AuthProvider";
import { USE_MOCKS } from "@/api/env";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fadeUp, scaleIn, stagger } from "@/lib/motion";

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
 * This is the one screen allowed a brand moment: there is no data on it to
 * compete with, and it is the first thing a director sees.
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
      {/* The brand panel. Static wash and grid, no motion beyond its entrance. */}
      <motion.aside
        variants={stagger(0.08, 0.05)}
        initial="hidden"
        animate="show"
        className="relative isolate hidden overflow-hidden border-r border-border px-12 py-12 lg:flex lg:flex-col xl:px-16"
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-hero">
          <div className="absolute inset-0 bg-grid-faint" />
        </div>

        <motion.div variants={fadeUp}>
          <Brand />
        </motion.div>

        <div className="my-auto max-w-lg py-12">
          <motion.p
            variants={fadeUp}
            className="text-xs font-semibold tracking-[0.08em] text-brand-ink uppercase"
          >
            For coaching institutes · JEE &amp; NEET
          </motion.p>
          <motion.h2
            variants={fadeUp}
            className="mt-4 font-heading text-4xl leading-[1.1] font-semibold tracking-tight text-foreground xl:text-[44px]"
          >
            Not just the score.{" "}
            <span className="text-brand-gradient">What each student misunderstands.</span>
          </motion.h2>
          <motion.p
            variants={fadeUp}
            className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground"
          >
            Student AI works out the mistake behind the marks a student lost on a
            mock, and tells the teacher what to do about it this week.
          </motion.p>

          <motion.ul variants={stagger(0.07)} className="mt-10 space-y-5">
            {PROMISES.map((item) => (
              <motion.li key={item.title} variants={fadeUp} className="flex gap-3.5">
                <span
                  aria-hidden
                  className="mt-1.5 size-2 shrink-0 rounded-full bg-brand ring-4 ring-brand-soft"
                />
                <div>
                  <p className="text-sm font-semibold text-foreground">{item.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                    {item.body}
                  </p>
                </div>
              </motion.li>
            ))}
          </motion.ul>
        </div>
      </motion.aside>

      {/* The form. On a phone this is the whole screen. */}
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <motion.div
          variants={scaleIn}
          initial="hidden"
          animate="show"
          className="w-full max-w-sm"
        >
          <div className="mb-8 lg:hidden">
            <Brand />
          </div>

          <h1 className="font-heading text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Your institute is read from your account. You will only ever see your
            own institute&rsquo;s students.
          </p>

          <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
            <div className="space-y-1.5">
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
                className="h-10 bg-card"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={loginError ? true : undefined}
                className="h-10 bg-card"
              />
            </div>

            {/* One live region, so a screen reader hears the failure without
                the form having to steal focus back from the password field. */}
            <div aria-live="polite">
              {loginError ? (
                <motion.p
                  role="alert"
                  variants={fadeUp}
                  initial="hidden"
                  animate="show"
                  className="rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-xs leading-relaxed text-foreground"
                >
                  {loginError.message}
                </motion.p>
              ) : null}
            </div>

            <Button type="submit" size="lg" className="h-10 w-full" disabled={!canSubmit}>
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
        </motion.div>
      </main>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="relative flex size-10 items-center justify-center rounded-[11px] bg-brand text-brand-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.28),inset_0_-1px_0_oklch(0_0_0/0.12),0_1px_2px_oklch(0.25_0.04_230/0.25)]"
      >
        <span className="absolute inset-0 rounded-[11px] bg-linear-to-b from-white/18 to-transparent" />
        <GraduationCap className="relative size-5" strokeWidth={2.1} />
      </span>
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight text-foreground">Student AI</div>
        <div className="text-xs text-muted-foreground">Mentor &amp; director console</div>
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
    <div className="mt-8 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-3.5 text-xs leading-relaxed text-muted-foreground">
      <p className="font-medium text-foreground">Seeded demo accounts</p>
      <p className="mt-1">
        Mentors at Aarambh Classes:{" "}
        <code className="font-mono">aarambh.bhatia</code>,{" "}
        <code className="font-mono">aarambh.nagarajan</code>,{" "}
        <code className="font-mono">aarambh.kulkarni</code> · password{" "}
        <code className="font-mono">demo12345</code>.
      </p>
      <p className="mt-1.5">
        On the live server, <code className="font-mono">pinnacle.rao</code>{" "}
        belongs to a second institute — sign in as them to see only its three
        students and none of Aarambh&rsquo;s. The demo dataset has one institute.
      </p>
    </div>
  );
}
