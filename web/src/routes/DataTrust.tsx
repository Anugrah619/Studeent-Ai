import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  Calculator,
  Check,
  FileCheck2,
  FlaskConical,
  Hourglass,
  Lock,
  Minus,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import type { DashboardSummary, StudentDetail, TestPaper } from "@/api/types";
import type { Diagnosis } from "@/api/diagnosis";
import {
  useDashboardSummary,
  useDiagnosis,
  usePapers,
  useStudent,
} from "@/api/queries";
import {
  Exhibit,
  ExhibitNote,
  ExhibitSkeleton,
  Eyebrow,
} from "@/components/explainer/Exhibit";
import {
  EXAMPLE_STUDENT_ID,
  allEvidence,
  firstName,
  plural,
  pseudonymFor,
  resolvedEvidence,
} from "@/lib/explainer";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Data & trust — the questions a sceptical director asks before buying.
 *
 * The audience has been sold to by vendors who overclaimed, so the page's
 * stance is the opposite of a pitch: it says plainly what in the demo is
 * simulated, what is ours, what is still being built, and what the AI is never
 * trusted with. Honest labelling is the selling point here, which is also why
 * the page will not print a number it cannot read from the API — a trust page
 * with one invented figure on it is worse than no trust page.
 *
 * Where a live figure exists it is read as the page loads (and labelled
 * "Live data" or "Demo fixtures" by the exhibit it sits in). Where none exists
 * yet — official past papers, the answer-key cross-check — the page says so in
 * words, and the code says which field would turn the words into a count.
 */
