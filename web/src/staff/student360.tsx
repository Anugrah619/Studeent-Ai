import { useId, useMemo, useState, type ReactNode } from "react";
import { AlarmClock, ChevronLeft, ChevronRight } from "lucide-react";
import type { StudentDetail } from "@/api/types";
import {
  todayIso,
  useConfidenceHistory,
  useFadingTopics,
  useRevisions,
  useStudentPlan,
  useStudyLogs,
} from "@/api/staff";
import { Bubble } from "@/components/brand/Bubble";
import { ErrorState, PanelSkeleton } from "@/components/common/States";
import { DayPlanPanel } from "@/components/student/DayPlanPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { firstName } from "@/lib/explainer";
import { duration, longDate, num, pct, shortDate } from "@/lib/format";
import { resolveSubject } from "@/lib/subjects";
import { MiniPanel, plural } from "./common";

/* ------------------------------------------------------------------ *
 * The day plan, for any day
 * ------------------------------------------------------------------ */

function shiftDay(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return todayIso(new Date(y, m - 1, d + days));
}

/** "today", "tomorrow", "yesterday", or "on 26 Oct 2026". */
export function dayWords(iso: string, today = todayIso()): string {
  if (iso === today) return "today";
  if (iso === shiftDay(today, 1)) return "tomorrow";
  if (iso === shiftDay(today, -1)) return "yesterday";
  return `on ${longDate(`${iso}T12:00:00`)}`;
}

/**
 * The student's real plan, read by student id
 * (`GET /api/students/{id}/plan/?date=`), with a day picker: a mentor asking
 * "what did she have on yesterday?" is as common as "what is she doing today?".
 */
