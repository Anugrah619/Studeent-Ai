import { useId, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Table2, BarChart3 } from "lucide-react";
import { fadeIn, transition } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface FigureProps {
  title: string;
  /** One sentence that says what the reader is looking at. */
  subtitle?: ReactNode;
  legend?: ReactNode;
  /** The WCAG-clean twin. Every value in the chart must be reachable here. */
  table: ReactNode;
  footnote?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * Chart chrome, in one place: heading, legend, and the table view every chart
 * owes its reader. A tooltip may enhance a value but must never be the only way
 * to reach it.
 */
export function Figure({
  title,
  subtitle,
  legend,
  table,
  footnote,
  action,
  className,
  children,
}: FigureProps) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const panelId = useId();

  return (
    <section
      className={cn(
        // The card surface, as `ui/card` draws it. `bg-card` is the same value
        // as `--chart-surface`, which the charts paint their 2px gaps and dot
        // rings in — so a gap reads as a gap, never as a hairline.
        "flex flex-col rounded-xl bg-card text-card-foreground shadow-card ring-1 ring-foreground/10",
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-6 pt-5 pb-4">
        <div className="min-w-0 flex-1 basis-64">
          <h3 className="text-base leading-snug font-semibold tracking-tight text-foreground">
            {title}
          </h3>
          {subtitle ? (
            <p className="mt-1 max-w-[46ch] text-sm leading-relaxed text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          <div
            role="group"
            aria-label="View as"
            className="flex items-center rounded-md border border-border bg-card p-0.5"
          >
            <ViewButton
              active={view === "chart"}
              onClick={() => setView("chart")}
              controls={panelId}
              pillId={`${panelId}-pill`}
              icon={<BarChart3 aria-hidden className="size-4" />}
              label="Chart"
            />
            <ViewButton
              active={view === "table"}
              onClick={() => setView("table")}
              controls={panelId}
              pillId={`${panelId}-pill`}
              icon={<Table2 aria-hidden className="size-4" />}
              label="Table"
            />
          </div>
        </div>
      </header>

      {legend ? <div className="px-6 pb-4">{legend}</div> : null}

      {/* A flex column, so a chart that wants the figure's full height (the
          trend line, in a two-up row) can take it with `flex-1`. */}
      <div id={panelId} className="flex min-w-0 flex-1 flex-col px-6 pb-5">
        {view === "chart" ? (
          children
        ) : (
          <motion.div
            variants={fadeIn}
            initial="hidden"
            animate="show"
            className="relative overflow-x-auto"
          >
            {table}
          </motion.div>
        )}
      </div>

      {footnote ? (
        <footer className="rounded-b-xl border-t border-border bg-muted/40 px-6 py-3.5 text-sm leading-relaxed text-muted-foreground">
          {footnote}
        </footer>
      ) : null}
    </section>
  );
}

function ViewButton({
  active,
  onClick,
  controls,
  pillId,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  controls: string;
  /** Shared by the pair, so the pill slides between them instead of blinking. */
  pillId: string;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-controls={controls}
      className={cn(
        "relative flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
        active
          ? "text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {active ? (
        <motion.span
          layoutId={pillId}
          transition={transition.layout}
          aria-hidden
          className="absolute inset-0 rounded-sm bg-foreground"
        />
      ) : null}
      <span className="relative flex items-center gap-1.5">
        {icon}
        {label}
      </span>
    </button>
  );
}

/** Swatch + text. Identity never comes from colouring the text itself. */
export interface LegendItem {
  /** Any CSS background — a colour, or a hard-stop gradient for a keyed set. */
  color: string;
  label: string;
  value?: string;
  shape?: "line" | "dot" | "block";
  /** Wider swatch, for a multi-stop key. */
  wide?: boolean;
}

export function Legend({
  items,
  className,
}: {
  items: LegendItem[];
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-5 gap-y-1.5", className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 text-sm">
          <span
            aria-hidden
            className={cn(
              "shrink-0",
              item.shape === "line"
                ? "h-0.5 w-4 rounded-full"
                : item.shape === "dot"
                  ? "size-2.5 rounded-full"
                  : item.wide
                    ? "h-3 w-7 rounded-[2px]"
                    : "size-3 rounded-[2px]",
            )}
            style={{ background: item.color }}
          />
          <span className="text-muted-foreground">{item.label}</span>
          {item.value ? (
            <span className="tnum font-medium text-foreground">{item.value}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Shared table styling so every chart's twin looks like the same object. */
export function FigureTable({
  head,
  children,
}: {
  head: ReactNode;
  children: ReactNode;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs text-muted-foreground">
          {head}
        </tr>
      </thead>
      <tbody className="tnum divide-y divide-border">{children}</tbody>
    </table>
  );
}
