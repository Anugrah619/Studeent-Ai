import { useId, useMemo, useState, type ComponentProps, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FilePlus2, Loader2 } from "lucide-react";
import { ApiError } from "@/api/client";
import { useBatches, usePapers } from "@/api/queries";
import { TOO_MANY, useCreatePaper } from "@/api/staff";
import type { PaperSource, TestPaper, TestPaperCreateRequest } from "@/api/types";
import { EmptyState, ErrorState, PanelSkeleton } from "@/components/common/States";
import { PageHeadline } from "@/components/kit/PageHeadline";
import { Section } from "@/components/kit/Section";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { longDate, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FieldError, NativeSelect, Problem, plural } from "../common";
import { SOURCE, SOURCE_ORDER, examName } from "./labels";

type SourceFilter = "all" | PaperSource;

/**
 * Every paper the institute holds, and where each one came from.
 *
 * The way in for an institute's own results: make the paper, upload its
 * blueprint, then upload the class's results — each checked before it is
 * saved. Official past papers and the demo papers are listed too, labelled,
 * because a paper's source decides how far its answer key can be trusted.
 */
export function PapersPage() {
  const papers = usePapers();
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [creating, setCreating] = useState(false);

  const rows = papers.data ?? [];
  const counts = useMemo(() => {
    const c = new Map<SourceFilter, number>([["all", rows.length]]);
    for (const p of rows) c.set(p.source, (c.get(p.source) ?? 0) + 1);
    return c;
  }, [rows]);
  const shown = rows.filter((p) => filter === "all" || p.source === filter);
  const own = counts.get("institute") ?? 0;

  return (
    <div className="space-y-8 pb-6">
      <PageHeadline
        eyebrow="Papers"
        title={
          papers.isPending
            ? "Papers"
            : own === 0
              ? "No results of your own are loaded yet."
              : `${plural(own, "paper")} of your own, ready for results.`
        }
        support="Add your own mock, upload which chapter each question tests and its answer, then upload the class's results. Every file is checked before anything is saved."
        actions={
          <Button onClick={() => setCreating(true)}>
            <FilePlus2 aria-hidden />
            Add a paper
          </Button>
        }
      />

      <Section
        title="All papers"
        description="Newest first. Where each paper came from is part of how far its answers can be trusted."
        actions={
          rows.length ? (
            <div
              role="group"
              aria-label="Show papers by source"
              className="flex flex-wrap rounded-md border border-border bg-card p-0.5"
            >
              {(["all", ...SOURCE_ORDER] as SourceFilter[])
                .filter((key) => key === "all" || counts.get(key))
                .map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={filter === key}
                    onClick={() => setFilter(key)}
                    className={cn(
                      "tnum rounded-sm px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      filter === key
                        ? "bg-foreground text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {key === "all" ? "Every source" : SOURCE[key].label}{" "}
                    <span className="opacity-75">{num(counts.get(key) ?? 0)}</span>
                  </button>
                ))}
            </div>
          ) : null
        }
      >
        {papers.isPending ? (
          <PanelSkeleton lines={6} />
        ) : papers.error ? (
          <ErrorState error={papers.error} onRetry={() => void papers.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No papers yet"
            body="Add your institute's first mock to start loading its results."
          />
        ) : (
          <ul
            aria-label="Papers"
            className="divide-y divide-border overflow-hidden rounded-xl bg-card shadow-card ring-1 ring-border"
          >
            {shown.map((paper) => (
              <PaperRow key={paper.id} paper={paper} />
            ))}
          </ul>
        )}
      </Section>

      <CreatePaperDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function PaperRow({ paper }: { paper: TestPaper }) {
  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-1.5 px-5 py-3.5">
      <div className="min-w-0 flex-1 basis-64">
        <Link
          to={`/papers/${paper.id}`}
          className="rounded-sm text-sm font-semibold text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {paper.name}
        </Link>
        <div className="tnum mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span>Held {longDate(paper.held_on)}</span>
          {paper.total_questions ? <span>{plural(paper.total_questions, "question")}</span> : null}
          {paper.max_marks ? <span>out of {num(paper.max_marks)}</span> : null}
        </div>
      </div>
      <span
        data-paper-source={paper.source}
        title={SOURCE[paper.source]?.long}
        className="inline-flex h-6 items-center rounded-sm px-2 text-xs font-medium whitespace-nowrap text-foreground ring-1 ring-border ring-inset"
      >
        {SOURCE[paper.source]?.label ?? paper.source}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * Add a paper
 * ------------------------------------------------------------------ */

type FieldErrors = Partial<Record<keyof TestPaperCreateRequest | "detail", string>>;

function errorsOf(error: Error | null): FieldErrors {
  if (!(error instanceof ApiError)) return error ? { detail: error.message } : {};
  if (error.status === 429) return { detail: TOO_MANY };
  const body = error.body;
  if (!body || typeof body !== "object") return { detail: error.message };
  const out: FieldErrors = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    const text = Array.isArray(value) ? value.join(" ") : typeof value === "string" ? value : "";
    if (!text) continue;
    if (key === "non_field_errors") out.detail = text;
    else out[key as keyof FieldErrors] = text;
  }
  return out;
}

const FALLBACK_EXAMS = ["JEE_MAIN", "NEET_UG"];

export function CreatePaperDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const create = useCreatePaper();
  const batches = useBatches();
  const exams = useMemo(() => {
    const codes = [...new Set((batches.data ?? []).map((b) => b.exam_code))];
    return codes.length ? codes : FALLBACK_EXAMS;
  }, [batches.data]);

  const ids = {
    name: useId(),
    exam: useId(),
    held: useId(),
    questions: useId(),
    max: useId(),
    correct: useId(),
    wrong: useId(),
    duration: useId(),
  };
  const [form, setForm] = useState({
    name: "",
    exam: "",
    held_on: "",
    total_questions: "",
    max_marks: "",
    marks_correct: "",
    marks_wrong: "",
    duration_min: "",
  });
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const exam = form.exam || exams[0] || "";
  const errors = errorsOf(create.error);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const optional = (value: string) => (value.trim() === "" ? undefined : Number(value));
    create.mutate(
      {
        name: form.name.trim(),
        exam,
        held_on: form.held_on,
        total_questions: optional(form.total_questions),
        max_marks: optional(form.max_marks),
        marks_correct: optional(form.marks_correct),
        marks_wrong: optional(form.marks_wrong),
        duration_min: optional(form.duration_min),
      },
      {
        onSuccess: (paper) => {
          onOpenChange(false);
          navigate(`/papers/${paper.id}?tab=blueprint`);
        },
      },
    );
  };

  const field = (
    key: keyof typeof form,
    id: string,
    label: string,
    props: Partial<ComponentProps<"input">> = {},
  ) => (
    <div>
      <Label htmlFor={id} className="mb-1.5">
        {label}
      </Label>
      <Input
        id={id}
        value={form[key]}
        onChange={(event) => set(key)(event.target.value)}
        aria-invalid={errors[key as keyof FieldErrors] ? true : undefined}
        aria-describedby={errors[key as keyof FieldErrors] ? `${id}-error` : undefined}
        {...props}
      />
      <FieldError id={`${id}-error`}>{errors[key as keyof FieldErrors]}</FieldError>
    </div>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) create.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90dvh] gap-0 overflow-y-auto p-0 shadow-overlay sm:max-w-lg">
        <form onSubmit={submit} noValidate>
          <DialogHeader className="gap-1.5 border-b border-border px-6 pt-5 pb-4">
            <DialogTitle className="pr-8 text-lg font-semibold tracking-tight">
              Add your institute&rsquo;s paper
            </DialogTitle>
            <DialogDescription>
              The paper first; its blueprint and the class&rsquo;s results come next, on its own page.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-6 py-5">
            {field("name", ids.name, "Name", { placeholder: "e.g. Mock 16", required: true })}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor={ids.exam} className="mb-1.5">
                  Exam
                </Label>
                <NativeSelect
                  id={ids.exam}
                  value={exam}
                  onChange={(event) => set("exam")(event.target.value)}
                  aria-invalid={errors.exam ? true : undefined}
                >
                  {exams.map((code) => (
                    <option key={code} value={code}>
                      {examName(code)}
                    </option>
                  ))}
                </NativeSelect>
                <FieldError>{errors.exam}</FieldError>
              </div>
              {field("held_on", ids.held, "Held on", { type: "date", required: true })}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {field("total_questions", ids.questions, "Questions", {
                type: "number",
                min: 1,
                inputMode: "numeric",
              })}
              {field("duration_min", ids.duration, "Duration, minutes", {
                type: "number",
                min: 1,
                inputMode: "numeric",
              })}
            </div>

            <details className="group rounded-md border border-border">
              <summary className="cursor-pointer list-none rounded-md px-4 py-3 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
                <span aria-hidden className="mr-2 inline-block transition-transform group-open:rotate-90">
                  &rsaquo;
                </span>
                Marking, if it differs from {examName(exam)}&rsquo;s own
              </summary>
              <div className="grid gap-4 px-4 pb-4 sm:grid-cols-3">
                {field("max_marks", ids.max, "Maximum marks", { type: "number", min: 1 })}
                {field("marks_correct", ids.correct, "Marks if right", { type: "number" })}
                {field("marks_wrong", ids.wrong, "Marks if wrong", {
                  type: "number",
                  placeholder: "e.g. -1",
                })}
              </div>
            </details>

            <div aria-live="polite">
              {errors.detail ? (
                <Problem title="The paper was not added.">{errors.detail}</Problem>
              ) : null}
            </div>
          </div>

          <DialogFooter className="m-0 rounded-b-xl border-t border-border bg-muted/30 px-6 py-3.5">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={create.isPending || !form.name.trim() || !form.held_on || !exam}
            >
              {create.isPending ? <Loader2 aria-hidden className="animate-spin" /> : null}
              Add paper
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
