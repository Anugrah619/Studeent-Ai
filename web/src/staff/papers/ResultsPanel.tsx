import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { CircleCheck, Copy, FileWarning, Loader2, Plus, SearchCheck, Trash2 } from "lucide-react";
import {
  MAPPABLE_FIELDS,
  uploadErrorText,
  useMappings,
  useResultsUpload,
  type ResultsOutcome,
} from "@/api/staff";
import type { ColumnMappingField, ResultsReport, TestPaper } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { num } from "@/lib/format";
import { NativeSelect, Note, Problem, plural } from "../common";
import { Code, Counts, FilePicker, LabelList, RowErrors, Verdict } from "./upload";

interface ColumnRow {
  key: number;
  column: string;
  field: ColumnMappingField;
}

const FIELD_LABEL = Object.fromEntries(MAPPABLE_FIELDS.map((f) => [f.value, f.label])) as Record<
  ColumnMappingField,
  string
>;

/** The header row of a CSV, for suggesting column names. Excel is not read here. */
async function csvHeader(file: File): Promise<string[]> {
  if (!/\.csv$/i.test(file.name)) return [];
  try {
    const head = (await file.slice(0, 8192).text()).split(/\r?\n/)[0] ?? "";
    return head
      .split(",")
      .map((cell) => cell.trim().replace(/^"(.*)"$/, "$1"))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * A class's results for this paper: check, then import.
 *
 * The file can be one row per student with a column per question, or one row
 * per answer — the server works out which (`layout`). When the institute's
 * software names its columns its own way, a column map renames them: a saved
 * one picked from the list, or one written here (which wins), optionally saved
 * for next month's upload of the same export.
 *
 * Statuses that carry an answer are shown as answers, not as failures: a dry
 * run that finds problems (200, `ok: false`), an import refused whole (422),
 * and the same file sent twice (409, with the batch it duplicates).
 */
export function ResultsPanel({ paper }: { paper: TestPaper }) {
  const upload = useResultsUpload();
  const mappings = useMappings();
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [profile, setProfile] = useState<string>("");
  const [columns, setColumns] = useState<ColumnRow[]>([]);
  const [saveAs, setSaveAs] = useState("");
  const [checked, setChecked] = useState<ResultsOutcome | null>(null);
  const [imported, setImported] = useState<ResultsOutcome | null>(null);
  const ids = { profile: useId(), saveAs: useId(), list: useId() };

  // Any change to what would be sent makes the last check stale.
  const stale = () => {
    setChecked(null);
    setImported(null);
    upload.reset();
  };

  useEffect(() => {
    let live = true;
    if (file) void csvHeader(file).then((found) => live && setHeaders(found));
    else setHeaders([]);
    return () => {
      live = false;
    };
  }, [file]);

  const columnMap = Object.fromEntries(
    columns.filter((c) => c.column.trim()).map((c) => [c.column.trim(), c.field]),
  ) as Record<string, ColumnMappingField>;
  const hasMap = Object.keys(columnMap).length > 0;

  const run = (dryRun: boolean) => {
    if (!file) return;
    upload.mutate(
      {
        paper: paper.id,
        file,
        dryRun,
        mappingProfile: profile ? Number(profile) : undefined,
        columnMap: hasMap ? columnMap : undefined,
        saveMappingAs: hasMap && saveAs.trim() ? saveAs.trim() : undefined,
      },
      { onSuccess: (outcome) => (dryRun ? setChecked(outcome) : setImported(outcome)) },
    );
  };

  const checkedReport = checked?.kind === "report" ? checked.report : null;
  const canImport =
    Boolean(checkedReport?.ok) &&
    (checkedReport?.students_ingested ?? 0) > 0 &&
    checkedReport?.duplicate_of_batch == null &&
    !(imported?.kind === "report" && imported.status === 201);
  const shown = imported ?? checked;
  const selected = mappings.data?.find((m) => String(m.id) === profile);

  return (
    <div className="space-y-6">
      <FilePicker
        label="Results file"
        hint={
          <>
            Either one row per student with a column per question (<Code>roll_no</Code>,{" "}
            <Code>Q1</Code>, <Code>Q2</Code>, …), or one row per answer (<Code>roll_no</Code>,{" "}
            <Code>question_id</Code>, <Code>answer</Code>). A <Code>time_spent</Code> column is
            optional.
          </>
        }
        file={file}
        onChange={(next) => {
          setFile(next);
          stale();
        }}
        disabled={upload.isPending}
      />

      <fieldset className="space-y-4 rounded-lg border border-border px-4 pt-3 pb-4">
        <legend className="px-1 text-sm font-medium text-foreground">
          Column names, if your file uses its own
        </legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor={ids.profile} className="mb-1.5">
              Saved mapping
            </Label>
            <NativeSelect
              id={ids.profile}
              value={profile}
              onChange={(event) => {
                setProfile(event.target.value);
                stale();
              }}
              disabled={mappings.isPending}
            >
              <option value="">
                {mappings.isPending
                  ? "Loading saved mappings…"
                  : mappings.data?.length
                    ? "None"
                    : "None saved yet"}
              </option>
              {(mappings.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
            {mappings.error ? (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Saved mappings could not be loaded; you can still rename columns below.
              </p>
            ) : selected ? (
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {Object.entries(selected.mapping)
                  .map(([from, to]) => `${from} → ${FIELD_LABEL[to] ?? to}`)
                  .join("; ")}
              </p>
            ) : null}
          </div>
        </div>

        <div>
          <p className="text-sm text-muted-foreground">
            Rename columns for this upload. These win over a saved mapping.
          </p>
          {headers.length ? (
            <datalist id={ids.list}>
              {headers.map((h) => (
                <option key={h} value={h} />
              ))}
            </datalist>
          ) : null}
          {columns.length ? (
            <ul className="mt-2 space-y-2" aria-label="Column renamings">
              {columns.map((row, index) => (
                <li key={row.key} className="flex flex-wrap items-end gap-2">
                  <div className="min-w-40 flex-1">
                    <Label htmlFor={`col-${row.key}`} className="mb-1 text-xs text-muted-foreground">
                      Column in your file
                    </Label>
                    <Input
                      id={`col-${row.key}`}
                      value={row.column}
                      list={headers.length ? ids.list : undefined}
                      placeholder="e.g. Candidate No"
                      onChange={(event) => {
                        const value = event.target.value;
                        setColumns((prev) =>
                          prev.map((c) => (c.key === row.key ? { ...c, column: value } : c)),
                        );
                        stale();
                      }}
                    />
                  </div>
                  <div className="min-w-40 flex-1">
                    <Label htmlFor={`field-${row.key}`} className="mb-1 text-xs text-muted-foreground">
                      Holds
                    </Label>
                    <NativeSelect
                      id={`field-${row.key}`}
                      value={row.field}
                      onChange={(event) => {
                        const value = event.target.value as ColumnMappingField;
                        setColumns((prev) =>
                          prev.map((c) => (c.key === row.key ? { ...c, field: value } : c)),
                        );
                        stale();
                      }}
                    >
                      {MAPPABLE_FIELDS.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove renaming ${index + 1}`}
                    onClick={() => {
                      setColumns((prev) => prev.filter((c) => c.key !== row.key));
                      stale();
                    }}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() =>
              setColumns((prev) => [
                ...prev,
                { key: Date.now() + prev.length, column: "", field: "roll_no" },
              ])
            }
          >
            <Plus aria-hidden />
            Rename a column
          </Button>
        </div>

        {hasMap ? (
          <div className="max-w-sm">
            <Label htmlFor={ids.saveAs} className="mb-1.5">
              Save this mapping as
            </Label>
            <Input
              id={ids.saveAs}
              value={saveAs}
              placeholder="e.g. Our test software"
              onChange={(event) => setSaveAs(event.target.value)}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Optional. Saved when the file is imported, for next time.
            </p>
          </div>
        ) : null}
      </fieldset>

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
        {shown?.kind === "duplicate" ? (
          <Verdict
            tone="warn"
            icon={<Copy aria-hidden className="size-4" />}
            title="This exact file was already imported."
          >
            <p>{shown.detail}</p>
            {shown.batchId != null ? (
              <p className="mt-1">
                <Link
                  to={`/papers/${paper.id}?tab=history&batch=${shown.batchId}`}
                  className="font-medium text-brand-ink underline underline-offset-4"
                >
                  See upload #{shown.batchId} in the history
                </Link>
              </p>
            ) : null}
          </Verdict>
        ) : shown?.kind === "report" ? (
          <ResultsReportView
            report={shown.report}
            written={shown.status === 201}
            paperId={paper.id}
          />
        ) : null}
      </div>
    </div>
  );
}

export function ResultsReportView({
  report,
  written,
  paperId,
}: {
  report: ResultsReport;
  /** 201: the import was written. */
  written: boolean;
  paperId: number;
}) {
  const blueprint = `/papers/${paperId}?tab=blueprint`;
  const blocked = report.unmapped_questions.length > 0 || report.unkeyed_questions.length > 0;
  const would = report.dry_run ? "Would be added" : "Added";

  return (
    <section aria-label="Results report" className="space-y-4">
      {report.duplicate_of_batch != null ? (
        <Verdict
          tone="warn"
          icon={<Copy aria-hidden className="size-4" />}
          title="This exact file was already imported."
        >
          Importing it again would change nothing.{" "}
          <Link
            to={`/papers/${paperId}?tab=history&batch=${report.duplicate_of_batch}`}
            className="font-medium text-brand-ink underline underline-offset-4"
          >
            See upload #{report.duplicate_of_batch}
          </Link>
          .
        </Verdict>
      ) : written ? (
        <Verdict
          tone="good"
          icon={<CircleCheck aria-hidden className="size-4" />}
          title={`Imported: ${plural(report.students_ingested, "student")}, ${plural(report.attempts_created, "answer")}.`}
        >
          {report.derived_refreshed
            ? "Their figures were recomputed straight away"
            : "Their figures update with the next refresh"}
          {report.flags_raised != null
            ? `, and the detectors raised ${plural(report.flags_raised, "new flag")}.`
            : "."}
          {report.students_failed > 0
            ? ` ${plural(report.students_failed, "student")} could not be imported; correct their rows below and upload a new file.`
            : ""}
        </Verdict>
      ) : report.ok && report.students_ingested === 0 ? (
        <Verdict
          tone="warn"
          icon={<Copy aria-hidden className="size-4" />}
          title="Nothing new in this file."
        >
          Every student it names is already recorded for this paper
          {report.students_failed > 0
            ? `, apart from ${plural(report.students_failed, "student")} with the problems below`
            : ""}
          . Importing it would add nothing.
        </Verdict>
      ) : report.ok ? (
        <Verdict
          tone="good"
          icon={<SearchCheck aria-hidden className="size-4" />}
          title={`Ready to import: ${plural(report.students_ingested, "student")}, ${plural(report.attempts_created, "new answer")}.`}
        >
          Nothing has been saved yet.
          {report.students_failed > 0
            ? ` ${plural(report.students_failed, "student")} would be left out because of the problems below; everyone else would be imported.`
            : ""}
        </Verdict>
      ) : (
        <Verdict
          tone="bad"
          icon={<FileWarning aria-hidden className="size-4" />}
          title={
            report.dry_run
              ? "This file would not import as it is."
              : "Refused. Nothing was saved."
          }
        >
          {blocked
            ? "Some questions in the file are missing from the paper's blueprint or its answer key. Fix the blueprint first, then check the file again."
            : "Correct the lines below, then check the file again."}
        </Verdict>
      )}

      <Counts
        items={[
          { label: "Students in the file", value: report.students_in_file },
          { label: report.dry_run ? "Would be imported" : "Imported", value: report.students_ingested },
          {
            label: "Already recorded",
            value: report.students_already_recorded,
            hint: "Every answer in their row was already on file. Counted, not doubled.",
          },
          { label: "Failed", value: report.students_failed },
        ]}
      />

      <p className="tnum text-sm text-muted-foreground">
        {would}: {plural(report.attempts_created, "answer")}. Already on file:{" "}
        {num(report.attempts_already_recorded)}. Read as{" "}
        {report.layout === "long"
          ? "one row per answer"
          : report.layout === "wide"
            ? "one row per student"
            : report.layout}
        .
      </p>

      {report.unmapped_questions.length ? (
        <Problem title="Questions the blueprint does not know">
          <LabelList labels={report.unmapped_questions} />. Nothing can be written until
          they are in the{" "}
          <Link to={blueprint} className="font-medium text-brand-ink underline underline-offset-4">
            blueprint
          </Link>
          .
        </Problem>
      ) : null}
      {report.unkeyed_questions.length ? (
        <Problem title="Questions with no answer key">
          <LabelList labels={report.unkeyed_questions} />. Add their answers in the{" "}
          <Link to={blueprint} className="font-medium text-brand-ink underline underline-offset-4">
            blueprint
          </Link>{" "}
          before importing.
        </Problem>
      ) : null}
      {report.ignored_columns.length ? (
        <Note>
          Columns left out: <LabelList labels={report.ignored_columns} />. If one holds roll
          numbers, answers or times, rename it above and check again.
        </Note>
      ) : null}
      {report.questions_not_in_file.length ? (
        <Note>
          The paper has {plural(report.questions_not_in_file.length, "question")} this file does
          not mention (<LabelList labels={report.questions_not_in_file} />). That is allowed — a
          partial sitting is real.
        </Note>
      ) : null}

      <RowErrors
        errors={report.errors}
        total={report.errors_total}
        idLabel="Roll number"
        idOf={(error) => error.roll_no}
      />
    </section>
  );
}
