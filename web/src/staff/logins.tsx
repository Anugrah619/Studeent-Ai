import { useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Check,
  ChevronDown,
  CircleCheck,
  Copy,
  Hourglass,
  KeyRound,
  Loader2,
  ShieldAlert,
  UserMinus,
} from "lucide-react";
import { ApiError } from "@/api/client";
import { useCredentialAction, detailOf, type CredentialAction } from "@/api/staff";
import type { LoginStatus, StudentList } from "@/api/types";
import { useStudents } from "@/api/queries";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, ErrorState, PanelSkeleton } from "@/components/common/States";
import { firstName } from "@/lib/explainer";
import { longDate, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Problem, plural } from "./common";

/* ------------------------------------------------------------------ *
 * The status, in words
 * ------------------------------------------------------------------ */

export const LOGIN_STATUS: Record<
  LoginStatus,
  { label: string; icon: typeof KeyRound; hint: string }
> = {
  none: {
    label: "No login yet",
    icon: KeyRound,
    hint: "Cannot sign in to the student app yet.",
  },
  awaiting_first_sign_in: {
    label: "Awaiting first sign-in",
    icon: Hourglass,
    hint: "Has a temporary password and has not yet chosen their own.",
  },
  active: {
    label: "Signed in",
    icon: CircleCheck,
    hint: "Has chosen their own password.",
  },
};

/**
 * Not a severity, so not a status colour: a login state is a fact about an
 * account, not a judgement about a student. The icon and the word carry it.
 */
export function LoginStatusChip({
  status,
  className,
}: {
  status: LoginStatus;
  className?: string;
}) {
  const token = LOGIN_STATUS[status];
  const Icon = token.icon;
  return (
    <span
      title={token.hint}
      data-login-status={status}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-sm px-2 text-xs font-medium whitespace-nowrap ring-1 ring-border ring-inset",
        status === "none" ? "bg-muted text-muted-foreground" : "bg-card text-foreground",
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {token.label}
    </span>
  );
}

/** The one student a login action is about. */
export interface LoginSubject {
  id: number;
  name: string;
  roll_no: string;
  login_status: LoginStatus;
  exited_at?: string | null;
  mentor_name?: string;
}

/* ------------------------------------------------------------------ *
 * The action: chip + the button that fits the state
 * ------------------------------------------------------------------ */

/**
 * The status and the one action it calls for. No login → issue one; a login
 * of any kind → reset it. A student who has left is shown as such, with no
 * button: the server refuses them a login, and a button known to fail is not
 * an offer.
 */
