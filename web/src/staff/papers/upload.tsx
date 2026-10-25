import { useId, useRef, type ReactNode } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import type { IngestRowError } from "@/api/types";
import { Button } from "@/components/ui/button";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fileSize } from "./labels";

/** The two formats every upload route takes. Legacy `.xls` is refused by the server. */
export const ACCEPT = ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * A file input that says what it holds. The native input stays the control —
 * it is the one every browser, phone and screen reader already knows — and the
 * line beside it names the chosen file, so "which file did I pick?" never has
 * to be guessed from a truncated input.
 */
export function FilePicker({
  label,
  hint,
  file,
  onChange,
  disabled,
}: {
  label: string;
  hint: ReactNode;
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <p id={`${id}-hint`} className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
        {hint}
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-input bg-muted/30 px-4 py-3">
        <input
          ref={input}
          id={id}
          type="file"
          accept={ACCEPT}
          disabled={disabled}
          aria-describedby={`${id}-hint`}
          className="sr-only"
          onChange={(event) => {
            onChange(event.target.files?.[0] ?? null);
            // The same file picked twice after an edit must still register.
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          <Upload aria-hidden />
          {file ? "Choose another file" : "Choose a file"}
        </Button>
        <span className="flex min-w-0 items-center gap-2 text-sm" aria-live="polite">
          {file ? (
            <>
              <FileSpreadsheet aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium text-foreground">{file.name}</span>
              <span className="tnum shrink-0 text-xs text-muted-foreground">{fileSize(file.size)}</span>
            </>
          ) : (
            <span className="text-muted-foreground">CSV or Excel (.xlsx), first sheet</span>
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * Every problem in the file, at once, with the line it is on.
 *
 * `row` counts the header as line 1, exactly as a spreadsheet numbers it, so
 * "line 14" is the row a person scrolls to. The server lists the first 100;
 * the total says how many there are in all.
 */
export function RowErrors({
  errors,
  total,
  idLabel,
  idOf,
}: {
  errors: IngestRowError[];
  total: number;
  /** "Question" for a blueprint, "Roll number" for results. */
  idLabel: string;
  idOf: (error: IngestRowError) => string | undefined;
}) {
  if (!errors.length) return null;
  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground">
        {total > errors.length
          ? `The first ${num(errors.length)} of ${num(total)} problems`
          : total === 1
            ? "The problem"
            : `All ${num(total)} problems`}
      </h4>
      <div className="mt-2 max-h-96 overflow-auto rounded-lg ring-1 ring-border">
        <table className="w-full text-sm">
          <caption className="sr-only">Problems in the file, by line</caption>
          <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Line</th>
              <th scope="col" className="px-3 py-2 font-medium">{idLabel}</th>
              <th scope="col" className="px-3 py-2 font-medium">What is wrong</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {errors.map((error, index) => (
              <tr key={`${error.row}-${index}`} data-error-row={error.row}>
                <td className="tnum px-3 py-2 align-top whitespace-nowrap text-muted-foreground">
                  {error.row}
                </td>
                <td className="tnum px-3 py-2 align-top whitespace-nowrap font-medium text-foreground">
                  {idOf(error) || "—"}
                </td>
                <td className="px-3 py-2 align-top leading-snug text-foreground">{error.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A row of labelled counts. Not a KPI band: these are a receipt, read once. */
export function Counts({
  items,
  className,
}: {
  items: { label: string; value: number | string; hint?: string }[];
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border ring-1 ring-border sm:grid-cols-4",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="bg-card px-4 py-3" title={item.hint}>
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="tnum mt-1 text-xl leading-none font-semibold text-foreground">
            {typeof item.value === "number" ? num(item.value) : item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The verdict line a report opens with — what happened, in one sentence. */
export function Verdict({
  tone,
  icon,
  title,
  children,
}: {
  tone: "good" | "warn" | "bad";
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg px-4 py-3 ring-1",
        tone === "good"
          ? "bg-status-good/8 ring-status-good/25"
          : tone === "warn"
            ? "bg-status-warn/8 ring-status-warn/25"
            : "bg-status-critical/6 ring-status-critical/25",
      )}
    >
      <span
        className={cn(
          "mt-0.5 shrink-0",
          tone === "good"
            ? "text-status-good"
            : tone === "warn"
              ? "text-status-warn"
              : "text-status-critical",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {children ? (
          <div className="mt-1 text-sm leading-relaxed text-muted-foreground">{children}</div>
        ) : null}
      </div>
    </div>
  );
}

/** A column name, as it appears in the file: a technical string, in monospace. */
export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>;
}

/** A list of question labels, shortened past a dozen. */
export function LabelList({ labels }: { labels: string[] }) {
  const shown = labels.slice(0, 12);
  return (
    <span className="tnum font-medium text-foreground">
      {shown.join(", ")}
      {labels.length > shown.length ? ` and ${num(labels.length - shown.length)} more` : ""}
    </span>
  );
}
