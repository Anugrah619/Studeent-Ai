import { Link, useParams, useSearchParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { ApiError } from "@/api/client";
import { usePaper } from "@/api/staff";
import { EmptyState, ErrorState } from "@/components/common/States";
import { PageHeadline } from "@/components/kit/PageHeadline";
import { Section } from "@/components/kit/Section";
import { Skeleton } from "@/components/ui/skeleton";
import { longDate, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { plural } from "../common";
import { BlueprintPanel } from "./BlueprintPanel";
import { QuestionsPanel } from "./QuestionsPanel";
import { ResultsPanel } from "./ResultsPanel";
import { UploadHistory } from "./UploadHistory";
import { SOURCE } from "./labels";

const TABS = [
  {
    key: "blueprint",
    label: "Blueprint",
    title: "Blueprint",
    description:
      "Which chapter each question tests and its right answer. Once per paper, before any results.",
  },
  {
    key: "results",
    label: "Results",
    title: "Upload the class's results",
    description:
      "Check the file first: nothing is saved until you import it, and a student is imported whole or not at all.",
  },
  {
    key: "questions",
    label: "Questions and tagging",
    title: "Questions and tagging",
    description:
      "Write up each question and tag its wrong options with the belief behind them, so a diagnosis can explain the answers students chose.",
  },
  {
    key: "history",
    label: "Upload history",
    title: "Upload history",
    description: "Every results file imported for this paper, newest first.",
  },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * One paper's workspace, in the order the work is done: blueprint, results,
 * questions and their tags, and the receipts.
 *
 * The sections are links (`?tab=`), not a tab widget: a report can send the
 * reader straight to the blueprint ("these questions are missing from it"),
 * and a duplicate upload to the batch it repeats, and Back returns them.
 */
export function PaperPage() {
  const params = useParams();
  const paperId = Number(params.paperId);
  const [search] = useSearchParams();
  const paper = usePaper(paperId);

  const requested = search.get("tab");
  const tab: TabKey = TABS.some((t) => t.key === requested) ? (requested as TabKey) : "blueprint";
  const current = TABS.find((t) => t.key === tab)!;
  const highlight = Number(search.get("batch")) || undefined;

  const back = (
    <Link
      to="/papers"
      className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden className="size-4" />
      Papers
    </Link>
  );

  if (paper.error) {
    return (
      <div className="space-y-6 py-6">
        {back}
        {paper.error instanceof ApiError && paper.error.status === 404 ? (
          <EmptyState
            title="No such paper in this institute"
            body="It may belong to another institute, or the link may be mistyped."
          />
        ) : (
          <ErrorState error={paper.error} onRetry={() => void paper.refetch()} />
        )}
      </div>
    );
  }

  const data = paper.data;

  return (
    <div className="space-y-8 pb-6">
      <div className="pt-6">{back}</div>
      <PageHeadline
        className="pt-0"
        eyebrow={data ? SOURCE[data.source]?.label ?? data.source : "Paper"}
        title={
          data ? (
            data.name
          ) : (
            <span className="block py-1" aria-label="Loading the paper">
              <Skeleton className="h-9 w-full max-w-md" />
            </span>
          )
        }
        support={
          data ? (
            <>
              Held {longDate(data.held_on)}
              {data.total_questions ? `, ${plural(data.total_questions, "question")}` : ""}
              {data.max_marks ? `, out of ${num(data.max_marks)} marks` : ""}.{" "}
              {SOURCE[data.source]?.long}
            </>
          ) : undefined
        }
      />

      <nav aria-label="This paper" className="border-b border-border">
        <ul className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const active = t.key === tab;
            return (
              <li key={t.key}>
                <Link
                  to={`/papers/${paperId}?tab=${t.key}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                    active
                      ? "border-brand text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <Section title={current.title} description={current.description}>
        {!data ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : tab === "blueprint" ? (
          <BlueprintPanel paper={data} />
        ) : tab === "results" ? (
          <ResultsPanel paper={data} />
        ) : tab === "questions" ? (
          <QuestionsPanel paperId={data.id} />
        ) : (
          <UploadHistory paperId={data.id} highlight={highlight} />
        )}
      </Section>
    </div>
  );
}
