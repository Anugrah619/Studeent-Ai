import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { ApiError } from "@/api/client";
import { AuthFrame } from "@/auth/AuthFrame";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The server's own reasons, not ours.
 *
 * Whether a password is acceptable is decided in one place — Django's
 * validators, plus the rule against containing a roll number — and it answers
 * with sentences written for this reader ("This password is too common."). The
 * client's generic error flattening would print them as `new_password: …`, so
 * the body is read directly. Anything that is not a field error (a 429 telling
 * you to wait) falls through to its `detail`.
 */
function reasonsFrom(error: Error | null): string[] {
  if (!error) return [];
  if (error instanceof ApiError && error.body && typeof error.body === "object") {
    const body = error.body as Record<string, unknown>;
    const fields = ["current_password", "new_password"].flatMap((key) => {
      const value = body[key];
      return Array.isArray(value)
        ? value.filter((m): m is string => typeof m === "string")
        : [];
    });
    if (fields.length) return fields;
    if (typeof body.detail === "string") return [body.detail];
  }
  return [error.message];
}

/**
 * Shown, and nothing else, to an account signed in on a temporary password.
 *
 * A student's first password is chosen by someone else and handed over on a
 * slip, so it cannot stay. The server refuses every other route until this
 * succeeds; this screen is the friendly face of that rule, not its only
 * enforcement.
 */
export function ChangePassword() {
  const { me, changePassword, changePasswordPending, changePasswordError, logout } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const mismatch = confirm !== "" && next !== confirm;
  const canSubmit =
    current !== "" && next !== "" && next === confirm && !changePasswordPending;
  const reasons = reasonsFrom(changePasswordError);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    try {
      await changePassword({ current_password: current, new_password: next });
    } catch {
      // Rendered from `changePasswordError`; the rejection is expected.
    }
  }

  return (
    <AuthFrame>
      <h1 className="font-heading text-2xl font-semibold tracking-tight">
        Choose your own password
      </h1>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        {me?.name ? `${me.name}, you` : "You"} signed in with a temporary password
        from your institute. Pick one only you know before you continue.
      </p>

      <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="current-password">Temporary password</Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="h-10 bg-card"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            aria-describedby="password-rules"
            className="h-10 bg-card"
          />
          <p id="password-rules" className="text-xs leading-relaxed text-muted-foreground">
            At least 8 characters. Not a common password, not all digits, not your
            name, and not your roll number.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirm-password">Type it again</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={mismatch ? true : undefined}
            className="h-10 bg-card"
          />
          {mismatch ? (
            <p role="alert" className="text-xs text-status-critical">
              These two do not match.
            </p>
          ) : null}
        </div>

        {/* One live region so a screen reader hears the reasons without the
            form having to steal focus back. */}
        <div aria-live="polite">
          {reasons.length ? (
            <ul
              role="alert"
              className="space-y-1 rounded-lg border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-xs leading-relaxed text-foreground"
            >
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <Button type="submit" size="lg" className="h-10 w-full" disabled={!canSubmit}>
          {changePasswordPending ? (
            <>
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Saving…
            </>
          ) : (
            "Save and continue"
          )}
        </Button>
      </form>

      <button
        type="button"
        onClick={() => void logout()}
        className="mt-6 text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        Not you? Sign out
      </button>
    </AuthFrame>
  );
}
