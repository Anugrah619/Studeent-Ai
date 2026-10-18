import { useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { ArrowRight, ChevronDown, MoveDown, MoveRight, MoveUp } from "lucide-react";
import type { Flag, StudentList } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SeverityChip } from "@/components/common/SeverityChip";
import { EmptyState } from "@/components/common/States";
import { daysAgo, num, signed } from "@/lib/format";
import { SEVERITY, detectorLabel } from "@/lib/severity";
import { transition } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface TriageRow {
  flag: Flag;
  student?: StudentList;
}

/** One student and every flag open on them, worst first. */
export interface StudentGroup {
  studentId: number;
  student?: StudentList;
  /** Never empty. `flags[0]` is the one the row leads with. */
  flags: Flag[];
}

/**
 * Folds the sorted flag list into one entry per student.
 *
 * A director thinks in students, not detector firings: two flags on Aarav are
 * one conversation with one mentor, and listing them as two rows made the
 * table read as more people than it was. `rows` must already be in triage
 * order — a student's first appearance is then their worst flag, and the
 * groups come out in the same severity-then-longest-open order.
 */
export function groupByStudent(rows: TriageRow[]): StudentGroup[] {
  const groups = new Map<number, StudentGroup>();
  for (const { flag, student } of rows) {
    const group = groups.get(flag.student_id);
    if (group) group.flags.push(flag);
    else groups.set(flag.student_id, { studentId: flag.student_id, student, flags: [flag] });
  }
  return [...groups.values()];
}

/** Past this many students, the list folds and offers the rest on a click. */
const FOLD_AT = 12;

/**
 * Each student arrives in turn, once, after the headline has landed — and
 * leaves with a quick fade when the batch filter drops them, so the rows that
 * stay can slide into place (`layout`) rather than jump.
 */
const groupIn: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { ...transition.base, delay: 0.18 + Math.min(i, FOLD_AT) * 0.04 },
  }),
  exit: { opacity: 0, transition: transition.fast },
};

const extraIn: Variants = {
  hidden: { opacity: 0, y: -4 },
  show: { opacity: 1, y: 0, transition: transition.base },
};

/*
 * Below `lg` the table stops being a grid of columns and each student becomes
 * a small card: name and severity on one line, what the system saw under it,
 * then trend and actions. Ten columns' worth of detail does not fit a phone,
 * and a sideways-scrolling table hides exactly the column that matters.
 */
const CELL = "align-top whitespace-normal max-lg:block max-lg:p-0 lg:py-4";

/**
 * "Students who need you this week." Driven by open flags rather than by the
 * roster, because a director does not want a list of 312 students — he wants
 * the handful the system can justify interrupting his week for.
 */
