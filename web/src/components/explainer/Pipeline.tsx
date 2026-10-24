import { useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  Handle,
  MarkerType,
  Position,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { ArrowLeft, ArrowRight, type LucideIcon } from "lucide-react";
import { FlowCanvas } from "@/components/kit/FlowCanvas";
import { Button } from "@/components/ui/button";
import { useMeasure } from "@/hooks/use-measure";
import { fadeIn } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { AnchorLink, Eyebrow, SourceTag } from "./Exhibit";

/**
 * The pipeline as a diagram you can click through.
 *
 * Built for the founder at a projector: each stop is a button, the panel under
 * the diagram explains that stop in plain words beside the same step on a real
 * student's answers, and Previous / Next walk it in order without hunting for
 * the next box. The diagram is a picture of the order; the panel carries the
 * meaning, so nothing is lost when the diagram becomes a plain list on a phone.
 */

/** Who does the work at a stop. The point of the diagram is that this varies. */
export type StopActor = "system" | "code" | "ai" | "teacher";

export interface PipelineStop {
  id: string;
  title: string;
  actor: StopActor;
  icon: LucideIcon;
  /** What happens here, in plain words. */
  explain: ReactNode;
  /** The same step, on the example student's real answers. */
  example: ReactNode;
  /** The full step further down the page. */
  more?: { href: `#${string}`; label: string };
}

const ACTOR: Record<StopActor, { label: string; chip: string }> = {
  system: { label: "The system", chip: "border-border text-muted-foreground" },
  code: { label: "Exact counting", chip: "border-border text-muted-foreground" },
  // The AI's chip is the one place the brand appears in the diagram: it marks
  // the single box a sceptic will ask about, not a data series.
  ai: { label: "The AI", chip: "border-brand-line bg-brand-soft text-brand-ink" },
  teacher: { label: "A teacher", chip: "border-foreground/25 text-foreground" },
};

type Layout = "row" | "wrap" | "list";

const NODE_W = 164;
const NODE_H = 96;
const GAP_X = 44;
const GAP_Y = 64;

/**
 * One row when the canvas is wide enough to keep the type at full size, two
 * rows of three in between, and a plain list on a phone — React Flow scaled to
 * 390px would shrink the words below reading size.
 */
function layoutFor(width: number, count: number): Layout {
  const row = count * NODE_W + (count - 1) * GAP_X;
  if (width >= row * 1.06) return "row";
  if (width >= 600) return "wrap";
  return "list";
}

interface StopNodeData extends Record<string, unknown> {
  stop: PipelineStop;
  index: number;
  total: number;
  active: boolean;
  panelId: string;
  onSelect: (index: number) => void;
  source: Position;
  target: Position;
}

type StopNodeType = Node<StopNodeData, "stop">;

/** Handles exist only so edges have somewhere to attach; nothing connects. */
const HIDDEN_HANDLE = { opacity: 0, pointerEvents: "none" } as const;

function StopNode({ data }: NodeProps<StopNodeType>) {
  return (
    <>
      <Handle type="target" position={data.target} isConnectable={false} style={HIDDEN_HANDLE} />
      <StopButton
        stop={data.stop}
        index={data.index}
        total={data.total}
        active={data.active}
        panelId={data.panelId}
        onSelect={data.onSelect}
        // One fixed size in the diagram: equal heights put every handle on one
        // line, so the edges run straight instead of stepping.
        style={{ width: NODE_W, height: NODE_H }}
      />
      <Handle type="source" position={data.source} isConnectable={false} style={HIDDEN_HANDLE} />
    </>
  );
}

const NODE_TYPES: NodeTypes = { stop: StopNode };

function StopButton({
  stop,
  index,
  total,
  active,
  panelId,
  onSelect,
  compact = false,
  className,
  style,
}: {
  stop: PipelineStop;
  index: number;
  total: number;
  active: boolean;
  panelId: string;
  onSelect: (index: number) => void;
  /** One line, for the phone list — a 96px box per stop pushes the panel off screen. */
  compact?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const Icon = stop.icon;
  const actor = ACTOR[stop.actor];

  const number = (
    <span
      className={cn(
        "tnum flex size-5 shrink-0 items-center justify-center rounded-sm text-xs font-semibold",
        active ? "bg-brand text-brand-foreground" : "border border-foreground/25 text-foreground",
      )}
    >
      {index + 1}
    </span>
  );
  const chip = (
    <span
      className={cn(
        "ml-auto shrink-0 truncate rounded-sm border px-1.5 py-0.5 text-xs font-medium",
        actor.chip,
      )}
    >
      {actor.label}
    </span>
  );

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-controls={panelId}
      aria-label={`Step ${index + 1} of ${total}: ${stop.title} (${actor.label})`}
      onClick={() => onSelect(index)}
      className={cn(
        "flex cursor-pointer rounded-xl border bg-card text-left shadow-card transition-[border-color,box-shadow,background-color] duration-150 outline-none hover:shadow-raised focus-visible:ring-3 focus-visible:ring-ring/50",
        compact ? "items-center gap-2 px-3 py-2.5" : "flex-col justify-between gap-2 px-3 py-2.5",
        active
          ? "border-brand ring-1 ring-brand"
          : "border-border hover:border-foreground/30",
        className,
      )}
      style={compact ? style : { minHeight: NODE_H, ...style }}
    >
      {compact ? (
        <span aria-hidden className="flex min-w-0 flex-1 items-center gap-2">
          {number}
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">
            {stop.title}
          </span>
          {chip}
        </span>
      ) : (
        <>
          <span aria-hidden className="flex w-full items-center gap-1.5">
            {number}
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            {chip}
          </span>
          <span
            aria-hidden
            className="line-clamp-2 text-[13px] leading-snug font-semibold text-foreground"
          >
            {stop.title}
          </span>
        </>
      )}
    </button>
  );
}

function place(index: number, count: number, layout: Exclude<Layout, "list">) {
  if (layout === "row") {
    return {
      position: { x: index * (NODE_W + GAP_X), y: 0 },
      target: Position.Left,
      source: Position.Right,
    };
  }
  // Two rows that both read left to right, like a wrapped line of text; the
  // edge from the end of the first row drops to the start of the second.
  const perRow = Math.ceil(count / 2);
  const col = index % perRow;
  const row = Math.floor(index / perRow);
  return {
    position: { x: col * (NODE_W + GAP_X), y: row * (NODE_H + GAP_Y) },
    target: index === perRow ? Position.Top : Position.Left,
    source: index === perRow - 1 ? Position.Bottom : Position.Right,
  };
}

export function Pipeline({
  stops,
  label,
  endpoints,
  exampleLabel,
}: {
  stops: PipelineStop[];
  /** The diagram as one sentence, for assistive tech. */
  label: string;
  /** Routes behind the live examples, for the source tag. */
  endpoints: string[];
  /** Heading over the example column — "On Aarav's answers". */
  exampleLabel: string;
}) {
  const [active, setActive] = useState(0);
  const panelId = useId();
  const { ref, width } = useMeasure<HTMLDivElement>();
  const layout = width > 0 ? layoutFor(width, stops.length) : null;

  const stop = stops[active] ?? stops[0];

  const nodes = useMemo<StopNodeType[]>(() => {
    if (!layout || layout === "list") return [];
    return stops.map((s, index) => {
      const at = place(index, stops.length, layout);
      return {
        id: s.id,
        type: "stop",
        position: at.position,
        focusable: false,
        data: {
          stop: s,
          index,
          total: stops.length,
          active: index === active,
          panelId,
          onSelect: setActive,
          source: at.source,
          target: at.target,
        },
      };
    });
  }, [stops, layout, active, panelId]);

  const edges = useMemo<Edge[]>(
    () =>
      stops.slice(1).map((s, i) => {
        // The edge into the open stop is drawn in ink; the rest stay chrome.
        const lit = i + 1 === active;
        const color = lit ? "var(--foreground)" : "var(--muted-foreground)";
        return {
          id: `${stops[i].id}->${s.id}`,
          source: stops[i].id,
          target: s.id,
          type: "smoothstep",
          focusable: false,
          style: { stroke: color, strokeWidth: lit ? 2 : 1.5, opacity: lit ? 0.9 : 0.55 },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        };
      }),
    [stops, active],
  );

  const height = layout === "row" ? NODE_H + 48 : NODE_H * 2 + GAP_Y + 48;

  return (
    <div>
      <div ref={ref} className="min-w-0">
        {layout === null ? (
          <div style={{ height: NODE_H + 48 }} />
        ) : layout === "list" ? (
          <ol aria-label={label} className="space-y-0">
            {stops.map((s, index) => (
              <li key={s.id} className="flex flex-col items-stretch">
                <StopButton
                  stop={s}
                  index={index}
                  total={stops.length}
                  active={index === active}
                  panelId={panelId}
                  onSelect={setActive}
                  compact
                  className="w-full"
                />
                {index < stops.length - 1 ? (
                  <span aria-hidden className="ml-[1.375rem] h-2.5 w-px bg-border" />
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <FlowCanvas
            // A new layout is a new picture: remount so it is fitted afresh.
            key={layout}
            label={label}
            height={height}
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            nodesFocusable={false}
            edgesFocusable={false}
            // React Flow gives a node that is neither selectable, draggable nor
            // clickable `pointer-events: none` — which would make the button
            // inside it dead to the mouse. A click handler keeps it live, and
            // makes the whole box (not just the button's text) the target.
            onNodeClick={(_, node) => {
              const index = stops.findIndex((s) => s.id === node.id);
              if (index >= 0) setActive(index);
            }}
            fitViewOptions={{ padding: 0.06, maxZoom: 1 }}
          />
        )}
      </div>

      <section
        id={panelId}
        aria-labelledby={`${panelId}-title`}
        className="mt-4 overflow-hidden rounded-xl border border-border bg-card shadow-card"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border bg-muted/40 px-4 py-2">
          <h3
            id={`${panelId}-title`}
            className="min-w-0 text-sm font-semibold text-foreground"
          >
            <span className="tnum text-muted-foreground">
              Step {active + 1} of {stops.length} ·{" "}
            </span>
            {stop.title}
          </h3>
          <div className="flex items-center gap-1.5">
            <SourceTag endpoints={endpoints} className="hidden sm:inline-flex" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActive((i) => Math.max(0, i - 1))}
              disabled={active === 0}
              aria-label="Previous step"
            >
              <ArrowLeft aria-hidden />
              <span className="hidden sm:inline">Previous</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActive((i) => Math.min(stops.length - 1, i + 1))}
              disabled={active === stops.length - 1}
              aria-label="Next step"
            >
              <span className="hidden sm:inline">Next</span>
              <ArrowRight aria-hidden />
            </Button>
          </div>
        </div>

        {/* Announce the change in a few words, not the whole panel. */}
        <p className="sr-only" aria-live="polite">
          {`Showing step ${active + 1} of ${stops.length}: ${stop.title}.`}
        </p>

        <motion.div
          key={stop.id}
          variants={fadeIn}
          initial="hidden"
          animate="show"
          className="grid gap-5 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-8"
        >
          <div className="min-w-0">
            <Eyebrow>In plain words</Eyebrow>
            <div className="mt-2 max-w-prose space-y-2.5 text-sm leading-relaxed text-foreground">
              {stop.explain}
            </div>
            {stop.more ? (
              <p className="mt-3">
                <AnchorLink href={stop.more.href}>{stop.more.label}</AnchorLink>
              </p>
            ) : null}
          </div>
          <div className="min-w-0 rounded-lg border border-border bg-background/60 px-3.5 py-3">
            <Eyebrow>{exampleLabel}</Eyebrow>
            <div className="mt-2 text-sm leading-relaxed text-foreground">{stop.example}</div>
          </div>
        </motion.div>
      </section>
    </div>
  );
}
