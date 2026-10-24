import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { Flag } from "@/api/types";
import { useIntervene, useStudent } from "@/api/queries";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SeverityChip } from "@/components/common/SeverityChip";
import { EvidenceList } from "./EvidenceList";
import { daysAgo, longDate } from "@/lib/format";
import { detectorLabel } from "@/lib/severity";
import { cn } from "@/lib/utils";

const QUICK_ACTIONS = [
  "Called the parent",
  "1:1 scheduled with mentor",
  "Moved to the remedial Chemistry slot",
  "Assigned a targeted drill set",
  "Reduced weekly load",
];

/**
 * Logging what the mentor did is half of closing the risk loop — a console
 * that only raises flags produces a list nobody is accountable for.
 *
 * It is only half. `POST /intervene/` records the action and deliberately
 * leaves the flag open: picking up the phone is not the student recovering,
 * and the outcome is a separate judgement made weeks later. This dialog used
 * to promise "this closes the flag", which the server has never done.
 */
export function InterveneDialog({
  flag,
  open,
  onOpenChange,
}: {
  flag: Flag | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [action, setAction] = useState("");
  const intervene = useIntervene();
  // The contract requires a mentor id on the request body but exposes no mentor
  // list; the student detail is the only place one is reachable.
  const student = useStudent(flag?.student_id ?? Number.NaN);

  useEffect(() => {
    if (open) {
      setAction("");
      intervene.reset();
    }
    // `intervene` is a stable mutation object from React Query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, flag?.id]);

  if (!flag) return null;

  const mentorId = student.data?.mentor.id;
  const busy = intervene.isPending || student.isLoading;
  // The server's own record of what was logged, not the form's contents.
  const logged = intervene.isSuccess ? intervene.data : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A touch slower than the primitive's 100 ms, so the dialog reads as
          arriving in place rather than blinking on. */}
      <DialogContent className="gap-0 p-0 shadow-overlay duration-200 sm:max-w-lg">
        <DialogHeader className="gap-0 border-b border-border px-6 pt-5 pb-4">
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <SeverityChip severity={flag.severity} />
            <span className="text-xs text-muted-foreground">
              {detectorLabel(flag.type)}, rule {flag.rule_version ?? "—"}
            </span>
          </div>
          <DialogTitle className="mt-3 font-heading text-lg leading-snug font-semibold tracking-tight">
            {flag.student_name}
            <span className="font-normal text-muted-foreground">, {flag.batch_name}</span>
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm leading-relaxed text-foreground">
            {flag.headline}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60dvh] space-y-5 overflow-y-auto px-6 py-5">
          <div>
            <h4 className="mb-2.5 text-xs font-medium text-muted-foreground">
              Evidence on {flag.topic_name}, raised {daysAgo(flag.raised_at)} (
              {longDate(flag.raised_at)})
            </h4>
            <div className="rounded-lg bg-muted/40 px-3.5 py-3 ring-1 ring-border/70">
              <EvidenceList evidence={flag.evidence} />
            </div>
          </div>

          {logged ? (
            <div
              role="status"
              className="flex items-start gap-3 rounded-lg bg-muted/40 px-3.5 py-3 ring-1 ring-border/70"
            >
              <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-status-good" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Logged: {logged.action}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Recorded against {logged.mentor_name}, {longDate(logged.taken_at)}.
                  The flag stays open on the list: logging what was done does not
                  close it.
                </p>
              </div>
            </div>
          ) : (
            <div>
              <Label htmlFor="intervention-action" className="text-sm font-medium">
                What did you do?
              </Label>
              <Textarea
                id="intervention-action"
                value={action}
                onChange={(event) => setAction(event.target.value)}
                placeholder="e.g. Called the parent; moved Aarav into the 6pm Chemistry remedial from Monday."
                rows={3}
                className="mt-2"
              />
              <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Quick actions" role="group">
                {QUICK_ACTIONS.map((quick) => (
                  <button
                    key={quick}
                    type="button"
                    aria-pressed={action === quick}
                    onClick={() => setAction(quick)}
                    className={cn(
                      "rounded-sm border px-2.5 py-1.5 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      action === quick
                        ? "border-foreground/25 bg-muted font-medium text-foreground"
                        : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {quick}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Logged under your account, with today&rsquo;s date — the server
                records whoever is signed in. Recording what was done is not the student
                recovering: whether it worked is judged separately, once the outcome
                is known.
              </p>
            </div>
          )}

          {intervene.isError ? (
            <p
              role="alert"
              className="rounded-md border border-status-critical/30 bg-status-critical/5 px-3 py-2 text-xs text-foreground"
            >
              Could not log that: {intervene.error.message}
            </p>
          ) : null}
        </div>

        <DialogFooter className="m-0 rounded-b-xl border-t border-border bg-muted/30 px-6 py-3.5">
          {logged ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                disabled={!action.trim() || busy || mentorId === undefined}
                onClick={() => {
                  if (mentorId === undefined) return;
                  // The dialog stays open on success to say what happened. Closing
                  // on its own left the row unchanged with no word of whether
                  // anything was recorded — and the row *should* stay, which is
                  // exactly the part that needs saying.
                  intervene.mutate({
                    flagId: flag.id,
                    body: { flag: flag.id, mentor: mentorId, action },
                  });
                }}
              >
                {intervene.isPending ? (
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                ) : (
                  <Check aria-hidden className="size-4" />
                )}
                Log intervention
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
