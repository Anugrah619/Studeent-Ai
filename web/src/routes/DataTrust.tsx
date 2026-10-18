import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import {
  BookOpen,
  Building2,
  Calculator,
  Check,
  FileCheck2,
  FlaskConical,
  Hourglass,
  Landmark,
  Lock,
  Minus,
  ShieldCheck,
  PenLine,
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
  RecordsTag,
} from "@/components/explainer/Exhibit";
import { IdeaCard } from "@/components/explainer/IdeaCard";
import {
  CROSS_CHECK_DISAGREEMENTS,
  CROSS_CHECK_TRANSCRIPTION_ERRORS,
  DIAGNOSTIC_PAPER,
  IMPORT_RECORDS_NOTE,
  PAST_PAPERS,
  SYLLABI,
} from "@/components/explainer/importRecords";
import { AnimatedNumber } from "@/components/kit/AnimatedNumber";
import { KpiCard } from "@/components/kit/KpiCard";
import { PageHeadline } from "@/components/kit/PageHeadline";
import { Reveal, RevealItem } from "@/components/kit/Reveal";
import { Section } from "@/components/kit/Section";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  EXAMPLE_STUDENT_ID,
  allEvidence,
  firstName,
  plural,
  pseudonymFor,
  resolvedEvidence,
} from "@/lib/explainer";
import { num } from "@/lib/format";
import { hoverLift, transition } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Data & trust — the questions a sceptical director asks before buying.
 *
 * The audience has been sold to by vendors who overclaimed, so the page's
 * stance is the opposite of a pitch: it says plainly what in the demo is
 * simulated, what is ours, what is official, what has not happened yet, and
 * what the AI is never trusted with. Honest labelling is the selling point
 * here.
 *
 * Every figure says where it came from. Live ones are read as the page loads
 * (and labelled "Live data" or "Demo fixtures" by the exhibit they sit in).
 * The syllabus, past-paper and cross-check figures cannot be read live yet —
 * API_GAPS.QUESTION_PROVENANCE — so they come from `importRecords.ts`, were
 * counted when the documents were imported, and wear an "Import records" tag
 * wherever they appear. The one review that has not happened (a person looking
 * at the AI's disagreements with the official key) is said in words, next to
 * the figures, never left for the reader to infer.
 */
export function DataTrust() {
  const summary = useDashboardSummary();
  const papers = usePapers();
  const paperId = summary.data?.latest_paper_id ?? undefined;
  const student = useStudent(EXAMPLE_STUDENT_ID);
  const diagnosis = useDiagnosis(EXAMPLE_STUDENT_ID, paperId);

  const paper = papers.data?.find((p) => p.id === paperId);

  return (
    <div className="pb-6">
      <PageHeadline
        eyebrow="Data & trust"
        title={
          <>
            What&rsquo;s real, what&rsquo;s simulated, and how each claim can be
            checked
          </>
        }
        support={
          <>
            The questions worth asking before you put this in front of your
            teachers, answered plainly. Figures read from the system are tagged
            with their source, live data or the demo fixtures; figures tagged
            &ldquo;Import records&rdquo; were counted when the papers and
            syllabi were imported. Where we cannot count something yet, we say
            so instead of estimating it.
          </>
        }
        meta={
          <nav aria-label="On this page">
            <ol className="flex flex-wrap gap-2 text-sm">
              {QUESTIONS.map((q) => (
                <li key={q.id}>
                  <a
                    href={`#${q.id}`}
                    className="inline-flex rounded-sm border border-border bg-card px-2.5 py-1 text-muted-foreground transition-colors outline-none hover:border-foreground/40 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {q.ask}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        }
      />

      <div className="mt-6 space-y-16">
        <Section
          id="at-a-glance"
          eyebrow="At a glance"
          title="Four safeguards, and where each one stands today"
        >
          <TrustCards pseudonym={pseudonymFor(EXAMPLE_STUDENT_ID)} />
        </Section>

        <Section
          id="loaded"
          eyebrow="Loaded today"
          title="Official syllabi and two real past papers are in"
          description="Read from the published papers and cross-checked against NTA's answer keys. The AI diagnosis does not run on these papers yet."
          actions={<RecordsTag />}
        >
          <LoadedFigures />
        </Section>

        <div className="space-y-14">
          <Question
            {...Q.real}
            answer={
              <>
                <p>
                  <strong className="font-semibold text-foreground">
                    The students in this demo, and their answers, are simulated.
                  </strong>{" "}
                  They are generated with mistake patterns built in on purpose,
                  so the demo can show what the analysis finds when a pattern is
                  there. Loading an institute&rsquo;s own results is designed but
                  not built yet.
                </p>
                <p>
                  The diagnostic paper is our own. The AI&rsquo;s diagnoses are
                  real: produced live, on the simulated answers to that paper, and
                  saved. They do not run on the real past papers yet.
                </p>
                <p>
                  The official syllabi and two real past papers are loaded and
                  cross-checked; the demo screens still run on the earlier JEE
                  chapter list.
                </p>
              </>
            }
            more={
              <p>
                We label it this way because a demo should say what it runs on.
                Once your own students&rsquo; answers can be loaded, this table
                is how you will tell the difference.
              </p>
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
                  reasons about is put in front of it with the request: each
                  answer&rsquo;s chapter and the option chosen, the question text
                  for the wrong ones, and what each wrong option chosen means
                  according to our question bank.
                </p>
                <p>
                  For syllabus and past papers the source is the published
                  document — the papers, NTA&rsquo;s answer keys, the official
                  syllabus, NCERT. The AI reads and organises those documents:
                  the questions and answers come from them, and the chapter and
                  mistake tags it suggests stay drafts until a person confirms
                  them.
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
                  When a past paper comes in, the AI solves every question on its
                  own, without being shown the answer. Its answer is then compared
                  with the official answer key published by NTA.
                </p>
                <p>
                  Every question goes into the bank with NTA&rsquo;s answer, never
                  the AI&rsquo;s. Where the two disagree, the question is marked
                  for a person to look at — only those, so a reviewer&rsquo;s time
                  goes where it is needed.
                </p>
                <p>
                  <strong className="font-semibold text-foreground">
                    That last step has not happened yet for the papers loaded so
                    far.
                  </strong>{" "}
                  A first pass by an AI assistant sided with NTA&rsquo;s key in
                  every one of the disagreements, and traced{" "}
                  {num(CROSS_CHECK_TRANSCRIPTION_ERRORS)} of them to copying
                  errors in our own transcription — but a person has not yet
                  reviewed them.
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
                  It sees a code such as &ldquo;S-1&rdquo; and the answers
                  — nothing that identifies a child. The name is put back only
                  inside your own system, after the AI has answered.
                </p>
                <p>
                  Each institute&rsquo;s data is also walled off from every other
                  institute&rsquo;s inside the database itself — by Postgres
                  row-level security — so one institute&rsquo;s staff cannot see
                  another&rsquo;s students.
                </p>
              </>
            }
          >
            <div className="space-y-3">
              <PrivacyExhibit
                student={student.data}
                pending={student.isPending}
                error={student.error}
              />
              <InstituteWalls />
            </div>
          </Question>

          <Question
            {...Q.maths}
            answer={
              <>
                <p>
                  Scores, marks lost, accuracy and marks at stake are computed
                  exactly by ordinary code from the recorded answers. The
                  AI&rsquo;s job is to explain the pattern in plain language, not
                  to calculate. (In this demo, the sentences on the seeded flags —
                  Priya&rsquo;s 44% → 67%, for one — were written in with the
                  simulated data.)
                </p>
                <p>
                  The total at stake is recounted from the answer sheet, never
                  taken from the AI. A figure inside the AI&rsquo;s own sentence is
                  its wording, so check it against the count beside it. Each
                  finding links to the questions it cites; a citation the system
                  cannot match to a wrong answer the student gave is shown as plain
                  text and counts for nothing.
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
      </div>

      <nav aria-label="Where to go next" className="mt-16 border-t border-border pt-8">
        <motion.div {...hoverLift} className="inline-block rounded-xl">
          <Link
            to="/how-it-works"
            className="group inline-flex items-start gap-3 rounded-xl border border-border bg-card px-5 py-4 shadow-card transition-shadow outline-none hover:shadow-raised focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span>
              <span className="block text-sm font-semibold text-foreground underline decoration-transparent underline-offset-4 group-hover:decoration-foreground/40">
                How it works
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                The four steps from an answer sheet to a teaching decision, on one
                worked example.
              </span>
            </span>
          </Link>
        </motion.div>
      </nav>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * At a glance
 * ------------------------------------------------------------------ */

/**
 * The four safeguards a director asks about, each with its state in words —
 * including the one that is not finished. A trust card that only ever says
 * "done" is a slide.
 */
function TrustCards({ pseudonym }: { pseudonym: string }) {
  const [jee, neet] = PAST_PAPERS;
  return (
    <Reveal stagger={0.06} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <RevealItem>
        <IdeaCard
          icon={Lock}
          title="The AI never sees a student's name"
          status="Hard rule"
          body={`It is sent a code such as “${pseudonym}” and the answers. No name, roll number or contact detail is ever sent — your students are minors.`}
          to="#privacy"
          cta="See both sides of the line"
        />
      </RevealItem>
      <RevealItem>
        <IdeaCard
          icon={Building2}
          title="Each institute is walled off"
          status="In the database"
          body="Enforced inside the database itself, by Postgres row-level security, so one institute's staff cannot see another's students."
          to="#walls"
          cta="How the wall works"
        />
      </RevealItem>
      <RevealItem>
        <IdeaCard
          icon={FileCheck2}
          title="Past-paper answers checked against NTA's key"
          status="Review pending"
          body={`Gemini solved every question on its own; ${num(jee.agreedPct)}% (${jee.exam}) and ${num(neet.agreedPct, 1)}% (${neet.exam}) matched the official key. A person has not yet reviewed the ${num(CROSS_CHECK_DISAGREEMENTS)} disagreements.`}
          to="#answer-key"
          cta="See the cross-check"
        />
      </RevealItem>
      <RevealItem>
        <IdeaCard
          icon={FlaskConical}
          title="Simulated students, labelled as such"
          status="Simulated"
          body="Every student on screen is simulated; the AI's diagnoses of them are real. Loading an institute's own results is designed, not built yet."
          to="#real"
          cta="See what's real"
        />
      </RevealItem>
    </Reveal>
  );
}

/* ------------------------------------------------------------------ *
 * Loaded today
 * ------------------------------------------------------------------ */

function LoadedFigures() {
  return (
    <div>
      <Reveal stagger={0.05} className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {SYLLABI.map((s) => (
          <RevealItem key={s.exam}>
            <KpiCard
              label={`${s.exam} syllabus`}
              value={s.chapters}
              unit="chapters"
              caption={
                <>
                  Official syllabus ·{" "}
                  <span className="tnum font-medium text-foreground">
                    {num(s.ncertLinked)} of {num(s.chapters)}
                  </span>{" "}
                  linked to NCERT
                </>
              }
            />
          </RevealItem>
        ))}
        {PAST_PAPERS.map((p) => (
          <RevealItem key={p.key}>
            <KpiCard
              label={`${p.exam} · ${p.sitting}`}
              value={p.questions}
              unit="questions"
              caption={
                <>
                  {p.paperSource} ·{" "}
                  <span className="tnum font-medium text-foreground">
                    {num(p.agreed)} of {num(p.questions)}
                  </span>{" "}
                  matched NTA&rsquo;s key
                </>
              }
            />
          </RevealItem>
        ))}
      </Reveal>

      <Accordion type="single" collapsible className="mt-3 rounded-xl border border-border bg-card px-4 shadow-card">
        <AccordionItem value="why">
          <AccordionTrigger className="text-sm text-foreground hover:no-underline">
            What these figures are — and what they are not yet used for
          </AccordionTrigger>
          <AccordionContent className="space-y-2 text-sm leading-relaxed text-muted-foreground">
            <p>{IMPORT_RECORDS_NOTE}</p>
            <p>
              The demo screens still run on the earlier JEE chapter list, and the
              AI diagnosis runs on our own {DIAGNOSTIC_PAPER.questions}-question
              diagnostic paper ({DIAGNOSTIC_PAPER.misconceptions} misconceptions)
              — not yet on these real papers.
            </p>
            <p>
              The students on screen are simulated. Loading an institute&rsquo;s
              own results is designed but not built yet.
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
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
    title: "The AI does none of the counting",
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
  more,
  children,
}: {
  id: string;
  ask: string;
  title: string;
  icon: typeof Lock;
  answer: ReactNode;
  /** A last, longer paragraph — behind a disclosure, so the answer scans. */
  more?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-28 border-t border-border pt-8"
    >
      <Reveal className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-brand-ink">
            <Icon aria-hidden className="size-4" />
            {ask}
          </p>
          <h2
            id={`${id}-title`}
            className="mt-2 font-heading text-xl leading-snug font-semibold tracking-tight text-balance text-foreground sm:text-2xl"
          >
            {title}
          </h2>
          <div className="mt-3 max-w-prose space-y-2.5 text-sm leading-relaxed text-muted-foreground">
            {answer}
          </div>
          {more ? (
            <Accordion type="single" collapsible className="mt-2 max-w-prose">
              <AccordionItem value="more">
                <AccordionTrigger className="py-2 text-sm text-foreground">
                  Why we label it this way
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                  {more}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          ) : null}
        </div>
        <div className="min-w-0">{children}</div>
      </Reveal>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * 1 — Real vs simulated
 * ------------------------------------------------------------------ */

type Status = "simulated" | "ours" | "official" | "real" | "not_yet";

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
  official: {
    label: "Official",
    icon: Landmark,
    tone: "border-foreground/25 bg-card text-foreground",
  },
  real: {
    label: "Real",
    icon: PenLine,
    tone: "border-status-good/45 bg-status-good/[0.08] text-foreground",
  },
  not_yet: {
    label: "Not yet",
    icon: Hourglass,
    tone: "border-dashed border-border bg-background text-muted-foreground",
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
 * Rows are data so a row can take a live count the day the contract can supply
 * one. API_GAPS.QUESTION_PROVENANCE: nothing in the schema says where a paper
 * or question came from, so the syllabus and past-paper rows print the import
 * records (plain weight, not bold — bold is reserved for what was read live).
 * When `TestPaper` carries a `source`, count `usePapers()` by it here instead.
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
          <Live>{plural(summary.total_students, "student")}</Live> on this
          demo&rsquo;s roster, all simulated, with mistake patterns built in.
          {summary.latest_paper_students ? (
            <>
              {" "}
              <Live>{num(summary.latest_paper_students)}</Live> sat the latest
              paper.
            </>
          ) : null}
        </>
      ) : (
        "Generated, with mistake patterns built in."
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
          <Live>{num(paper.max_marks)} marks</Live>, covering{" "}
          {DIAGNOSTIC_PAPER.misconceptions} misconceptions. Written by us, with
          its tempting wrong options labelled by the mistake behind them.
        </>
      ) : (
        `Written by us, covering ${DIAGNOSTIC_PAPER.misconceptions} misconceptions, with its tempting wrong options labelled by the mistake behind them.`
      ),
    },
    {
      key: "syllabi",
      what: "Official syllabi — JEE Main, NEET UG",
      status: "official",
      detail: (
        <>
          {SYLLABI.map((s, i) => (
            <span key={s.exam}>
              {i > 0 ? " " : null}
              {s.exam}: {plural(s.chapters, "chapter")}, {num(s.ncertLinked)}{" "}
              linked to NCERT.
            </span>
          ))}{" "}
          The demo screens still run on the earlier JEE chapter list.
        </>
      ),
    },
    {
      key: "past-papers",
      // "Real", not "Official": the NEET paper is a publisher's copy, because
      // NTA does not publish NEET papers. Only the answer keys are NTA's.
      what: "Real past papers — JEE Main, NEET",
      status: "real",
      detail: (
        <>
          {PAST_PAPERS.map((p, i) => (
            <span key={p.key}>
              {i > 0 ? " " : null}
              {p.exam}, {p.sitting}: {plural(p.questions, "question")}.
            </span>
          ))}{" "}
          JEE from NTA&rsquo;s published paper; NEET from a publisher&rsquo;s
          copy, as NTA does not publish NEET papers. Every answer cross-checked
          against NTA&rsquo;s official key. The AI diagnosis does not run on
          them yet.
        </>
      ),
    },
    {
      key: "diagnoses",
      what: "The AI's diagnoses",
      status: "real",
      detail: (
        <>
          Produced live by the AI on the simulated answers to our diagnostic
          paper, and every one saved with a trace number
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
    {
      key: "your-students",
      what: "Your students' answers",
      status: "not_yet",
      detail: (
        <>
          Loading your institute&rsquo;s own results is designed but not built
          yet. Until it is, every student on screen is simulated.
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
          from the system as this page loads — live data or the demo fixtures,
          as the tag above says. The syllabus and past-paper
          figures, in plain type, come from our import records:{" "}
          {IMPORT_RECORDS_NOTE.charAt(0).toLowerCase() + IMPORT_RECORDS_NOTE.slice(1)}
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
            What in this demo is simulated, our own, official, real, or not yet
            here
          </caption>
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="pr-3 pb-2 font-medium">
                What
              </th>
              <th scope="col" className="pr-3 pb-2 font-medium">
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
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
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
    <div className="grid gap-3 sm:grid-cols-2">
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
          "Put the question and the option chosen in front of it",
          "Give it the student's recorded choices",
          "Give it the meaning of each wrong option chosen, from our bank",
          "Take syllabus and answer keys from the official documents",
        ]}
        note="Every finding cites questions it was shown, and the system checks each citation against the answer sheet."
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
        tone === "yes"
          ? "border-foreground/25 bg-card shadow-card"
          : "border-dashed border-border bg-muted/30",
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
 * The cross-check as it stands: how far the AI agreed with NTA's key on each
 * loaded paper, and the one step that has not happened.
 *
 * The agreement bar is a single neutral hue — it is a share of one paper, not
 * a status — with the figure written beside it, so nothing rests on the bar.
 * The disagreements are not tinted as a warning either: they are not known to
 * be anyone's error until a person has looked, and the page says exactly that.
 */
function AnswerKeyExhibit() {
  const steps = [
    {
      icon: PenLine,
      title: "The AI solves it alone",
      body: "Each past-paper question, answered without the key in sight.",
      state: "Done",
      done: true,
    },
    {
      icon: FileCheck2,
      title: "Compared with NTA's key",
      body: "Its answer is matched against the official published answer key.",
      state: "Done",
      done: true,
    },
    {
      icon: UserRound,
      title: "Disagreements are marked for a person",
      body: "Every question goes into the bank with NTA's answer; the ones that differ are marked for a reviewer.",
      state: "Not yet reviewed",
      done: false,
    },
  ];

  return (
    <Exhibit
      title="The cross-check, on the papers loaded so far"
      endpoints={[]}
      tag={<RecordsTag />}
      footer={
        <span className="flex items-start gap-2">
          <Hourglass aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <span className="tnum font-medium text-foreground">
              {num(CROSS_CHECK_DISAGREEMENTS)} disagreements in total.
            </span>{" "}
            A first pass by an AI assistant sided with NTA&rsquo;s key in every
            case and found {num(CROSS_CHECK_TRANSCRIPTION_ERRORS)} copying errors
            of ours — but a person has not yet reviewed them. Until one has, we
            say so here.
          </span>
        </span>
      }
    >
      <ul className="space-y-5">
        {PAST_PAPERS.map((p) => {
          const share = (p.agreed / p.questions) * 100;
          return (
            <li key={p.key}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-sm font-medium text-foreground">
                  {p.exam}{" "}
                  <span className="font-normal text-muted-foreground">· {p.sitting}</span>
                </p>
                <p className="flex items-baseline gap-1.5">
                  <span className="text-2xl leading-none font-semibold tracking-tight text-foreground">
                    <AnimatedNumber
                      value={p.agreedPct}
                      format="percent"
                      digits={Number.isInteger(p.agreedPct) ? 0 : 1}
                    />
                  </span>
                  <span className="text-xs text-muted-foreground">agreed</span>
                </p>
              </div>
              {/* The track watches the viewport, not the fill: a fill at
                  scaleX(0) has no area, so it could never be "in view". It
                  grows once, as a transform, so reduced motion makes it instant. */}
              <motion.div
                aria-hidden
                className="mt-2 h-2 overflow-hidden rounded-sm bg-foreground/8"
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.5 }}
              >
                <motion.div
                  className="h-full origin-left rounded-sm bg-foreground/55"
                  style={{ width: `${share}%` }}
                  variants={{
                    hidden: { scaleX: 0 },
                    show: { scaleX: 1, transition: transition.slow },
                  }}
                />
              </motion.div>
              <p className="tnum mt-1.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {num(p.agreed)} of {num(p.questions)}
                </span>{" "}
                of Gemini&rsquo;s answers matched NTA&rsquo;s official key.
              </p>
            </li>
          );
        })}
      </ul>

      <ol className="mt-5 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step.title} className="bg-card px-3.5 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {/* Decorative: the list itself carries the order. */}
              <span
                aria-hidden
                className="tnum flex size-5 shrink-0 items-center justify-center rounded-sm border border-foreground/25 text-xs font-semibold"
              >
                {i + 1}
              </span>
              {step.title}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
            <p
              className={cn(
                "mt-2 inline-flex items-center gap-1 text-xs font-medium",
                step.done ? "text-status-good" : "text-muted-foreground",
              )}
            >
              {step.done ? (
                <Check aria-hidden className="size-3.5" />
              ) : (
                <Hourglass aria-hidden className="size-3.5" />
              )}
              {step.state}
            </p>
          </li>
        ))}
      </ol>
    </Exhibit>
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
              Plus the paper and, for each answer, the chapter, the option chosen
              and the time taken — with an excerpt of the question where it was
              wrong. Enough to find {firstName(student.name)}&rsquo;s pattern, and
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

/**
 * The wall between institutes, drawn as one. Words carry it; the picture is
 * there so "row-level security" has something to point at.
 */
function InstituteWalls() {
  return (
    <figure
      id="walls"
      aria-labelledby="walls-title"
      className="scroll-mt-28 rounded-xl border border-border bg-card px-4 py-4 shadow-card sm:px-5"
    >
      <figcaption id="walls-title">
        <Eyebrow>Between institutes</Eyebrow>
      </figcaption>
      <div aria-hidden className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2 sm:gap-3">
        <InstituteBox name="Your institute" yours />
        <div className="flex flex-col items-center justify-center gap-1 px-1">
          <span className="h-full w-[3px] rounded-full bg-foreground/70" />
          <Lock className="size-4 text-foreground" />
          <span className="h-full w-[3px] rounded-full bg-foreground/70" />
        </div>
        <InstituteBox name="Another institute" />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        The wall is in the database itself — Postgres row-level security — not
        only in the screens, so one institute&rsquo;s staff cannot see another
        institute&rsquo;s students.
      </p>
    </figure>
  );
}

function InstituteBox({ name, yours }: { name: string; yours?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5",
        yours ? "border-foreground/25 bg-background/60" : "border-dashed border-border bg-muted/30",
      )}
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{name}</span>
      </p>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">
        {yours ? "Its students, answers and diagnoses" : "Never visible from yours"}
      </p>
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
            <Eyebrow className="flex items-center gap-1.5">
              <PenLine aria-hidden className="size-3" />
              Written by the AI
            </Eyebrow>
            {/* In the serif — this panel is where the rule that separates the two
                voices is stated, so it follows it. */}
            <p className="mt-2 max-w-prose font-serif text-lg leading-snug font-semibold text-foreground">
              &ldquo;{diagnosis.headline}&rdquo;
            </p>
          </div>

          <div>
            <Eyebrow className="flex items-center gap-1.5">
              <Calculator aria-hidden className="size-3" />
              Counted by the system
            </Eyebrow>
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
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs font-semibold">
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

          <CountLink />
        </div>
      )}
    </Exhibit>
  );
}

/** Cross-page, so a router link — the shell lands it at the top of the page. */
function CountLink() {
  return (
    <Link
      to="/how-it-works#step-count"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-ink underline decoration-brand-line underline-offset-4 outline-none hover:decoration-brand-ink focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      See the full count, step by step
    </Link>
  );
}
