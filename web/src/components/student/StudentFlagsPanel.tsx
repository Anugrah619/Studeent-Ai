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
          className="flex flex-col rounded-xl border border-border bg-card p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <SeverityChip severity={flag.severity} />
            <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {detectorLabel(flag.type)}
            </span>
            <span className="ml-auto text-[11px] text-muted-foreground">
              {daysAgo(flag.raised_at)}
            </span>
          </div>

          <p className="mt-2 text-sm leading-snug text-foreground">{flag.headline}</p>

          <div className="mt-3 flex-1">
            <EvidenceList evidence={flag.evidence} />
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="truncate text-[11px] text-muted-foreground">
              {flag.topic_name} · {flag.mentor_name}
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