export function TriageTable({
  groups,
  onIntervene,
}: {
  groups: StudentGroup[];
  onIntervene: (flag: Flag) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  if (!groups.length) {
    return (
      <EmptyState
        title="Nothing open in this batch"
        body="No detector has raised a flag it can justify. That is the intended resting state — a console that flags everyone gets ignored by week three."
      />
    );
  }

  // Only fold when it saves real scrolling; hiding two rows behind a button
  // costs more than it saves.
  const folded = !showAll && groups.length > FOLD_AT + 3;
  const visible = folded ? groups.slice(0, FOLD_AT) : groups;

  return (
    <Card className="gap-0 py-0">
      <Table className="border-separate border-spacing-0 max-lg:block">
        <caption className="sr-only">
          Students with open flags, worst severity first, then longest open. Each
          student&rsquo;s other open flags fold under their row.
        </caption>
        <TableHeader className="max-lg:sr-only">
          <TableRow className="hover:bg-transparent">
            <Th className="w-72 pl-5">Student</Th>
            <Th className="w-[1%]">Severity</Th>
            <Th>What the system saw</Th>
            <Th className="w-[1%] text-right">Mock trend</Th>
            <Th className="w-[1%] pr-5 text-right">
              <span className="sr-only">Actions</span>
            </Th>
          </TableRow>
        </TableHeader>

        <AnimatePresence initial>
          {visible.map((group, index) => (
            <StudentRows
              key={group.studentId}
              group={group}
              index={index}
              onIntervene={onIntervene}
            />
          ))}
        </AnimatePresence>
      </Table>

      {folded ? (
        <div className="border-t border-border px-5 py-3 text-center">
          <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
            Show all {num(groups.length)} students
            <ChevronDown aria-hidden />
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function Th({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <TableHead
      scope="col"
      className={cn(
        "h-10 border-b border-border bg-muted/30 px-3 text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
    </TableHead>
  );
}

/**
 * One student: a `<tbody>` of their own, so the group is one unit to the eye,
 * to hover, and to the layout animation. The worst flag is the row; the rest
 * sit beneath it, in the DOM but hidden until asked for, each with its own
 * "Log intervention" because an intervention is recorded against one flag.
 */
function StudentRows({
  group,
  index,
  onIntervene,
}: {
  group: StudentGroup;
  index: number;
  onIntervene: (flag: Flag) => void;
}) {
  const [open, setOpen] = useState(false);
  const [top, ...rest] = group.flags;
  const { student } = group;
  const extraIds = rest.map((flag) => `triage-flag-${flag.id}`);

  return (
    <motion.tbody
      layout="position"
      custom={index}
      variants={groupIn}
      initial="hidden"
      animate="show"
      exit="exit"
      className="transition-colors duration-150 hover:bg-muted/40 max-lg:block max-lg:border-t max-lg:border-border max-lg:first-of-type:border-t-0"
    >
      <tr
        data-flag-id={top.id}
        style={railStyle(top)}
        className="max-lg:flex max-lg:flex-wrap max-lg:items-start max-lg:gap-x-3 max-lg:gap-y-2.5 max-lg:py-4 max-lg:pr-4 max-lg:pl-5 max-lg:shadow-[inset_3px_0_0_var(--rail)]"
      >
        <td className={cn(CELL, "max-lg:min-w-0 max-lg:flex-1 lg:pr-3 lg:pl-5 lg:shadow-[inset_3px_0_0_var(--rail)]", firstBorder)}>
          <Link
            to={`/students/${top.student_id}`}
            className="rounded-sm text-[15px] font-semibold text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {top.student_name}
          </Link>
          <div className="tnum mt-0.5 text-xs leading-snug text-muted-foreground">
            {student?.roll_no ? `${student.roll_no} · ` : ""}
            {top.batch_name} · {top.mentor_name}
          </div>
        </td>

        <td className={cn(CELL, "max-lg:shrink-0 lg:px-3 lg:pt-4.5", firstBorder)}>
          <SeverityChip severity={top.severity} />
        </td>

        <td className={cn(CELL, "max-lg:basis-full lg:px-3", firstBorder)}>
          <FlagSummary flag={top} />
          {rest.length ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={extraIds.join(" ")}
              onClick={() => setOpen((value) => !value)}
              className="group/more mt-2 inline-flex items-center gap-1 rounded-sm text-xs font-medium text-brand-ink outline-none hover:underline hover:underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {open
                ? `Hide ${rest.length === 1 ? "the other flag" : `the other ${rest.length} flags`}`
                : `+${rest.length} more: ${rest.map((flag) => detectorLabel(flag.type)).join(", ")}`}
              <ChevronDown
                aria-hidden
                className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")}
              />
            </button>
          ) : null}
        </td>

        <td className={cn(CELL, "max-lg:min-w-0 max-lg:flex-1 max-lg:self-center lg:px-3 lg:text-right", firstBorder)}>
          <TrendCell value={student?.mock_trend} avg={student?.mock_avg} />
        </td>

        <td className={cn(CELL, "max-lg:shrink-0 max-lg:self-center lg:pr-5 lg:pl-3", firstBorder)}>
          {/* "Log intervention" sits last, on the right edge, so it lines up
              with the same button on the student's other flags below. */}
          <div className="flex items-center justify-end gap-1.5">
            <Button size="sm" variant="ghost" asChild>
              <Link
                to={`/students/${top.student_id}`}
                aria-label={`Open ${top.student_name}'s 360 view`}
              >
                Open
                <ArrowRight aria-hidden className="size-3.5" />
              </Link>
            </Button>
            <InterveneButton flag={top} onIntervene={onIntervene} />
          </div>
        </td>
      </tr>

      {rest.map((flag, i) => (
        <motion.tr
          key={flag.id}
          id={extraIds[i]}
          data-flag-id={flag.id}
          hidden={!open}
          initial={false}
          animate={open ? "show" : "hidden"}
          variants={extraIn}
          style={railStyle(flag)}
          className="max-lg:flex max-lg:flex-wrap max-lg:items-center max-lg:gap-x-3 max-lg:gap-y-2 max-lg:border-t max-lg:border-dashed max-lg:border-border max-lg:py-3.5 max-lg:pr-4 max-lg:pl-5 max-lg:shadow-[inset_3px_0_0_var(--rail)]"
        >
          <td className={cn(CELL, "max-lg:sr-only lg:pl-5 lg:shadow-[inset_3px_0_0_var(--rail)]", extraBorder)}>
            <span className="sr-only">{flag.student_name}, another open flag</span>
          </td>
          <td className={cn(CELL, "max-lg:flex-1 lg:px-3 lg:pt-4.5", extraBorder)}>
            <SeverityChip severity={flag.severity} />
          </td>
          <td className={cn(CELL, "max-lg:order-3 max-lg:basis-full lg:px-3", extraBorder)}>
            <FlagSummary flag={flag} />
          </td>
          <td className={cn(CELL, "max-lg:hidden", extraBorder)} />
          <td className={cn(CELL, "max-lg:order-2 max-lg:shrink-0 lg:pr-5 lg:pl-3", extraBorder)}>
            <div className="flex justify-end">
              <InterveneButton flag={flag} onIntervene={onIntervene} />
            </div>
          </td>
        </motion.tr>
      ))}
    </motion.tbody>
  );
}

/** The top border between students, on the cells — see `railStyle`. */
const firstBorder = "lg:border-t lg:border-border lg:[tbody:first-of-type_&]:border-t-0";
/** A fainter rule between a student's own flags. */
const extraBorder = "lg:border-t lg:border-dashed lg:border-border/80";

/**
 * The severity rail down the row's left edge: a second, faster cue than the
 * chip for a room scanning from the back. Colour is never alone here — the
 * chip beside it carries the icon and the word. Drawn as an inset shadow on
 * the cell (and on the row, in the stacked layout) because borders in a
 * separated table belong to cells, and a cell's own paint moves with the
 * layout animation where a collapsed table border would not.
 */
function railStyle(flag: Flag): CSSProperties {
  return { "--rail": SEVERITY[flag.severity].color } as CSSProperties;
}

function FlagSummary({ flag }: { flag: Flag }) {
  return (
    <>
      <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {detectorLabel(flag.type)}
        <span className="font-normal tracking-normal normal-case">
          {" "}
          · raised {daysAgo(flag.raised_at)}
        </span>
      </div>
      <p className="mt-1 max-w-[62ch] text-sm leading-snug text-foreground">
        {flag.headline}
      </p>
    </>
  );
}

function InterveneButton({
  flag,
  onIntervene,
}: {
  flag: Flag;
  onIntervene: (flag: Flag) => void;
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => onIntervene(flag)}
      aria-label={`Log intervention for ${flag.student_name}: ${detectorLabel(flag.type)}`}
    >
      Log intervention
    </Button>
  );
}

/** Direction is carried by an arrow and a sign, not by the colour alone. */
function TrendCell({
  value,
  avg,
}: {
  value: number | null | undefined;
  avg: number | null | undefined;
}) {
  const Icon = value == null ? null : value > 0 ? MoveUp : value < 0 ? MoveDown : MoveRight;
  const tone =
    value == null || value === 0
      ? "text-muted-foreground"
      : value > 0
        ? "text-status-good"
        : "text-status-critical";
  return (
    <div className="whitespace-nowrap">
      <span className={cn("tnum inline-flex items-center gap-1 text-sm font-semibold", tone)}>
        {Icon ? <Icon aria-hidden className="size-3" /> : null}
        {signed(value)}
        <span className="sr-only"> marks across the mock series</span>
      </span>
      <div className="tnum mt-0.5 text-xs text-muted-foreground max-lg:ml-1.5 max-lg:inline">
        avg {num(avg, 1)}
      </div>
    </div>
  );
}
