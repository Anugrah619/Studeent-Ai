import { ReactFlow, type ReactFlowProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTheme } from "@/theme/theme-provider";
import { cn } from "@/lib/utils";

interface FlowCanvasProps extends Omit<ReactFlowProps, "height" | "width"> {
  /** What the diagram shows, for assistive tech. Say it as a sentence. */
  label: string;
  /** React Flow needs an explicit height. */
  height?: number | string;
  /**
   * Let the viewer pan, zoom and drag. Off by default: in a pitch a diagram is
   * a picture to be read, and a stray scroll that zooms it is a lost minute.
   */
  interactive?: boolean;
}

/**
 * React Flow, set up for this app: themed from our tokens (see `.react-flow`
 * in index.css), static unless asked, and never swallowing the page's
 * scroll. Props pass straight through, so anything here can be overridden.
 */
export function FlowCanvas({
  label,
  height = 360,
  interactive = false,
  className,
  ...props
}: FlowCanvasProps) {
  const { theme } = useTheme();

  return (
    <div role="figure" aria-label={label} className={cn("w-full", className)} style={{ height }}>
      <ReactFlow
        colorMode={theme}
        fitView
        nodesDraggable={interactive}
        nodesConnectable={false}
        elementsSelectable={interactive}
        panOnDrag={interactive}
        zoomOnScroll={false}
        zoomOnPinch={interactive}
        zoomOnDoubleClick={false}
        panOnScroll={false}
        preventScrolling={false}
        {...props}
      />
    </div>
  );
}
