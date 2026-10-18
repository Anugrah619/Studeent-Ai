import type { Flag } from "@/api/types";
import { Button } from "@/components/ui/button";
import { SeverityChip } from "@/components/common/SeverityChip";
import { EmptyState } from "@/components/common/States";
import { EvidenceList } from "@/components/director/EvidenceList";
import { daysAgo } from "@/lib/format";
import { detectorLabel } from "@/lib/severity";

export function StudentFlagsPanel({
  flags,
  onIntervene,
}: {
  flags: Flag[];
  onIntervene: (flag: Flag) => void;
}) {
  if (!flags.length) {
    return (
      <EmptyState
        title="No open flags"
        body="Nothing currently meets a detector's evidence bar for this student."
      />
    );
  }

  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {flags.map((flag) => (
        <li
          key={flag.id}
          className="flex flex-col rounded-xl bg-card p-4 shadow-card ring-1 ring-border sm:p-5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <SeverityChip severity={flag.severity} />
            <span className="text-sm text-muted-foreground">{detectorLabel(flag.type)}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {daysAgo(flag.raised_at)}
            </span>
          </div>

          <p className="mt-2.5 text-sm leading-snug font-medium text-foreground">
            {flag.headline}
          </p>

          <div className="mt-3 flex-1">
            <EvidenceList evidence={flag.evidence} />
          </div>

          <div className="mt-4 flex items-center justify-between gap-2">
            <span className="flex min-w-0 flex-wrap gap-x-3 text-xs text-muted-foreground">
              <span className="truncate">{flag.topic_name}</span>
              <span className="truncate">{flag.mentor_name}</span>
            </span>
            <Button size="sm" variant="outline" onClick={() => onIntervene(flag)}>
              Log intervention
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
