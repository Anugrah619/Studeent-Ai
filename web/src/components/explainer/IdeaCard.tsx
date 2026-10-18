import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { TextLink } from "@/components/kit/TextLink";
import { MagicCard } from "@/components/ui/magic-card";
import { cn } from "@/lib/utils";
import { AnchorLink } from "./Exhibit";

/**
 * One idea, or one promise, on a card a director can take in at a glance:
 * the claim as a heading, a sentence of support, and a link to the proof.
 *
 * The hover spotlight (MagicCard) follows the pointer and settles when it
 * leaves — it never moves on its own, so it is safe beside text. The card is
 * not itself a link: the link says where it goes, and the card's heading stays
 * a heading for anyone navigating by them.
 */
export function IdeaCard({
  icon: Icon,
  title,
  body,
  to,
  cta,
  status,
  specimen,
  className,
}: {
  icon: LucideIcon;
  title: ReactNode;
  body: ReactNode;
  /** `#id` jumps on this page; anything else is a route. */
  to: string;
  cta: string;
  /** A short state in words — "Hard rule", "Awaiting a person". */
  status?: ReactNode;
  /** A small piece of the real thing — a citation, a code — that shows the idea. */
  specimen?: ReactNode;
  className?: string;
}) {
  return (
    <MagicCard
      // MagicCard wraps its children in one last div; stretch it so the link
      // can sit at the foot of every card in a row, whatever the body length.
      className={cn("h-full rounded-xl shadow-card [&>div:last-child]:h-full", className)}
      gradientSize={260}
    >
      <div className="flex h-full flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground">
            <Icon aria-hidden className="size-4.5" />
          </span>
          {status ? (
            <span className="rounded-sm border border-border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {status}
            </span>
          ) : null}
        </div>
        <h3 className="mt-4 font-heading text-base leading-snug font-semibold tracking-tight text-balance text-foreground sm:text-lg">
          {title}
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
        {specimen ? <div className="mt-3.5">{specimen}</div> : null}
        <div className="flex-1" />
        <p className="pt-4">
          {to.startsWith("#") ? (
            <AnchorLink href={to as `#${string}`}>{cta}</AnchorLink>
          ) : (
            <TextLink to={to} className="text-sm">
              {cta}
            </TextLink>
          )}
        </p>
      </div>
    </MagicCard>
  );
}
