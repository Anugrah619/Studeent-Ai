import { Link, useSearchParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import type { MyAttempt } from "@/api/types";
import { useMyWrongAnswers } from "@/api/student";
import { Bubble } from "@/components/brand/Bubble";
import { plural } from "../lib";
import { Block, LoadingRows, Quiet, ScreenHeader, Sheet, Trouble } from "../ui";

interface PaperGroup {
  paperId: number | null;
  paperName: string;
  latest: string;
  rows: MyAttempt[];
}

function groupByPaper(rows: MyAttempt[]): PaperGroup[] {
  const groups = new Map<string, PaperGroup>();
  for (const row of rows) {
    const key = String(row.paper_id ?? row.paper_name);
    const group = groups.get(key) ?? {
      paperId: row.paper_id,
      paperName: row.paper_name || "A paper without a name",
      latest: row.ts,
      rows: [],
    };
    group.rows.push(row);
    if (row.ts > group.latest) group.latest = row.ts;
    groups.set(key, group);
  }
  // The most recent paper first: that is the one worth going over now.
  return [...groups.values()].sort((a, b) => b.latest.localeCompare(a.latest));
}

/**
 * Every wrong answer, by paper, newest paper first — each one a way back into
 * the question. An imported mock with scores only has no question on file, so
 * its rows are listed (they are still marks to win back) but not offered as
 * links to nothing.
 */
export function Mistakes() {
  const [params] = useSearchParams();
  const asked = Number(params.get("paper"));
  const paper = Number.isInteger(asked) && asked > 0 ? asked : null;
  const wrong = useMyWrongAnswers(paper);
  const rows = wrong.data ?? [];
  const groups = groupByPaper(rows);

  return (
    <>
      <ScreenHeader kicker="Mistakes" title="Questions to go over.">
        {wrong.data
          ? rows.length
            ? `${plural(rows.length, "question")} across ${plural(groups.length, "paper")}. Each one is a chance to win marks back.`
            : null
          : null}
      </ScreenHeader>

      {paper !== null ? (
        <p className="-mt-2 mb-4 text-sm text-muted-foreground">
          {groups[0] ? `Showing ${groups[0].paperName} only. ` : "Showing one paper. "}
          <Link to="/mistakes" className="font-medium text-brand-ink underline decoration-brand-line underline-offset-4">
            Show every paper
          </Link>
        </p>
      ) : null}

      {wrong.isPending ? (
        <LoadingRows rows={4} label="Loading your wrong answers" />
      ) : wrong.error ? (
        <Trouble error={wrong.error} what="your wrong answers" onRetry={() => void wrong.refetch()} />
      ) : !rows.length ? (
        <Quiet>
          No wrong answers to go over{paper !== null ? " on this paper" : ""}. After a mock, the
          ones you got wrong will be here to review.
        </Quiet>
      ) : (
        groups.map((group, i) => (
          <Block
            key={group.paperId ?? group.paperName}
            title={group.paperName}
            description={plural(group.rows.length, "wrong answer")}
            className={i === 0 ? "mt-2" : undefined}
          >
            <Sheet as="ul" className="divide-y divide-border">
              {group.rows.map((row) => (
                <MistakeRow key={row.id} row={row} />
              ))}
            </Sheet>
          </Block>
        ))
      )}
    </>
  );
}

function MistakeRow({ row }: { row: MyAttempt }) {
  const body = (
    <>
      <span className="tnum w-12 shrink-0 text-sm font-semibold text-foreground">{row.question_id}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-snug text-foreground">{row.topic_name}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
          {row.chosen_option ? (
            <>
              <Bubble size="sm" letter={row.chosen_option} filled />
              <span>You chose ({row.chosen_option})</span>
            </>
          ) : null}
          {row.question_pk === null ? <span>No question on file</span> : null}
        </span>
      </span>
    </>
  );

  if (row.question_pk === null) {
    return (
      <li className="flex items-center gap-3 px-4 py-3" data-question-pk="none">
        {body}
      </li>
    );
  }
  return (
    <li data-question-pk={row.question_pk}>
      <Link
        to={`/mistakes/${row.question_pk}`}
        aria-label={`Open ${row.question_id}, ${row.topic_name}`}
        className="flex items-center gap-3 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        {body}
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}
