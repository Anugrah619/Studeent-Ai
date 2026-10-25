import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import type { Flag } from "@/api/types";
import {
  useFlags,
  useMockScores,
  useStudent,
  useSubjectBreakdown,
  useTopicStates,
} from "@/api/queries";
import {
  HealthKpis,
  HealthKpisSkeleton,
  StudentHeader,
  StudentHeaderSkeleton,
} from "@/components/student/HealthHeader";
import { DiagnosisCard } from "@/components/student/DiagnosisCard";
import { TopicMasteryGrid } from "@/components/student/TopicMasteryGrid";
import { StudentFlagsPanel } from "@/components/student/StudentFlagsPanel";
import { MockTrendChart } from "@/components/charts/MockTrendChart";
import { NeglectChart } from "@/components/charts/NeglectChart";
import { InterveneDialog } from "@/components/director/InterveneDialog";
import { Section } from "@/components/kit/Section";
import { ErrorState, PanelSkeleton } from "@/components/common/States";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { firstName } from "@/lib/explainer";
import { LoginControl } from "@/staff/logins";
import { StudentActivity, StudentDayPlan } from "@/staff/student360";

/**
 * Student 360, read top to bottom as three answers:
 *
 *   1  what does this student misunderstand?   the AI diagnosis, as the hero
 *   2  how are they doing overall?             four cards and two charts
 *   3  what else is going on?                  flags, chapters, today's plan
 *
 * The diagnosis earns the top because it is the only thing on the page that
 * says what to *do*; everything below it reports what happened.
 */
export function Student360() {
  const params = useParams();
  const id = Number(params.id);
  const [target, setTarget] = useState<Flag | null>(null);

  const student = useStudent(id);
  const scores = useMockScores(id);
  const breakdown = useSubjectBreakdown(id);
  const topics = useTopicStates(id);
  // `?student=` and `?open=` are both declared now, so this asks the server for
  // one student's open flags instead of pulling all 81 in the institute and
  // narrowing in the browser — which, past `PAGE_SIZE 50`, meant following a
  // second page to find rows that were never going to be on this screen.
  const flags = useFlags({ open: true, student: id });
  const studentFlags = flags.data ?? [];

  /**
   * The diagnosis is per-paper, and the paper a director cares about is the
   * one just sat. `mock-scores/` is ordered by `held_on` (a contract guarantee), so the last row
   * is the latest mock — the same paper the "Where the marks went" screen
   * opens on.
   */
  const latestMock = scores.data?.at(-1);
  const name = student.data ? firstName(student.data.name) : "this student";

  if (student.error) {
    return (
      <div className="py-6">
        <ErrorState error={student.error} onRetry={() => student.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-10 py-6">
      <div className="space-y-5">
        <Link
          to="/"
          className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft aria-hidden className="size-4" />
          Director console
        </Link>

        {student.isPending || !student.data ? (
          <StudentHeaderSkeleton />
        ) : (
          <>
            <StudentHeader student={student.data} latest={latestMock} />
            {/* Whether this student can sign in to their own app, and the one
                action that moves it on. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <span className="text-muted-foreground">Student app login</span>
              <LoginControl
                student={{
                  id: student.data.id,
                  name: student.data.name,
                  roll_no: student.data.roll_no,
                  login_status: student.data.login_status,
                  exited_at: student.data.exited_at,
                  mentor_name: student.data.mentor.name,
                }}
              />
            </div>
          </>
        )}

        <DiagnosisCard
          studentId={id}
          studentName={student.data?.name ?? "this student"}
          paperId={latestMock?.paper_id}
          paperName={latestMock?.paper_name}
          paperPending={scores.isPending || student.isPending}
        />
      </div>

      <Section
        title={`How ${name} is doing overall`}
        description="Across every mock in the series — not just the paper diagnosed above."
      >
        {student.isPending || !student.data ? (
          <HealthKpisSkeleton />
        ) : (
          <HealthKpis student={student.data} scores={scores.data ?? []} />
        )}

        <div className="mt-6 grid gap-4 xl:grid-cols-2">
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
        </div>
      </Section>

      <Section
        title={`What ${name} does between mocks`}
        description="Their own answers at onboarding, the study they log, how sure they say they are, the revisions the system has booked, and the chapters they are starting to forget."
      >
        {student.isPending || !student.data ? (
          <PanelSkeleton lines={4} />
        ) : (
          <StudentActivity student={student.data} />
        )}
      </Section>

      <Section
        title="Behind the numbers"
        description="The open flags, with the evidence recorded for each and what was done about them; every chapter's mastery; and the day's plan."
      >
        {/* Every panel stays mounted (`forceMount`) and is only hidden when
            inactive, so a filter set in one tab survives a visit to another
            and the page's text is all there for find-in-page. */}
        <Tabs defaultValue="flags" className="gap-4">
          <TabsList className="h-9 max-w-full overflow-x-auto">
            <TabsTrigger value="flags" className="px-3">
              Open flags
              {flags.data ? (
                <span className="tnum rounded-sm bg-muted px-1.5 text-xs font-semibold text-muted-foreground ring-1 ring-border">
                  {studentFlags.length}
                </span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="mastery" className="px-3">
              Topic mastery
            </TabsTrigger>
            <TabsTrigger value="plan" className="px-3">
              Day plan
            </TabsTrigger>
          </TabsList>

          <TabsContent value="flags" forceMount className="data-[state=inactive]:hidden">
            <p className="mb-3 text-sm text-muted-foreground">
              Each one shows the evidence recorded for it.
            </p>
            {flags.isPending ? (
              <PanelSkeleton lines={4} />
            ) : (
              <StudentFlagsPanel flags={studentFlags} onIntervene={setTarget} />
            )}
          </TabsContent>

          <TabsContent value="mastery" forceMount className="data-[state=inactive]:hidden">
            {topics.isPending ? (
              <PanelSkeleton lines={8} />
            ) : (
              <TopicMasteryGrid states={topics.data ?? []} />
            )}
          </TabsContent>

          <TabsContent value="plan" forceMount className="data-[state=inactive]:hidden">
            <StudentDayPlan studentId={id} name={student.data?.name ?? "this student"} />
          </TabsContent>
        </Tabs>
      </Section>

      <InterveneDialog
        flag={target}
        open={target !== null}
        onOpenChange={(next) => !next && setTarget(null)}
      />
    </div>
  );
}