export function LoginControl({
  student,
  compact = false,
}: {
  student: LoginSubject;
  compact?: boolean;
}) {
  const [action, setAction] = useState<CredentialAction | null>(null);
  const left = Boolean(student.exited_at) && student.login_status === "none";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <LoginStatusChip status={student.login_status} />
      {left ? (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <UserMinus aria-hidden className="size-3.5" />
          Left {longDate(student.exited_at)}
        </span>
      ) : student.login_status === "none" ? (
        <Button
          size={compact ? "xs" : "sm"}
          variant="outline"
          onClick={() => setAction("issue")}
          aria-label={`Issue login for ${student.name}`}
        >
          <KeyRound aria-hidden />
          Issue login
        </Button>
      ) : (
        <Button
          size={compact ? "xs" : "sm"}
          variant="ghost"
          onClick={() => setAction("reset")}
          aria-label={`Reset password for ${student.name}`}
        >
          Reset password
        </Button>
      )}

      <CredentialDialog
        student={student}
        action={action}
        onClose={() => setAction(null)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The dialog: confirm → the slip, shown once
 * ------------------------------------------------------------------ */

/**
 * Issue or reset, then the credentials slip.
 *
 * The temporary password is shown once, here, and nowhere else: it is held in
 * this dialog's state only (see `useCredentialAction`), never in the query
 * cache, storage or a log, and closing the dialog drops it. The server sends it
 * with `Cache-Control: no-store` and keeps no readable copy, so "show it again"
 * does not exist — the only recovery is another reset, which the slip says.
 */
export function CredentialDialog({
  student,
  action,
  onClose,
}: {
  student: LoginSubject;
  action: CredentialAction | null;
  onClose: () => void;
}) {
  const { run, clear, credential, error, pending } = useCredentialAction();
  const open = action !== null;
  const who = firstName(student.name);

  // A fresh dialog every time it opens; and closing it is what forgets.
  useEffect(() => {
    if (!open) clear();
  }, [open, clear]);

  const close = () => {
    clear();
    onClose();
  };

  const issuing = action === "issue";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="gap-0 p-0 shadow-overlay sm:max-w-md">
        <DialogHeader className="gap-1.5 border-b border-border px-6 pt-5 pb-4">
          <DialogTitle className="pr-8 text-lg font-semibold tracking-tight">
            {credential
              ? `${who}'s sign-in details`
              : issuing
                ? `Issue a login for ${student.name}`
                : `Reset ${student.name}'s password`}
          </DialogTitle>
          <DialogDescription className="leading-relaxed">
            {credential
              ? `Hand these to ${who}. They sign in with the roll number and must choose their own password straight away.`
              : issuing
                ? `${who} will sign in to the student app with roll number ${student.roll_no} and a temporary password, and must choose their own before anything else.`
                : `${who}'s current password stops working at once and they are signed out everywhere. They choose a new one at their next sign-in.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 py-5" aria-live="polite">
          {credential ? (
            <CredentialSlip
              rollNo={credential.roll_no}
              password={credential.temporary_password}
              who={who}
            />
          ) : error ? (
            <CredentialProblem error={error} action={action ?? "issue"} student={student} />
          ) : pending ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              {issuing ? "Issuing the login…" : "Resetting the password…"}
            </p>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">
              The temporary password is shown once, on the next screen. Have{" "}
              {who} with you, or a way to pass it on, before you continue.
            </p>
          )}
        </div>

        <DialogFooter className="m-0 rounded-b-xl border-t border-border bg-muted/30 px-6 py-3.5">
          {credential ? (
            <Button onClick={close}>
              <Check aria-hidden />
              Done
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close}>
                {error ? "Close" : "Cancel"}
              </Button>
              {error && !retryable(error) ? null : (
                <Button
                  disabled={pending}
                  onClick={() => action && void run(action, student.id)}
                >
                  {pending ? <Loader2 aria-hidden className="animate-spin" /> : <KeyRound aria-hidden />}
                  {error ? "Try again" : issuing ? "Issue login" : "Reset password"}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Only a failure that might go differently next time offers a second try. */
function retryable(error: Error): boolean {
  return !(error instanceof ApiError && [403, 409].includes(error.status));
}

function CredentialSlip({
  rollNo,
  password,
  who,
}: {
  rollNo: string;
  password: string;
  who: string;
}) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const passwordId = useId();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  };

  return (
    <div className="space-y-4">
      <dl className="overflow-hidden rounded-lg ring-1 ring-border">
        <div className="flex items-baseline justify-between gap-4 bg-card px-4 py-3">
          <dt className="text-sm text-muted-foreground">Roll number</dt>
          <dd className="tnum text-lg font-semibold text-foreground">{rollNo}</dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border bg-card px-4 py-3">
          <dt id={passwordId} className="text-sm text-muted-foreground">
            Temporary password
          </dt>
          <dd className="flex items-center gap-2">
            {/* Monospace, because this string is copied by hand at a desk:
                1/l and 0/O must not be confused. */}
            <code
              aria-labelledby={passwordId}
              data-temporary-password=""
              className="rounded-sm bg-muted px-2 py-1 font-mono text-lg font-semibold tracking-wide text-foreground select-all"
            >
              {password}
            </code>
            <Button size="sm" variant="outline" onClick={() => void copy()}>
              <Copy aria-hidden />
              Copy
            </Button>
          </dd>
        </div>
      </dl>

      <p role="status" className="min-h-5 text-sm text-muted-foreground">
        {copied === "yes"
          ? "Copied."
          : copied === "failed"
            ? "This browser would not copy it. Select the password and copy it by hand."
            : null}
      </p>

      <p className="flex items-start gap-2 rounded-md bg-status-warn/10 px-3 py-2.5 text-sm leading-relaxed text-foreground ring-1 ring-status-warn/25">
        <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-status-warn" />
        <span>
          <strong className="font-semibold">This password won&rsquo;t be shown again.</strong>{" "}
          It is not stored anywhere it can be read back. If {who} loses it before
          signing in, reset it for a new one.
        </span>
      </p>
    </div>
  );
}

/**
 * The refusals the two routes document, each as a sentence about this student
 * rather than a status code: 403 (not your student), 409 (already has a
 * login, has left, or no login to reset), 429 (too many in a short time).
 */
export function credentialProblem(
  error: Error,
  action: CredentialAction,
  student: Pick<LoginSubject, "name" | "exited_at" | "mentor_name">,
): { title: string; body: string } {
  const who = firstName(student.name);
  const detail = detailOf(error);
  if (error instanceof ApiError) {
    if (error.status === 403) {
      return {
        title: `${student.name} is not one of your students.`,
        body: `Only ${who}'s own mentor${student.mentor_name ? ` (${student.mentor_name})` : ""} or a director can issue or reset this login.`,
      };
    }
    if (error.status === 409) {
      if (action === "reset") {
        return {
          title: `${student.name} has no login yet.`,
          body: "There is nothing to reset. Issue a login first.",
        };
      }
      if (student.exited_at || /left/i.test(detail ?? "")) {
        return {
          title: `${student.name} has left the institute.`,
          body: "A student who has left cannot be given a login.",
        };
      }
      return {
        title: `${student.name} already has a login.`,
        body: "Someone may have issued it a moment ago. To give them a new temporary password, use Reset password instead.",
      };
    }
    if (error.status === 429) {
      return {
        title: "Too many logins issued or reset just now.",
        body: "Wait a minute, then try again.",
      };
    }
    if (error.status === 400 && detail) {
      return { title: "The server refused that password.", body: detail };
    }
  }
  return {
    title: "That did not go through.",
    body: `Nothing was changed. ${error.message}`,
  };
}