export function StudentDayPlan({ studentId, name }: { studentId: number; name: string }) {
  const [date, setDate] = useState(() => todayIso());
  const plan = useStudentPlan(studentId, date);
  const who = firstName(name);
  const inputId = useId();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor={inputId} className="mb-1.5 text-xs text-muted-foreground">
            Day
          </Label>
          <Input
            id={inputId}
            type="date"
            value={date}
            onChange={(event) => event.target.value && setDate(event.target.value)}
            className="w-44"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous day"
          onClick={() => setDate((d) => shiftDay(d, -1))}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Next day"
          onClick={() => setDate((d) => shiftDay(d, 1))}
        >
          <ChevronRight aria-hidden />
        </Button>
        {date !== todayIso() ? (
          <Button variant="ghost" onClick={() => setDate(todayIso())}>
            Today
          </Button>
        ) : null}
      </div>

      {plan.isPending ? (
        <PanelSkeleton lines={6} />
      ) : plan.error ? (
        <ErrorState error={plan.error} onRetry={() => void plan.refetch()} />
      ) : (
        <DayPlanPanel blocks={plan.data ?? []} who={who} day={dayWords(date)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The compact panels
 * ------------------------------------------------------------------ */

/**
 * What the student does between mocks, in five small panels: what they said
 * at onboarding, what they log, how sure they say they are, the revisions the
 * system has scheduled, and the chapters they are forgetting.
 */
export function StudentActivity({ student }: { student: StudentDetail }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <OnboardingPanel student={student} />
      <StudyLogPanel studentId={student.id} />
      <ConfidencePanel studentId={student.id} />
      <RevisionsPanel studentId={student.id} />
      <FadingPanel studentId={student.id} />
    </div>
  );
}

const ROWS = 6;

function PanelState({
  pending,
  error,
  retry,
  empty,
  emptyText,
  children,
}: {
  pending: boolean;
  error: Error | null;
  retry: () => void;
  empty: boolean;
  emptyText: string;
  children: ReactNode;
}) {
  if (pending) {
    return (
      <div aria-hidden className="space-y-2.5 px-5 py-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-4" style={{ width: `${90 - i * 18}%` }} />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-3">
        <ErrorState error={error} onRetry={retry} className="shadow-none" />
      </div>
    );
  }
  if (empty) {
    return <p className="px-5 py-4 text-sm leading-relaxed text-muted-foreground">{emptyText}</p>;
  }
  return <>{children}</>;
}

/** The two things the student owns at onboarding. Null is "not set yet", never 0. */
export function OnboardingPanel({ student }: { student: StudentDetail }) {
  const who = firstName(student.name);
  const id = useId();
  return (
    <MiniPanel
      title="Onboarding answers"
      labelId={id}
      meta={student.onboarded_at ? `answered ${shortDate(student.onboarded_at)}` : "not answered"}
    >
      <dl className="divide-y divide-border">
        <div className="flex items-baseline justify-between gap-4 px-5 py-3">
          <dt className="text-sm text-muted-foreground">Can study a day</dt>
          <dd className="tnum text-sm font-semibold text-foreground">
            {student.daily_minutes == null ? (
              <span className="font-normal text-muted-foreground">Not set yet</span>
            ) : (
              duration(student.daily_minutes)
            )}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 px-5 py-3">
          <dt className="text-sm text-muted-foreground">Aiming for rank</dt>
          <dd className="tnum text-sm font-semibold text-foreground">
            {student.target_rank == null ? (
              <span className="font-normal text-muted-foreground">Not set yet</span>
            ) : (
              num(student.target_rank)
            )}
          </dd>
        </div>
      </dl>
      {student.onboarded_at ? null : (
        <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-muted-foreground">
          {who} answers these the first time they sign in to their own app.
        </p>
      )}
    </MiniPanel>
  );
}

const MODE: Record<string, string> = { learn: "Learn", practice: "Practice", revise: "Revise" };

/** Self-reported, so the least reliable data on the page — and labelled so. */
export function StudyLogPanel({ studentId }: { studentId: number }) {
  const logs = useStudyLogs(studentId);
  const id = useId();
  const rows = logs.data ?? [];
  const week = useMemo(() => {
    const since = Date.now() - 7 * 86_400_000;
    return rows
      .filter((row) => Date.parse(row.ts) >= since)
      .reduce((acc, row) => acc + row.minutes, 0);
  }, [rows]);

  return (
    <MiniPanel
      title="Study log"
      labelId={id}
      meta={logs.data ? `${duration(week)} in the last 7 days` : undefined}
    >
      <PanelState
        pending={logs.isPending}
        error={logs.error}
        retry={() => void logs.refetch()}
        empty={!rows.length}
        emptyText="Nothing logged yet. Students log their own study sessions in their app."
      >
        <ul className="divide-y divide-border">
          {rows.slice(0, ROWS).map((row) => (
            <li key={row.id} className="flex items-baseline gap-3 px-5 py-2.5">
              <span className="tnum w-14 shrink-0 text-xs text-muted-foreground">
                {shortDate(row.ts)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {row.topic_name}
              </span>
              <span className="tnum shrink-0 text-xs text-muted-foreground">
                {MODE[row.mode] ?? row.mode}, {duration(row.minutes)}
              </span>
            </li>
          ))}
        </ul>
        <p className="border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
          {plural(rows.length, "session")} logged in all. Self-reported.
        </p>
      </PanelState>
    </MiniPanel>
  );
}

/**
 * The student's own ratings, newest first. Drawn as the five-step bubble row a
 * rating is — a judgement about an option, so round.
 */
export function ConfidencePanel({ studentId }: { studentId: number }) {
  const ratings = useConfidenceHistory(studentId);
  const id = useId();
  const rows = ratings.data ?? [];
  return (
    <MiniPanel
      title="Confidence history"
      labelId={id}
      meta={ratings.data ? plural(rows.length, "rating") : undefined}
    >
      <PanelState
        pending={ratings.isPending}
        error={ratings.error}
        retry={() => void ratings.refetch()}
        empty={!rows.length}
        emptyText="No ratings yet. Students rate how sure they feel about a chapter in their app."
      >
        <ul className="divide-y divide-border">
          {rows.slice(0, ROWS).map((row) => (
            <li key={row.id} className="flex items-center gap-3 px-5 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {row.topic_name}
              </span>
              <span className="flex shrink-0 items-center gap-0.5" aria-hidden>
                {[1, 2, 3, 4, 5].map((step) => (
                  <Bubble key={step} size="xs" filled={step <= row.self_rating} />
                ))}
              </span>
              <span className="tnum w-24 shrink-0 text-right text-xs text-muted-foreground">
                {row.self_rating}/5, {shortDate(row.ts)}
              </span>
            </li>
          ))}
        </ul>
      </PanelState>
    </MiniPanel>
  );
}

/** Scheduled revision cycles not yet done, overdue first. */
export function RevisionsPanel({ studentId }: { studentId: number }) {
  const revisions = useRevisions(studentId);
  const id = useId();
  const rows = revisions.data ?? [];
  const overdue = rows.filter((r) => r.is_overdue).length;
  return (
    <MiniPanel
      title="Revision schedule"
      labelId={id}
      meta={revisions.data ? `${num(overdue)} overdue of ${num(rows.length)}` : undefined}
    >
      <PanelState
        pending={revisions.isPending}
        error={revisions.error}
        retry={() => void revisions.refetch()}
        empty={!rows.length}
        emptyText="Nothing scheduled. A revision is booked automatically after a chapter is first studied, attempted or taught."
      >
        <ul className="divide-y divide-border">
          {rows.slice(0, ROWS).map((row) => (
            <li key={row.id} className="flex items-baseline gap-3 px-5 py-2.5">
              <span className="tnum w-7 shrink-0 text-xs font-semibold text-muted-foreground">
                R{row.cycle}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">{row.topic.name}</span>
                <span className="text-xs text-muted-foreground">
                  {resolveSubject(row.topic.subject).label}
                </span>
              </span>
              {row.is_overdue ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-status-warn">
                  <AlarmClock aria-hidden className="size-3.5" />
                  Overdue since {shortDate(row.scheduled_for)}
                </span>
              ) : (
                <span className="tnum shrink-0 text-xs text-muted-foreground">
                  Due {shortDate(row.scheduled_for)}
                </span>
              )}
            </li>
          ))}
        </ul>
        {rows.length > ROWS ? (
          <p className="border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
            {plural(rows.length - ROWS, "more cycle")} after these.
          </p>
        ) : null}
      </PanelState>
    </MiniPanel>
  );
}

/**
 * Chapters whose forecast recall has fallen below one half — the forgetting
 * curve, not a mastery score. A chapter never seen has no forecast and is not
 * listed (the server excludes it), so nothing here is a guess dressed as 0%.
 */
export function FadingPanel({ studentId }: { studentId: number }) {
  const fading = useFadingTopics(studentId);
  const id = useId();
  const rows = fading.data ?? [];
  return (
    <MiniPanel
      title="Fading chapters"
      labelId={id}
      meta={fading.data ? `${num(rows.length)} below half recall` : undefined}
    >
      <PanelState
        pending={fading.isPending}
        error={fading.error}
        retry={() => void fading.refetch()}
        empty={!rows.length}
        emptyText="No chapter is forecast below half recall. Recall is forecast from when each chapter was last seen or revised."
      >
        <ul className="divide-y divide-border">
          {rows.slice(0, ROWS).map((row) => (
            <li key={row.id} className="flex items-baseline gap-3 px-5 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">{row.topic.name}</span>
                <span className="text-xs text-muted-foreground">
                  {resolveSubject(row.topic.subject).label}
                  {row.last_seen ? `, last seen ${shortDate(row.last_seen)}` : ""}
                </span>
              </span>
              <span className="tnum shrink-0 text-sm font-semibold text-foreground">
                {row.retention == null ? "—" : pct(row.retention * 100)}
                <span className="sr-only"> forecast recall</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
          Forecast recall today, weakest first.
        </p>
      </PanelState>
    </MiniPanel>
  );
}
