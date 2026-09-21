import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import type { Flag } from "@/api/types";
import {
  useFlags,
  useMockScores,
  usePlan,
  useStudent,
  useSubjectBreakdown,
  useTopicStates,
} from "@/api/queries";
import { HealthHeader } from "@/components/student/HealthHeader";
import { TopicMasteryGrid } from "@/components/student/TopicMasteryGrid";
import { StudentFlagsPanel } from "@/components/student/StudentFlagsPanel";
import { DayPlanPanel } from "@/components/student/DayPlanPanel";
import { MockTrendChart } from "@/components/charts/MockTrendChart";
import { NeglectChart } from "@/components/charts/NeglectChart";
import { InterveneDialog } from "@/components/director/InterveneDialog";
import { ErrorState, PanelSkeleton } from "@/components/common/States";
import { Skeleton } from "@/components/ui/skeleton";

export function Student360() {
  const params = useParams();
  const id = Number(params.id);
  const [target, setTarget] = useState<Flag | null>(null);

  const student = useStudent(id);
  const scores = useMockScores(id);
  const breakdown = useSubjectBreakdown(id);
  const topics = useTopicStates(id);
  const plan = usePlan();
  // `/api/flags/` takes no `student` filter, so the page fetches the open set
  // and narrows it here (API_GAPS.FLAGS_STUDENT_FILTER).
  const flags = useFlags(true);

  const studentFlags = useMemo(
    () => (flags.data ?? []).filter((flag) => flag.student_id === id),
    [flags.data, id],
  );

  if (student.error) {
    return (
      <div className="py-6">
        <ErrorState error={student.error} onRetry={() => student.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-8 py-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ChevronLeft aria-hidden className="size-3.5" />
        Director console
      </Link>

      {student.isPending || !student.data ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        </div>
      ) : (
        <HealthHeader student={student.data} scores={scores.data ?? []} />
      )}

      <section className="grid gap-4 xl:grid-cols-2">
        {scores.isPending ? (
          <PanelSkeleton lines={7} />
        ) : scores.data?.length ? (
          <MockTrendChart rows={scores.data} />
        ) : (
          <PanelSkeleton lines={7} />
        )}

        {breakdown.isPending ? (
          <PanelSkeleton lines={5} />
        ) : breakdown.data?.length ? (
          <NeglectChart rows={breakdown.data} />
        ) : (
          <PanelSkeleton lines={5} />
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Open flags</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Each one shows the evidence that raised it. Nothing fires on a single
            bad day.
          </p>
        </div>
        {flags.isPending ? (
          <PanelSkeleton lines={4} />
        ) : (
          <StudentFlagsPanel flags={studentFlags} onIntervene={setTarget} />
        )}
      </section>

      {topics.isPending ? (
        <PanelSkeleton lines={8} />
      ) : (
        <TopicMasteryGrid states={topics.data ?? []} />
      )}

      {plan.isPending ? (
        <PanelSkeleton lines={6} />
      ) : plan.data?.length ? (
        <DayPlanPanel blocks={plan.data} />
      ) : null}

      <InterveneDialog
        flag={target}
        open={target !== null}
        onOpenChange={(next) => !next && setTarget(null)}
      />
    </div>
  );
}
