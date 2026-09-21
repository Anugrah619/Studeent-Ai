import { useId, useState, type ReactNode } from "react";
import { Table2, BarChart3 } from "lucide-react";
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
        "flex flex-col rounded-xl border border-border bg-card",
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">
            {title}
          </h3>
          {subtitle ? (
            <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          <div
            role="group"
            aria-label="View as"
            className="flex items-center rounded-md border border-border p-0.5"
          >
            <ViewButton
              active={view === "chart"}
              onClick={() => setView("chart")}
              controls={panelId}
              icon={<BarChart3 aria-hidden className="size-3.5" />}
              label="Chart"
            />
            <ViewButton
              active={view === "table"}
              onClick={() => setView("table")}
              controls={panelId}
              icon={<Table2 aria-hidden className="size-3.5" />}
              label="Table"
            />
          </div>
        </div>
      </header>

      {legend ? <div className="px-5 pb-3">{legend}</div> : null}

      <div id={panelId} className="min-w-0 flex-1 px-5 pb-4">
        {view === "chart" ? (
          children
        ) : (
          <div className="overflow-x-auto">{table}</div>
        )}
      </div>

      {footnote ? (
        <footer className="border-t border-border px-5 py-3 text-xs leading-relaxed text-muted-foreground">
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
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  controls: string;
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
        "flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-secondary text-secondary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
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
        <li key={item.label} className="flex items-center gap-2 text-xs">
          <span
            aria-hidden
            className={cn(
              "shrink-0",
              item.shape === "line"
                ? "h-0.5 w-4 rounded-full"
                : item.shape === "dot"
                  ? "size-2.5 rounded-full"
                  : item.wide
                    ? "h-2.5 w-7 rounded-[2px]"
                    : "size-2.5 rounded-[2px]",
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
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground">
          {head}
        </tr>
      </thead>
      <tbody className="tnum divide-y divide-border">{children}</tbody>
    </table>
  );
}
