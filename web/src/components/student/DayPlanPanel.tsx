import { Check, Smartphone } from "lucide-react";
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
 * is a plan he stops following, so every block carries its reason.
 *
 * `/api/my/plan/` is scoped to the signed-in student, not to a student id, so
 * this panel is the demo account's plan — see API_GAPS.NO_SESSION_ENDPOINT.
 */
export function DayPlanPanel({ blocks }: { blocks: PlanBlock[] }) {
  const total = blocks.reduce((acc, block) => acc + block.minutes, 0);
  const done = blocks.filter((b) => b.completed).length;

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <Smartphone aria-hidden className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold tracking-tight">
          Today&rsquo;s plan, as the student sees it
        </h2>
        <span className="tnum ml-auto text-[11px] text-muted-foreground">
          {done} of {blocks.length} done · {duration(total)} scheduled
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
                className="mt-1.5 h-[calc(100%-6px)] w-1 shrink-0 rounded-full"
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
                  <span className="rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground">
                    {MODE_LABEL[block.mode] ?? block.mode}
                  </span>
                  <span className="tnum text-[11px] text-muted-foreground">
                    {duration(block.minutes)}
                  </span>
                  {block.completed ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-status-good">
                      <Check aria-hidden className="size-3" />
                      Done
                    </span>
                  ) : null}
                </div>
                {block.reason_text ? (
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
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
