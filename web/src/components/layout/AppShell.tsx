import { Suspense, useLayoutEffect, useRef } from "react";
import {
  Link,
  Outlet,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import { LayoutGroup, motion } from "motion/react";
import { Database, GraduationCap, Wifi } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { StudentSwitcher } from "./StudentSwitcher";
import { USE_MOCKS } from "@/api/env";
import { RouteSkeleton } from "@/components/common/States";
import { useMe } from "@/api/session";
import { useBatches } from "@/api/queries";
import type { Batch } from "@/api/types";
import { pageEnter, transition } from "@/lib/motion";
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
  // The explanation layer: how a diagnosis is made, and why to trust it. In
  // the main navigation rather than a footer, because in a pitch they are the
  // pages a director is shown second, right after the console.
  { to: "/how-it-works", label: "How it works", active: (p) => p.startsWith("/how-it-works") },
  { to: "/trust", label: "Data & trust", active: (p) => p.startsWith("/trust") },
];

/**
 * The masthead names the institute the signed-in account actually belongs to.
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

      <header className="sticky top-0 z-30 border-b border-border/80 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-4 px-4 sm:px-6">
          <Link
            to="/"
            className="flex min-w-0 items-center gap-3 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <BrandMark />
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold tracking-tight">
                {institute?.name ?? "Student AI"}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {/* On a phone the bar has no room for the demo chip beside the
                    switcher, so the label takes this line instead. */}
                {USE_MOCKS ? (
                  <span className="inline-flex items-center gap-1 font-medium text-foreground sm:hidden">
                    <Database aria-hidden className="size-3 text-brand-ink" />
                    Demo dataset
                  </span>
                ) : null}
                <span className={USE_MOCKS ? "hidden sm:inline" : undefined}>
                  {institute
                    ? [institute.city, intake].filter(Boolean).join(" · ")
                    : "No institute on this account"}
                </span>
              </div>
            </div>
          </Link>

          <nav aria-label="Primary" className="ml-6 hidden items-center gap-1 xl:flex">
            <NavItems group="desktop" pathname={location.pathname} />
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <FixtureBadge />
            <StudentSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Below `xl` four inline links, the fixture badge and the student
          switcher do not fit one bar — at tablet width the masthead pushed
          the page sideways. Below `md` the nav used to simply vanish, so on a
          phone nothing but the console was reachable. A scrolling row under
          the masthead fixes both, without a menu to open first. */}
      <nav
        aria-label="Primary"
        className="sticky top-16 z-20 border-b border-border/80 bg-background/80 backdrop-blur-xl xl:hidden"
      >
        <div className="mx-auto flex max-w-[1440px] gap-1 overflow-x-auto px-4 py-1.5 sm:px-6">
          <NavItems group="compact" pathname={location.pathname} />
        </div>
      </nav>

      <main id="main" tabIndex={-1} className="mx-auto max-w-[1440px] px-4 pb-20 outline-none sm:px-6">
        {/* Keyed on the path, so each new page enters once. Same path with a
            new query string (a filter) keeps the page and its state. */}
        <motion.div key={location.pathname} {...pageEnter}>
          {/* Inside the keyed wrapper, so a screen whose chunk is still on its
              way shows the skeleton in its place and the shell never blanks. */}
          <Suspense fallback={<RouteSkeleton />}>
            <Outlet />
          </Suspense>
        </motion.div>
      </main>
    </div>
  );
}

/**
 * The tabs. The active pill is one shared element that slides to whichever
 * tab is current, so a route change reads as moving along the bar. Each of
 * the two navs (desktop, compact) has its own group, or the pill would try to
 * fly between a visible bar and a hidden one.
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
              "relative isolate shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? "text-brand-ink"
                : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
            )}
          >
            {active ? (
              <motion.span
                layoutId="active-tab"
                transition={transition.layout}
                aria-hidden
                className="absolute inset-0 -z-10 rounded-lg bg-brand-soft ring-1 ring-brand-line/50 ring-inset"
              />
            ) : null}
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

/** The product mark: the brand fill with a soft top light, so it reads as an object. */
function BrandMark() {
  return (
    <span
      aria-hidden
      className="relative flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-brand text-brand-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.28),inset_0_-1px_0_oklch(0_0_0/0.12),0_1px_2px_oklch(0.25_0.04_230/0.25)]"
    >
      <span className="absolute inset-0 rounded-[10px] bg-linear-to-b from-white/18 to-transparent" />
      <GraduationCap className="relative size-[18px]" strokeWidth={2.1} />
    </span>
  );
}

/**
 * Which world the console is in, said out loud.
 *
 * On fixtures it says so, because a demo that quietly implies live data is the
 * fastest way to lose a room when someone asks a question the fixtures cannot
 * answer. But the badge used to say "Demo dataset · 14 of 312 students seeded"
 * *unconditionally* — including against a live Django server serving 46 real
 * students, where it is simply false, and false in the one direction that
 * makes a real answer look staged.
 */
function FixtureBadge() {
  if (!USE_MOCKS) {
    return (
      <span
        className="hidden items-center gap-2 rounded-full bg-card px-3 py-1 text-xs text-muted-foreground shadow-card ring-1 ring-border lg:inline-flex"
        title="Figures come from the live API, except those tagged “Import records” on Data & trust."
      >
        <Wifi aria-hidden className="size-3.5 text-brand-ink" />
        <span className="font-medium text-foreground">Live API</span>
      </span>
    );
  }

  const title =
    "Served by Mock Service Worker from schema-derived fixtures. 14 of the institute's 312 students are seeded.";
  return (
    <>
      <span
        className="hidden items-center gap-2 rounded-full bg-card px-3 py-1 text-xs text-muted-foreground shadow-card ring-1 ring-border lg:inline-flex"
        title={title}
      >
        <Database aria-hidden className="size-3.5 text-brand-ink" />
        <span>
          <span className="font-medium text-foreground">Demo dataset</span> · 14 of 312
          students seeded
        </span>
      </span>
      {/* Below `lg` the full badge does not fit the bar, and it used to simply
          vanish — so on a phone or a narrow window nothing said the figures
          were a demo. The label shrinks; it never disappears. Below `sm` it
          moves under the institute name (see the masthead). */}
      <span
        className="hidden shrink-0 items-center gap-1.5 rounded-full bg-card px-2 py-0.5 text-[11px] font-medium text-foreground shadow-card ring-1 ring-border sm:inline-flex lg:hidden"
        title={title}
      >
        <Database aria-hidden className="size-3 text-brand-ink" />
        Demo
      </span>
    </>
  );
}
