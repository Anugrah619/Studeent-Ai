import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowLeft, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextLink } from "@/components/kit/TextLink";
import { fadeUp, stagger } from "@/lib/motion";

/**
 * A wrong URL in a demo is usually a typo in the address bar. Say what exists
 * and give one way back — the console — plus the pages someone was most likely
 * reaching for.
 */
export function NotFound() {
  return (
    <motion.div
      variants={stagger(0.06)}
      initial="hidden"
      animate="show"
      className="flex min-h-[65vh] flex-col items-center justify-center py-16 text-center"
    >
      <motion.span
        variants={fadeUp}
        aria-hidden
        className="mb-5 flex size-12 items-center justify-center rounded-full bg-card text-muted-foreground shadow-card ring-1 ring-border"
      >
        <Compass className="size-5" />
      </motion.span>
      <motion.p
        variants={fadeUp}
        className="text-xs font-semibold tracking-[0.08em] text-brand-ink uppercase"
      >
        404 · Not found
      </motion.p>
      <motion.h1
        variants={fadeUp}
        className="mt-2 font-heading text-2xl font-semibold tracking-tight sm:text-3xl"
      >
        No such screen
      </motion.h1>
      <motion.p
        variants={fadeUp}
        className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base"
      >
        Nothing lives at this address. Start from the director console, or open a
        student from the switcher above.
      </motion.p>
      <motion.div
        variants={fadeUp}
        className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-3"
      >
        <Button asChild>
          <Link to="/">
            <ArrowLeft aria-hidden />
            Back to the director console
          </Link>
        </Button>
        <TextLink to="/how-it-works">How it works</TextLink>
        <TextLink to="/trust">Data &amp; trust</TextLink>
      </motion.div>
    </motion.div>
  );
}
