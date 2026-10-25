import { CalendarDays, Check } from "lucide-react";
import type { PlanBlock } from "@/api/types";
import { EmptyState } from "@/components/common/States";
import { duration, hhmm } from "@/lib/format";
import { resolveSubject } from "@/lib/subjects";
import { cn } from "@/lib/utils";

const MODE_LABEL: Record<string, string> = {
  learn: "Learn",
  practice: "Practice",
  revise: "Revise",
};

/**
 * One student's plan for one day, every block with its reason — a plan a
 * student cannot interrogate is a plan he stops following.
 *
 * Fed by `GET /api/students/{id}/plan/?date=` (see `StudentDayPlan` in
 * `staff/student360.tsx`). It used to be fed by `/api/my/plan/`, which answers
 * for whoever is signed in — so a mentor always saw an empty panel, and the
 * panel had to explain that away. The plan is the student's real one now: the
 * nightly refresh makes it, or the student makes it from their own app.
 *
 * The reasons are written to the student ("you know this"), and are shown as
 * they were written: this is what the student reads on their phone.
 */
export function DayPlanPanel({
  blocks,
  who,
  day,
}: {
  blocks: PlanBlock[];
  /** First name, for the empty state. */
  who: string;
  /** "today", or "on 26 Oct 2026". */
  day: string;
}) {
  if (!blocks.length) {
    return (
      <EmptyState
        icon={<CalendarDays aria-hidden className="size-5" />}
        title={`No plan for ${who} ${day}`}
        body={`The nightly refresh makes a plan for each active student, and ${who} can make one from their own app. Nothing has been planned for this day yet.`}
      />
    );
  }

  const total = blocks.reduce((acc, block) => acc + block.minutes, 0);
  const done = blocks.filter((b) => b.completed).length;

  return (
    <section
      aria-label={`${who}'s plan ${day}`}
      className="overflow-hidden rounded-xl bg-card shadow-card ring-1 ring-border"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <CalendarDays aria-hidden className="size-4 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          {who}&rsquo;s plan {day}
        </p>
        <span className="tnum ml-auto flex gap-x-4 text-xs text-muted-foreground">
          <span>
            {done} of {blocks.length} done
          </span>
          <span>{duration(total)} scheduled</span>
        </span>
      </header>

      <ol className="divide-y divide-border">
        {blocks.map((block) => {
          const subject = resolveSubject(block.subject);
          return (
            <li key={block.id} className="flex gap-3 px-5 py-3">
              <div className="tnum w-12 shrink-0 pt-0.5 text-xs text-muted-foreground">
                {hhmm(block.start_time)}
              </div>

              <span
                aria-hidden
                className="mt-1 w-1 shrink-0 self-stretch rounded-[1px]"
                style={{ background: subject.color }}
              />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "text-sm font-medium",
                      block.completed
                        ? "text-muted-foreground line-through"
                        : "text-foreground",
                    )}
                  >
                    {block.topic_name}
                  </span>
                  <span className="text-xs text-muted-foreground">{subject.label}</span>
                  <span className="rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground ring-1 ring-border">
                    {MODE_LABEL[block.mode] ?? block.mode}
                  </span>
                  <span className="tnum text-xs text-muted-foreground">
                    {duration(block.minutes)}
                  </span>
                  {block.completed ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-status-good">
                      <Check aria-hidden className="size-3.5" />
                      Done
                    </span>
                  ) : null}
                </div>
                {block.reason_text ? (
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                    {block.reason_text}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
