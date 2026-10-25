import { Suspense, useLayoutEffect, useRef } from "react";
import {
  Link,
  Outlet,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import { LayoutGroup, motion } from "motion/react";
import { Database, Wifi } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { StudentSwitcher } from "./StudentSwitcher";
import { BrandMark } from "@/components/brand/BrandMark";
import { USE_MOCKS } from "@/api/env";
import { RouteSkeleton } from "@/components/common/States";
import { useMe } from "@/api/session";
import { useBatches } from "@/api/queries";
import type { Batch } from "@/api/types";
import { transition } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface NavItemDef {
  to: string;
  label: string;
  /** Whether this item is the current section, given the path. */
  active: (pathname: string) => boolean;
}

const NAV: NavItemDef[] = [
  { to: "/", label: "Director console", active: (p) => p === "/" },
  // Lit for every student, not only the one the link opens: on /students/7
  // the reader is still in Student 360, and an unlit nav says otherwise.
  { to: "/students/1", label: "Student 360", active: (p) => p.startsWith("/students/") },
  // Staff tools: a paper's blueprint, results and tags; the answer-key queue.
  { to: "/papers", label: "Papers", active: (p) => p.startsWith("/papers") },
  { to: "/review", label: "Review", active: (p) => p.startsWith("/review") },
  // The explanation layer: how a diagnosis is made, and why to trust it. In
  // the main navigation rather than a footer, because in a pitch they are the
  // pages a director is shown second, right after the console.
  { to: "/how-it-works", label: "How it works", active: (p) => p.startsWith("/how-it-works") },
  { to: "/trust", label: "Data & trust", active: (p) => p.startsWith("/trust") },
];

/**
 * The masthead is the institute's letterhead: the name of the institute the
 * signed-in account actually belongs to, in the serif a printed result sheet
 * would use, with the product and the place beneath it.
 *
 * It used to be hardcoded, because there was no endpoint to ask. `/api/me/` is
 * in the contract now and carries `institute`, so the console stops asserting
 * "Aarambh Classes" at whoever is logged in and reads it instead — with the
 * static pair as the pre-login placeholder, not as the answer.
 */
export function AppShell() {
  const me = useMe();
  const institute = me.data?.institute;
  const batches = useBatches();
  const intake = intakeLine(batches.data);
  const location = useLocation();
  const navigationType = useNavigationType();
  const lastPath = useRef(location.pathname);

  // A new page starts at its top. Only on a forward navigation to a different
  // path: Back and Forward ("POP") are left to the browser, which restores
  // the reader's place, and a query-string change (a filter) is not a new page.
  useLayoutEffect(() => {
    if (lastPath.current === location.pathname) return;
    lastPath.current = location.pathname;
    if (navigationType !== "POP") window.scrollTo({ top: 0 });
  }, [location.pathname, navigationType]);

  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-popover focus:px-3 focus:py-2 focus:text-sm focus:shadow-raised focus:ring-3 focus:ring-ring/50"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-4 px-4 sm:px-6">
          <Link
            to="/"
            className="flex min-w-0 items-center gap-3 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <BrandMark className="text-brand-ink" />
            <div className="min-w-0 leading-tight">
              <div className="truncate font-serif text-lg font-semibold tracking-tight">
                {institute?.name ?? "Student AI"}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {/* On a phone the bar has no room for the demo chip beside the
                    switcher, so the label takes this line instead. */}
                {USE_MOCKS ? (
                  <span className="mr-2 inline-flex items-center gap-1 font-medium text-foreground sm:hidden">
                    <Database aria-hidden className="size-3.5 text-brand-ink" />
                    Demo data
                  </span>
                ) : null}
                <span className={USE_MOCKS ? "hidden sm:inline" : undefined}>
                  {institute
                    ? [institute.city, intake].filter(Boolean).join(", ")
                    : "No institute on this account"}
                </span>
              </div>
            </div>
          </Link>

          <nav aria-label="Primary" className="ml-6 hidden items-center gap-1 2xl:flex">
            <NavItems group="desktop" pathname={location.pathname} />
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <FixtureBadge />
            {/* A 184px select does not fit a phone's masthead beside the
                letterhead; every student is one tap from the triage table. */}
            <div className="hidden md:block">
              <StudentSwitcher />
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Below `2xl` six inline links, the fixture badge and the student
          switcher do not fit one bar — at tablet width the masthead pushed
          the page sideways. Below `md` the nav used to simply vanish, so on a
          phone nothing but the console was reachable. A scrolling row under
          the masthead fixes both, without a menu to open first. */}
      <nav
        aria-label="Primary"
        className="sticky top-16 z-20 border-b border-border bg-background/85 backdrop-blur-xl 2xl:hidden"
      >
        <div className="mx-auto flex max-w-[1440px] gap-1 overflow-x-auto px-4 py-1.5 sm:px-6">
          <NavItems group="compact" pathname={location.pathname} />
        </div>
      </nav>

      <main id="main" tabIndex={-1} className="mx-auto max-w-[1440px] px-4 pb-20 outline-none sm:px-6">
        {/* Keyed on the path, so each page starts from its own state — the same
            component on a new student must not inherit the last one's. Same
            path with a new query string (a filter) keeps the page and its
            state. A page used to fade up as it arrived; it is simply there. */}
        <div key={location.pathname}>
          {/* Inside the keyed wrapper, so a screen whose chunk is still on its
              way shows the skeleton in its place and the shell never blanks. */}
          <Suspense fallback={<RouteSkeleton />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

/**
 * The tabs. The page you are on is the filled bubble — the option that was
 * picked — and it slides to whichever tab is current, so moving along the bar
 * is the one motion here and it answers a click. The others wait as empty space
 * where a bubble would be, so the row never shifts. Colour and the bubble say
 * it together; neither is the only cue. Each of the two navs (desktop,
 * compact) has its own group, or the bubble would try to fly between a visible
 * bar and a hidden one.
 */
function NavItems({ group, pathname }: { group: string; pathname: string }) {
  return (
    <LayoutGroup id={`nav-${group}`}>
      {NAV.map((item) => {
        const active = item.active(pathname);
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active ? (
              <motion.span
                layoutId="active-bubble"
                transition={transition.layout}
                aria-hidden
                className="size-2 rounded-full bg-brand"
              />
            ) : (
              <span aria-hidden className="size-2" />
            )}
            {item.label}
          </Link>
        );
      })}
    </LayoutGroup>
  );
}