export function DataTrust() {
  const summary = useDashboardSummary();
  const papers = usePapers();
  const paperId = summary.data?.latest_paper_id ?? undefined;
  const student = useStudent(EXAMPLE_STUDENT_ID);
  const diagnosis = useDiagnosis(EXAMPLE_STUDENT_ID, paperId);

  const paper = papers.data?.find((p) => p.id === paperId);

  return (
    <div className="py-6">
      <header className="max-w-3xl">
        <Eyebrow>Data &amp; trust</Eyebrow>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-balance sm:text-[1.75rem]">
          What&rsquo;s real, what&rsquo;s simulated, and why every claim can be
          checked
        </h1>
        <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground sm:text-[0.9375rem]">
          The questions worth asking before you put this in front of your
          teachers, answered plainly. Where a figure appears it is read from
          the system as this page loads. Where we cannot count something yet,
          we say so instead of estimating it.
        </p>
      </header>

      <nav aria-label="On this page" className="mt-5">
        <ol className="flex flex-wrap gap-1.5 text-xs">
          {QUESTIONS.map((q) => (
            <li key={q.id}>
              <a
                href={`#${q.id}`}
                className="inline-flex rounded-full border border-border bg-card px-2.5 py-1 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {q.ask}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-8 space-y-12">
        <Question
          {...Q.real}
          answer={
            <>
              <p>
                <strong className="font-semibold text-foreground">
                  The students in this demo, and their answers, are simulated.
                </strong>{" "}
                They are generated so that their mistakes follow consistent
                patterns — the kind a real class has — which gives the analysis
                something genuine to find.
              </p>
              <p>
                The diagnostic paper is our own. Real past papers from NEET and
                JEE Main are being added now. The AI&rsquo;s diagnoses are real:
                produced live, on the simulated answers, and saved.
              </p>
              <p>
                We label it this way because a demo should say what it runs on.
                When your own students&rsquo; answers go in, this table is how
                you will tell the difference.
              </p>
            </>
          }
        >
          <ProvenanceExhibit
            summary={summary.data}
            paper={paper}
            diagnosis={diagnosis.data}
            exampleName={student.data ? firstName(student.data.name) : null}
            pending={summary.isPending || papers.isPending}
            error={summary.error ?? papers.error}
          />
        </Question>

        <Question
          {...Q.openBook}
          answer={
            <>
              <p>
                The AI is never asked to recall facts from memory. Everything it
                reasons about is put in front of it with the request: the
                question text, the options, which option the student chose, and
                what each wrong option means according to our question bank.
              </p>
              <p>
                For syllabus and past papers the source is the official document
                — NTA&rsquo;s papers and answer keys, the official syllabus,
                NCERT. The AI reads and organises those documents; it is never
                the source of the content.
              </p>
            </>
          }
        >
          <OpenBookExhibit />
        </Question>

        <Question
          {...Q.answerKey}
          answer={
            <>
              <p>
                As each past paper comes in, the AI solves every question on its
                own, without being shown the answer. Its answer is then compared
                with the official answer key published by NTA.
              </p>
              <p>
                Where the two agree, the question goes into the bank. Where they
                disagree, a person looks at it — only the disagreements, so a
                reviewer&rsquo;s time goes exactly where it is needed.
              </p>
            </>
          }
        >
          <AnswerKeyExhibit />
        </Question>

        <Question
          {...Q.privacy}
          answer={
            <>
              <p>
                Your students are minors, so this is a hard rule, not a setting:{" "}
                <strong className="font-semibold text-foreground">
                  no name, roll number or contact detail is ever sent to the AI.
                </strong>{" "}
                It sees a code such as &ldquo;Student S-1&rdquo; and the answers
                — nothing that identifies a child. The name is put back only
                inside your own system, after the AI has answered.
              </p>
              <p>
                Each institute&rsquo;s data is also walled off from every other
                institute&rsquo;s inside the database itself, so one
                institute&rsquo;s staff cannot see another&rsquo;s students.
              </p>
            </>
          }
        >
          <PrivacyExhibit
            student={student.data}
            pending={student.isPending}
            error={student.error}
          />
        </Question>

        <Question
          {...Q.maths}
          answer={
            <>
              <p>
                Every number you see — scores, marks lost, accuracy, marks at
                stake — is computed exactly by ordinary code from the recorded
                answers. The AI&rsquo;s job is to explain the pattern in plain
                language, not to calculate.
              </p>
              <p>
                Even where the AI mentions a figure, the system recounts it
                before it is shown. And every claim links to the questions
                behind it; a citation the system cannot match to an answer the
                student actually gave is shown as plain text and counts for
                nothing.
              </p>
            </>
          }
        >
          <MathsExhibit
            diagnosis={diagnosis.data}
            pending={summary.isPending || diagnosis.isPending}
            error={diagnosis.error}
            noPaper={summary.isSuccess && paperId === undefined}
          />
        </Question>
      </div>

      <nav aria-label="Where to go next" className="mt-12 border-t border-border pt-6">
        <Link
          to="/how-it-works"
          className="group inline-flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3.5 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span>
            <span className="block text-sm font-semibold text-foreground">
              How it works
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
              The four steps from an answer sheet to a teaching decision, on a
              live example.
            </span>
          </span>
          <ArrowRight
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          />
        </Link>
      </nav>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The questions
 * ------------------------------------------------------------------ */

const Q = {
  real: {
    id: "real",
    ask: "Is any of this real?",
    title: "What is real, and what is simulated",
    icon: FlaskConical,
  },
  openBook: {
    id: "open-book",
    ask: "Can the AI make things up?",
    title: "Open book, not closed book",
    icon: BookOpen,
  },
  answerKey: {
    id: "answer-key",
    ask: "How do you know the answers are right?",
    title: "Every past-paper answer is cross-checked against the official key",
    icon: FileCheck2,
  },
  privacy: {
    id: "privacy",
    ask: "What happens to my students' data?",
    title: "The AI never learns who the student is",
    icon: Lock,
  },
  maths: {
    id: "maths",
    ask: "Who does the arithmetic?",
    title: "The AI never does the maths",
    icon: Calculator,
  },
} as const;

const QUESTIONS = Object.values(Q);

function Question({
  id,
  ask,
  title,
  icon: Icon,
  answer,
  children,
}: {
  id: string;
  ask: string;
  title: string;
  icon: typeof Lock;
  answer: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="grid scroll-mt-20 gap-5 border-t border-border pt-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10"
    >
      <div className="min-w-0">
        <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
          <Icon aria-hidden className="size-3.5" />
          {ask}
        </p>
        <h2
          id={`${id}-title`}
          className="mt-2 text-lg leading-snug font-semibold tracking-tight text-balance text-foreground sm:text-xl"
        >
          {title}
        </h2>
        <div className="mt-2.5 max-w-prose space-y-2.5 text-sm leading-relaxed text-muted-foreground">
          {answer}
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * 1 — Real vs simulated
 * ------------------------------------------------------------------ */

type Status = "simulated" | "ours" | "in_progress" | "real";

const STATUS: Record<Status, { label: string; icon: typeof Check; tone: string }> = {
  simulated: {
    label: "Simulated",
    icon: FlaskConical,
    tone: "border-status-warn/45 bg-status-warn/[0.08] text-foreground",
  },
  ours: {
    label: "Our own",
    icon: ShieldCheck,
    tone: "border-border bg-muted text-foreground",
  },
  in_progress: {
    label: "Being added",
    icon: Hourglass,
    tone: "border-dashed border-border bg-background text-muted-foreground",
  },
  real: {
    label: "Real",
    icon: Sparkles,
    tone: "border-status-good/45 bg-status-good/[0.08] text-foreground",
  },
};

interface ProvenanceRow {
  key: string;
  what: string;
  status: Status;
  /** What it is, in a sentence, with any live figure inline. */
  detail: ReactNode;
}

/**
 * The provenance table.
 *
 * Rows are data so the past-papers row can take a live count the day the
 * contract can supply one. API_GAPS.QUESTION_PROVENANCE: nothing in the
 * schema says where a paper or question came from, so that row is words only.
 * When `TestPaper` (or `QuestionDetail`) carries a `source` — official past
 * paper / our own / generated — count `usePapers()` by it here and give each
 * source its own row. Until then no number is printed for it, because the only
 * number available would be one we made up.
 */
function ProvenanceExhibit({
  summary,
  paper,
  diagnosis,
  exampleName,
  pending,
  error,
}: {
  summary: DashboardSummary | undefined;
  paper: TestPaper | undefined;
  diagnosis: Diagnosis | undefined;
  exampleName: string | null;
  pending: boolean;
  error: Error | null;
}) {
  const rows: ProvenanceRow[] = [
    {
      key: "students",
      what: "Students and their answers",
      status: "simulated",
      detail: summary ? (
        <>
          <Live>{plural(summary.total_students, "student")}</Live> in this demo,
          generated with consistent mistake patterns.
          {summary.latest_paper_students ? (
            <>
              {" "}
              <Live>{num(summary.latest_paper_students)}</Live> sat the latest
              paper.
            </>
          ) : null}
        </>
      ) : (
        "Generated with consistent mistake patterns."
      ),
    },
    {
      key: "diagnostic-paper",
      what: "The diagnostic paper",
      status: "ours",
      detail: paper ? (
        <>
          <Live>{paper.name}</Live>:{" "}
          {paper.total_questions != null ? (
            <>
              <Live>{plural(paper.total_questions, "question")}</Live>,{" "}
            </>
          ) : null}
          <Live>{num(paper.max_marks)} marks</Live>. Written by us, with its
          tempting wrong options labelled by the mistake behind them.
        </>
      ) : (
        "Written by us, with its tempting wrong options labelled by the mistake behind them."
      ),
    },
    {
      key: "past-papers",
      what: "Official past papers — NEET, JEE Main",
      status: "in_progress",
      detail: (
        <>
          Being imported now. No count is shown yet: the system does not yet
          record where each question came from, so any number here would be a
          guess. It will appear here once it does.
        </>
      ),
    },
    {
      key: "diagnoses",
      what: "The AI's diagnoses",
      status: "real",
      detail: (
        <>
          Produced live by the AI on the simulated answers, and every one saved
          with a trace number
          {diagnosis?.trace_id ? (
            <>
              {" "}
              — {exampleName ? `${exampleName}’s` : "the example student’s"} is{" "}
              <Live>trace #{diagnosis.trace_id}</Live>
            </>
          ) : null}
          .
        </>
      ),
    },
  ];

  return (
    <Exhibit
      title="What this demo runs on"
      endpoints={[
        "/api/dashboard/summary/",
        "/api/papers/",
        "/api/students/{id}/diagnosis/?paper=",
      ]}
      footer={
        <>
          Figures in{" "}
          <span className="font-medium text-foreground">bold</span> are read
          from the system as this page loads. Nothing else on this table is a
          number.
        </>
      }
    >
      {error ? (
        <ExhibitNote detail={error.message}>
          The live figures could not be loaded just now; the labels below still
          hold.
        </ExhibitNote>
      ) : null}
      {pending && !error ? (
        <ExhibitSkeleton lines={6} />
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">
            What in this demo is simulated, our own, being added, or real
          </caption>
          <thead>
            <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
              <th scope="col" className="pb-2 pr-3 font-medium">
                What
              </th>
              <th scope="col" className="pb-2 pr-3 font-medium">
                Status
              </th>
              <th scope="col" className="hidden pb-2 font-medium sm:table-cell">
                In this demo
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.key} className="align-top">
                <th
                  scope="row"
                  className="py-2.5 pr-3 text-left text-sm font-medium text-foreground"
                >
                  {row.what}
                  <span className="mt-1 block text-xs leading-relaxed font-normal text-muted-foreground sm:hidden">
                    {row.detail}
                  </span>
                </th>
                <td className="py-2.5 pr-3">
                  <StatusChip status={row.status} />
                </td>
                <td className="hidden py-2.5 text-xs leading-relaxed text-muted-foreground sm:table-cell">
                  {row.detail}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Exhibit>
  );
}

function StatusChip({ status }: { status: Status }) {
  const { label, icon: Icon, tone } = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        tone,
      )}
    >
      <Icon aria-hidden className="size-3" />
      {label}
    </span>
  );
}

/** A figure read from the API, set apart from the words around it. */
function Live({ children }: { children: ReactNode }) {
  return <span className="tnum font-semibold text-foreground">{children}</span>;
}

/* ------------------------------------------------------------------ *
 * 2 — Open book
 * ------------------------------------------------------------------ */

function OpenBookExhibit() {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <BookCard
        tone="no"
        title="Closed book — what we don't do"
        lines={[
          "Ask the AI what the syllabus says",
          "Ask the AI for the right answer from memory",
          "Let the AI's general knowledge stand in for the paper",
        ]}
        note="An AI answering from memory can be fluent and wrong, and you can't see which."
      />
      <BookCard
        tone="yes"
        title="Open book — what we do"
        lines={[
          "Put the actual question and options in front of it",
          "Give it the student's recorded choices",
          "Give it the meaning of each wrong option from our bank",
          "Take syllabus and answer keys from the official documents",
        ]}
        note="Everything it says can be traced back to something it was shown."
      />
    </div>
  );
}

function BookCard({
  tone,
  title,
  lines,
  note,
}: {
  tone: "yes" | "no";
  title: string;
  lines: string[];
  note: string;
}) {
  const Icon = tone === "yes" ? Check : X;
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3.5",
        tone === "yes" ? "border-foreground/25 bg-card" : "border-dashed border-border bg-muted/30",
      )}
    >
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {lines.map((line) => (
          <li key={line} className="flex gap-2 text-xs leading-relaxed text-foreground">
            <Icon
              aria-hidden
              className={cn(
                "mt-0.5 size-3.5 shrink-0",
                tone === "yes" ? "text-status-good" : "text-muted-foreground",
              )}
            />
            <span>
              <span className="sr-only">{tone === "yes" ? "We do: " : "We don't: "}</span>
              {line}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{note}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 3 — The answer-key cross-check
 * ------------------------------------------------------------------ */

/**
 * The cross-check as a flow, with no counts.
 *
 * API_GAPS.QUESTION_PROVENANCE — the contract has no notion of an official
 * past-paper question yet, let alone of how many the AI agreed with. The
 * status line says that rather than showing a zero, which would read as
 * "checked none" — a different and false claim.
 */
function AnswerKeyExhibit() {
  const steps = [
    {
      icon: Sparkles,
      title: "The AI solves it alone",
      body: "Each past-paper question, answered without the key in sight.",
    },
    {
      icon: FileCheck2,
      title: "Compared with NTA's key",
      body: "Its answer is matched against the official published answer key.",
    },
    {
      icon: UserRound,
      title: "Only disagreements go to a person",
      body: "Agreed answers go into the bank; a reviewer sees just the ones that differ.",
    },
  ];
  return (
    <div className="rounded-xl border border-border bg-card">
      <ol className="grid gap-px overflow-hidden rounded-t-xl bg-border sm:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step.title} className="bg-card px-4 py-3.5">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {/* Decorative: the list itself carries the order. */}
              <span
                aria-hidden
                className="tnum flex size-5 items-center justify-center rounded-full border border-foreground/25 text-[10px] font-semibold"
              >
                {i + 1}
              </span>
              {step.title}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
          </li>
        ))}
      </ol>
      <p className="flex items-start gap-2 border-t border-border px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
        <Hourglass aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Being built now, alongside the past-paper import. Once it runs, how
          many questions were checked, agreed and sent for review will be shown
          here. The system does not report that yet, so no figure is shown — not
          even a zero, which would wrongly read as &ldquo;none checked&rdquo;.
        </span>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 4 — Privacy
 * ------------------------------------------------------------------ */

function PrivacyExhibit({
  student,
  pending,
  error,
}: {
  student: StudentDetail | undefined;
  pending: boolean;
  error: Error | null;
}) {
  return (
    <Exhibit
      title="One student, on each side of the line"
      endpoints={["/api/students/{id}/"]}
      footer={
        <>
          The left column is read from your institute&rsquo;s records. The right
          column is what the AI is given for the same student: no field on the
          left crosses over.
        </>
      }
    >
      {error ? (
        <ExhibitNote detail={error.message}>
          The example student could not be loaded just now.
        </ExhibitNote>
      ) : pending || !student ? (
        <ExhibitSkeleton lines={5} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-background/60 px-3.5 py-3">
            <Eyebrow>In your institute&rsquo;s records</Eyebrow>
            <dl className="mt-2 space-y-1.5 text-sm">
              <Field label="Name" value={student.name} />
              <Field label="Roll number" value={student.roll_no} mono />
              <Field label="Batch" value={student.batch?.name ?? "—"} />
              <Field label="Mentor" value={student.mentor?.name ?? "—"} />
            </dl>
          </div>
          <div className="rounded-lg border border-foreground/25 bg-card px-3.5 py-3">
            <Eyebrow className="flex items-center gap-1.5">
              <Lock aria-hidden className="size-3" />
              What the AI is given
            </Eyebrow>
            <dl className="mt-2 space-y-1.5 text-sm">
              <Field label="Student" value={pseudonymFor(student.id)} mono />
              <Field label="Name" withheld />
              <Field label="Roll number" withheld />
              <Field label="Contact details" withheld />
            </dl>
            <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
              Plus the paper, its questions, and which option was chosen on each
              — enough to find {firstName(student.name)}&rsquo;s pattern, and
              nothing that identifies the child.
            </p>
          </div>
        </div>
      )}
    </Exhibit>
  );
}

function Field({
  label,
  value,
  mono,
  withheld,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  withheld?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      {withheld ? (
        <dd className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Minus aria-hidden className="size-3" />
          Never sent
        </dd>
      ) : (
        <dd className={cn("min-w-0 truncate text-right font-medium text-foreground", mono && "font-mono text-[13px]")}>
          {value}
        </dd>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 5 — The maths
 * ------------------------------------------------------------------ */

/**
 * One diagnosis's marks, shown as the sum the server actually did.
 *
 * `total_marks_at_stake` is recounted server-side over the *distinct* cited
 * answers that resolved to something this student really got wrong — the
 * model's own figure is discarded. So the page shows the parts that total
 * came from (each resolved citation's `marks_at_stake`) and how many of the
 * AI's citations matched the answer sheet at all. Every figure is the
 * response's; the only arithmetic done here is laying the parts side by side.
 */
function MathsExhibit({
  diagnosis,
  pending,
  error,
  noPaper,
}: {
  diagnosis: Diagnosis | undefined;
  pending: boolean;
  error: Error | null;
  noPaper: boolean;
}) {
  const resolved = diagnosis ? resolvedEvidence(diagnosis) : [];
  const cited = diagnosis ? allEvidence(diagnosis) : [];

  return (
    <Exhibit
      title={
        diagnosis?.trace_id
          ? `Who counted what · trace #${diagnosis.trace_id}`
          : "Who counted what"
      }
      endpoints={["/api/students/{id}/diagnosis/?paper="]}
    >
      {noPaper ? (
        <ExhibitNote>No paper has been sat yet, so there is no diagnosis to show.</ExhibitNote>
      ) : error ? (
        <ExhibitNote detail={error.message}>
          There is no diagnosis to show here right now. The principle stands:
          the figures elsewhere in the console are computed without the AI.
        </ExhibitNote>
      ) : pending || !diagnosis ? (
        <ExhibitSkeleton lines={4} />
      ) : (
        <div className="space-y-4">
          <div>
            <Eyebrow>Written by the AI</Eyebrow>
            <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-foreground">
              &ldquo;{diagnosis.headline}&rdquo;
            </p>
          </div>

          <div>
            <Eyebrow>Counted by the system</Eyebrow>
            {resolved.length ? (
              <>
                <p className="tnum mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-foreground">
                  {resolved.map((row, i) => (
                    <span key={row.question_id} className="inline-flex items-center gap-1.5">
                      {i > 0 ? (
                        <span aria-hidden className="text-muted-foreground">
                          +
                        </span>
                      ) : null}
                      <span className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px]">
                        {row.label}
                        <span className="text-muted-foreground"> {num(row.marks_at_stake)}</span>
                      </span>
                    </span>
                  ))}
                  <span aria-hidden className="text-muted-foreground">
                    =
                  </span>
                  <span className="font-semibold">
                    {num(diagnosis.total_marks_at_stake)} marks at stake
                  </span>
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  One figure per cited answer, each matched to an answer the
                  student actually gave:{" "}
                  <span className="tnum font-medium text-foreground">
                    {num(resolved.length)} of {num(cited.length)}
                  </span>{" "}
                  of the AI&rsquo;s citations matched the answer sheet
                  {cited.length > resolved.length
                    ? "; the rest are shown as plain text and count for nothing."
                    : "."}
                </p>
              </>
            ) : (
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                This diagnosis cites no answer the system could match, so it
                puts no marks at stake — the AI cannot add any of its own.
              </p>
            )}
          </div>

          <Link
            to="/how-it-works#step-count"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline underline-offset-4"
          >
            See the full count, step by step
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </div>
      )}
    </Exhibit>
  );
}
