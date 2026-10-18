import { Check } from "lucide-react";
import type { PlanBlock } from "@/api/types";
import { duration, hhmm } from "@/lib/format";
import { resolveSubject } from "@/lib/subjects";
import { cn } from "@/lib/utils";

const MODE_LABEL: Record<string, string> = {
  learn: "Learn",
  practice: "Practice",
  revise: "Revise",
};

/**
 * What the student's own app shows today. A plan a student cannot interrogate
 * is a plan they stop following, so every block carries its reason.
 *
 * `/api/my/plan/` is scoped to the signed-in student, not to a student id — so
 * a mentor signed in against the live API gets an empty list here rather than
 * this student's plan. That is the endpoint working as specified, not the panel
 * failing, and the empty state says so rather than implying no plan exists.
 */
export function DayPlanPanel({ blocks }: { blocks: PlanBlock[] }) {
  const total = blocks.reduce((acc, block) => acc + block.minutes, 0);
  const done = blocks.filter((b) => b.completed).length;

  return (
    <section className="rounded-xl border border-border bg-card shadow-xs">
      <header className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-border px-6 py-4">
        <h2 className="text-base font-semibold tracking-tight">
          Today&rsquo;s plan, as the student sees it
        </h2>
        <span className="tnum ml-auto flex gap-x-4 text-sm text-muted-foreground">
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
            <li key={block.id} className="flex gap-4 px-6 py-4">
              <div className="tnum w-14 shrink-0 pt-0.5 text-sm text-muted-foreground">
                {hhmm(block.start_time)}
              </div>

              <span
                aria-hidden
                className="mt-1.5 h-[calc(100%-6px)] w-1 shrink-0 rounded-[1px]"
                style={{ background: subject.color }}
              />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
                  <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
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
                  <p className="mt-1 text-sm leading-snug text-muted-foreground">
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