/**
 * "JEE 2027 & 2028", from the institute's own batches. It was a literal, which
 * is right for Aarambh and wrong for every other institute — including the
 * seeded second one, whose only batch sits in 2027. Nothing until the batches
 * arrive, rather than a guess.
 */
function intakeLine(batches: Batch[] | undefined): string | null {
  if (!batches?.length) return null;
  const exams = [...new Set(batches.map((b) => b.exam_code.split(/[-_\s]/)[0]))];
  const years = [...new Set(batches.map((b) => b.year))].sort((a, b) => a - b);
  return `${exams.join(" & ")} ${years.join(" & ")}`;
}

/**
 * Which world the console is in, said out loud.
 *
 * On fixtures it says so, because a demo that quietly implies live data is the
 * fastest way to lose a room when someone asks a question the fixtures cannot
 * answer. But the badge used to say "Demo dataset · 14 of 312 students seeded"
 * *unconditionally* — including against a live Django server serving 46 real
 * students, where it is simply false, and false in the one direction that
 * makes a real answer look staged. The count lives in the tooltip now; the
 * badge itself is two words, so it fits the bar at every width it is shown.
 */
function FixtureBadge() {
  if (!USE_MOCKS) {
    return (
      <span
        className="hidden items-center gap-1.5 rounded-sm border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground lg:inline-flex"
        title="Figures come from the live API, except those tagged “Import records” on Data & trust."
      >
        <Wifi aria-hidden className="size-3.5 text-brand-ink" />
        Live API
      </span>
    );
  }

  return (
    <span
      className="hidden items-center gap-1.5 rounded-sm border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground sm:inline-flex"
      title="Served by Mock Service Worker from schema-derived fixtures. 14 of the institute's 312 students are seeded."
    >
      <Database aria-hidden className="size-3.5 text-brand-ink" />
      Demo data
    </span>
  );
}