function CredentialProblem({
  error,
  action,
  student,
}: {
  error: Error;
  action: CredentialAction;
  student: LoginSubject;
}) {
  const { title, body } = credentialProblem(error, action, student);
  return <Problem title={title}>{body}</Problem>;
}

/* ------------------------------------------------------------------ *
 * The roster: every student, with their login
 * ------------------------------------------------------------------ */

type RosterFilter = "all" | LoginStatus;

const FILTERS: { key: RosterFilter; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "none", label: "No login yet" },
  { key: "awaiting_first_sign_in", label: "Awaiting first sign-in" },
  { key: "active", label: "Signed in" },
];

const FOLD_AT = 12;

/**
 * The director console's roster, for one job: getting every student signed in
 * to their own app. Driven by the whole roster rather than the open flags,
 * because a login is owed to every student, not only the ones the detectors
 * picked out this week.
 */
export function StudentLoginsRoster({ batch }: { batch?: number }) {
  const students = useStudents(batch === undefined ? {} : { batch });
  const [filter, setFilter] = useState<RosterFilter>("all");
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const searchId = useId();

  const rows = students.data ?? [];
  const counts = useMemo(() => {
    const c: Record<RosterFilter, number> = {
      all: rows.length,
      none: 0,
      awaiting_first_sign_in: 0,
      active: 0,
    };
    for (const s of rows) c[s.login_status] += 1;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows
      .filter((s) => (filter === "all" ? true : s.login_status === filter))
      .filter((s) =>
        needle
          ? s.name.toLowerCase().includes(needle) || s.roll_no.toLowerCase().includes(needle)
          : true,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, filter, search]);

  if (students.isPending) return <PanelSkeleton lines={5} />;
  if (students.error) {
    return <ErrorState error={students.error} onRetry={() => void students.refetch()} />;
  }
  if (!rows.length) {
    return (
      <EmptyState
        title="No students on the roster"
        body="Once the institute's students are added, each one can be given a login here."
      />
    );
  }

  const folded = !showAll && visible.length > FOLD_AT + 3;
  const shown = folded ? visible.slice(0, FOLD_AT) : visible;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div
          role="group"
          aria-label="Show students by login"
          className="flex flex-wrap rounded-md border border-border bg-card p-0.5"
        >
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={filter === item.key}
              onClick={() => setFilter(item.key)}
              className={cn(
                "tnum rounded-sm px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                filter === item.key
                  ? "bg-foreground text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label} <span className="opacity-75">{num(counts[item.key])}</span>
            </button>
          ))}
        </div>
        <div className="w-full sm:w-64">
          <Label htmlFor={searchId} className="mb-1.5 text-xs text-muted-foreground">
            Find a student
          </Label>
          <Input
            id={searchId}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name or roll number"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="Nobody matches"
          body={
            filter === "none" && !search
              ? "Every student on the roster has a login."
              : "Try another name, or show everyone."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl bg-card shadow-card ring-1 ring-border">
          <ul aria-label="Students and their logins" className="divide-y divide-border">
            {shown.map((student) => (
              <RosterRow key={student.id} student={student} />
            ))}
          </ul>
          {folded ? (
            <div className="border-t border-border px-5 py-3 text-center">
              <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
                Show all {plural(visible.length, "student")}
                <ChevronDown aria-hidden />
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function RosterRow({ student }: { student: StudentList }) {
  return (
    <li
      data-student-id={student.id}
      className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3"
    >
      <div className="min-w-0 flex-1 basis-56">
        <Link
          to={`/students/${student.id}`}
          className="rounded-sm text-sm font-semibold text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {student.name}
        </Link>
        <div className="tnum mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span>{student.roll_no}</span>
          <span>{student.batch_name}</span>
          <span>{student.mentor_name}</span>
        </div>
      </div>
      <LoginControl student={student} compact />
    </li>
  );
}
