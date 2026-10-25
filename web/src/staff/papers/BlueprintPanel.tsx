import { useState } from "react";
import { Link } from "react-router-dom";
import { CircleCheck, FileWarning, Loader2, SearchCheck } from "lucide-react";
import { uploadErrorText, useBlueprintUpload, type BlueprintOutcome } from "@/api/staff";
import type { TestPaper } from "@/api/types";
import { Button } from "@/components/ui/button";
import { num } from "@/lib/format";
import { Note, Problem, plural } from "../common";
import { Code, Counts, FilePicker, RowErrors, Verdict } from "./upload";

/**
 * The paper's blueprint: which chapter each question tests, and its answer.
 *
 * Check, then import. "Check file" is a dry run — the server does everything
 * except write, and answers with the same report — so a wrong file costs one
 * click and nothing else. The route is all-or-nothing: one bad row and nothing
 * is written, with every problem listed at once (a 422 that carries the
 * report). "Import" sends the same file for real, and only after a check of
 * that file came back clean.
 */
export function BlueprintPanel({ paper }: { paper: TestPaper }) {
  const upload = useBlueprintUpload(paper.id);
  const [file, setFile] = useState<File | null>(null);
  const [checked, setChecked] = useState<BlueprintOutcome | null>(null);
  const [imported, setImported] = useState<BlueprintOutcome | null>(null);

  const choose = (next: File | null) => {
    setFile(next);
    setChecked(null);
    setImported(null);
    upload.reset();
  };

  const run = (dryRun: boolean) => {
    if (!file) return;
    upload.mutate(
      { file, dryRun },
      {
        onSuccess: (outcome) => (dryRun ? setChecked(outcome) : setImported(outcome)),
      },
    );
  };

  const canImport = Boolean(checked?.report.ok) && !imported?.report.ok;
  const shown = imported ?? checked;

  return (
    <div className="space-y-5">
      {paper.source !== "institute" ? (
        <Note>
          This paper&rsquo;s blueprint was loaded with it. Uploading another replaces
          the chapter and the answer of every question the file names.
        </Note>
      ) : null}

      <FilePicker
        label="Blueprint file"
        hint={
          <>
            One row per question, with the columns <Code>question_id</Code>,{" "}
            <Code>chapter</Code> and <Code>correct_option</Code> (or <Code>answer</Code>{" "}
            for a numerical question).
          </>
        }
        file={file}
        onChange={choose}
        disabled={upload.isPending}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          variant={canImport ? "outline" : "default"}
          disabled={!file || upload.isPending}
          onClick={() => run(true)}
        >
          {upload.isPending && upload.variables?.dryRun ? (
            <Loader2 aria-hidden className="animate-spin" />
          ) : (
            <SearchCheck aria-hidden />
          )}
          Check file
        </Button>
        <Button disabled={!canImport || upload.isPending} onClick={() => run(false)}>
          {upload.isPending && upload.variables?.dryRun === false ? (
            <Loader2 aria-hidden className="animate-spin" />
          ) : null}
          Import
        </Button>
      </div>

      <div aria-live="polite" className="space-y-4">
        {upload.error ? (
          <Problem title="Nothing was saved.">{uploadErrorText(upload.error)}</Problem>
        ) : null}
        {shown ? <BlueprintReportView outcome={shown} paperId={paper.id} /> : null}
      </div>
    </div>
  );
}

function BlueprintReportView({ outcome, paperId }: { outcome: BlueprintOutcome; paperId: number }) {
  const { report } = outcome;
  const short = report.questions_in_file < report.expected_questions;

  return (
    <section aria-label="Blueprint report" className="space-y-4">
      {report.ok ? (
        report.dry_run ? (
          <Verdict
            tone="good"
            icon={<SearchCheck aria-hidden className="size-4" />}
            title="This file is ready to import."
          >
            Nothing has been saved yet. Import it to apply the blueprint.
          </Verdict>
        ) : (
          <Verdict
            tone="good"
            icon={<CircleCheck aria-hidden className="size-4" />}
            title={`Imported. ${plural(report.questions_in_file, "question")} applied.`}
          >
            Next, add the question text and tag the wrong options in{" "}
            <Link
              to={`/papers/${paperId}?tab=questions`}
              className="font-medium text-brand-ink underline underline-offset-4"
            >
              Questions and tagging
            </Link>
            , or upload the class&rsquo;s results.
          </Verdict>
        )
      ) : (
        <Verdict
          tone="bad"
          icon={<FileWarning aria-hidden className="size-4" />}
          title={
            report.dry_run
              ? `This file would be refused: ${plural(report.errors_total, "problem")}.`
              : `Refused: ${plural(report.errors_total, "problem")}. Nothing was saved.`
          }
        >
          A blueprint is applied whole or not at all. Correct every line below, then
          check the file again.
        </Verdict>
      )}

      <Counts
        items={[
          { label: "Questions in the file", value: report.questions_in_file },
          { label: report.dry_run ? "Would be added" : "Added", value: report.created },
          { label: report.dry_run ? "Would change" : "Changed", value: report.updated },
          { label: "Already as given", value: report.unchanged },
        ]}
      />

      {short ? (
        <Note>
          The paper has {num(report.expected_questions)} questions and the file covers{" "}
          {num(report.questions_in_file)}. That is allowed; the rest keep whatever they
          had.
        </Note>
      ) : null}

      <RowErrors
        errors={report.errors}
        total={report.errors_total}
        idLabel="Question"
        idOf={(error) => error.question_id}
      />
    </section>
  );
}
