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

const QUICK_ACTIONS = [
  "Called the parent",
  "1:1 scheduled with mentor",
  "Moved to the remedial Chemistry slot",
  "Assigned a targeted drill set",
  "Reduced weekly load",
];

/**
 * Logging what the mentor did is what closes the risk loop — a console that
 * only raises flags produces a list nobody is accountable for.
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <SeverityChip severity={flag.severity} />
            <span className="text-[11px] text-muted-foreground">
              {detectorLabel(flag.type)} · rule {flag.rule_version ?? "—"}
            </span>
          </div>
          <DialogTitle className="mt-1 text-base">
            {flag.student_name} · {flag.batch_name}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-foreground">
            {flag.headline}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <h4 className="mb-2 text-xs font-medium text-muted-foreground">
              Evidence · {flag.topic_name} · raised {daysAgo(flag.raised_at)} (
              {longDate(flag.raised_at)})
            </h4>
            <EvidenceList evidence={flag.evidence} />
          </div>

          <div>
            <Label htmlFor="intervention-action" className="text-xs">
              What did you do?
            </Label>
            <Textarea
              id="intervention-action"
              value={action}
              onChange={(event) => setAction(event.target.value)}
              placeholder="e.g. Called the parent; moved Aarav into the 6pm Chemistry remedial from Monday."
              rows={3}
              className="mt-1.5"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK_ACTIONS.map((quick) => (
                <button
                  key={quick}
                  type="button"
                  onClick={() => setAction(quick)}
                  className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {quick}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Logged against {student.data?.mentor.name ?? flag.mentor_name}. This
              closes the flag and starts the recovery clock.
            </p>
          </div>

          {intervene.isError ? (
            <p role="alert" className="text-xs text-status-critical">
              Could not log that: {intervene.error.message}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!action.trim() || busy || mentorId === undefined}
            onClick={() => {
              if (mentorId === undefined) return;
              intervene.mutate(
                { flagId: flag.id, body: { flag: flag.id, mentor: mentorId, action } },
                { onSuccess: () => onOpenChange(false) },
              );
            }}
          >
            {intervene.isPending ? (
              <Loader2 aria-hidden className="size-4 animate-spin" />
            ) : (
              <Check aria-hidden className="size-4" />
            )}
            Log intervention
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
