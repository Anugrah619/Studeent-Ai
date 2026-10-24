import { Check, Smartphone } from "lucide-react";
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
 * A day plan, every block with its reason — a plan a student cannot
 * interrogate is a plan he stops following.
 *
 * Labelled a seeded example, because that is all it is today: nothing
 * generates plans (`seed_demo.py` writes them, with canned reasons) and there
 * is no student app to serve them to (TECHNICAL_DOC.md: "Student-facing app ·
 * planner" are not built). In mock mode `/api/my/plan/` also returns the one
 * fixture plan whichever student is open, so it must never be captioned as
 * this student's own.
 *
 * `/api/my/plan/` is scoped to the signed-in student, not to a student id — so
 * a mentor signed in against the live API gets an empty list here rather than
 * this student's plan. That is the endpoint working as specified, not the panel
 * failing, and the empty state says so rather than implying no plan exists.
 */
export function DayPlanPanel({ blocks }: { blocks: PlanBlock[] }) {
  if (!blocks.length) {
    return (
      <EmptyState
        icon={<Smartphone aria-hidden className="size-5" />}
        title="No plan to show from this sign-in"
        body="The plan route answers for whoever is signed in, and a mentor's sign-in has no plan of its own — so this is not a sign that the student has none. Plans are seeded examples today; nothing generates them yet."
      />
    );
  }

  const total = blocks.reduce((acc, block) => acc + block.minutes, 0);
  const done = blocks.filter((b) => b.completed).length;

  return (
    <section
      aria-label="Sample day plan, a seeded example"
      className="overflow-hidden rounded-xl bg-card shadow-card ring-1 ring-border"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <Smartphone aria-hidden className="size-4 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Sample day plan</p>
        <span className="rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground ring-1 ring-border">
          Seeded example
        </span>
        <span className="tnum ml-auto flex gap-x-4 text-xs text-muted-foreground">
          <span>{done} of {blocks.length} done</span>
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
