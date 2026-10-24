import { forwardRef, useRef, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AnimatedBeam } from "@/components/ui/animated-beam";
import { cn } from "@/lib/utils";

export interface RuleStop {
  icon: LucideIcon;
  title: string;
  /** What this party does — and, as often, what it never does. */
  line: ReactNode;
  /** The AI's stop: the one a sceptic will ask about. */
  accent?: boolean;
}

/**
 * Who does what, as one picture: data → AI → teacher.
 *
 * The beam traces each hand-off once, left to right, while the headline above
 * it is still arriving — then the strip is still. It never loops: this sits
 * right under the sentence the presenter is reading out. Under reduced motion
 * the beam is just its static path (the patched AnimatedBeam handles that).
 */
export function RuleBeam({
  stops,
  label,
  className,
}: {
  stops: [RuleStop, RuleStop, RuleStop];
  /** The picture as one sentence, for assistive tech. */
  label: string;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const a = useRef<HTMLDivElement>(null);
  const b = useRef<HTMLDivElement>(null);
  const c = useRef<HTMLDivElement>(null);
  const refs = [a, b, c];

  return (
    <figure
      aria-label={label}
      className={cn(
        "relative rounded-2xl border border-border bg-card/85 px-3 py-5 shadow-card backdrop-blur-sm sm:px-8 sm:py-6",
        className,
      )}
    >
      <div ref={box} className="relative">
        <ol className="relative z-10 grid grid-cols-3 gap-2 sm:gap-8">
          {stops.map((stop, i) => (
            <li key={stop.title} className="flex min-w-0 flex-col items-center text-center">
              <BeamNode ref={refs[i]} icon={stop.icon} accent={stop.accent} />
              <p className="mt-2.5 text-sm leading-tight font-semibold text-foreground sm:text-base">
                {stop.title}
              </p>
              <p className="mt-1 max-w-[26ch] text-xs leading-snug text-muted-foreground">
                {stop.line}
              </p>
            </li>
          ))}
        </ol>
        <AnimatedBeam
          containerRef={box}
          fromRef={a}
          toRef={b}
          repeat={0}
          duration={1.4}
          delay={0.5}
        />
        <AnimatedBeam
          containerRef={box}
          fromRef={b}
          toRef={c}
          repeat={0}
          duration={1.4}
          delay={1.3}
        />
      </div>
    </figure>
  );
}

const BeamNode = forwardRef<HTMLDivElement, { icon: LucideIcon; accent?: boolean }>(
  function BeamNode({ icon: Icon, accent }, ref) {
    return (
      <div
        ref={ref}
        aria-hidden
        className={cn(
          "relative z-10 flex size-11 items-center justify-center rounded-lg bg-card shadow-raised ring-1 sm:size-14",
          accent ? "text-brand-ink ring-brand-line" : "text-foreground ring-border",
        )}
      >
        <Icon className="size-5 sm:size-6" />
      </div>
    );
  },
);
