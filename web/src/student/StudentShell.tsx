import { Suspense, useLayoutEffect, useRef } from "react";
import { Link, Outlet, useLocation, useNavigationType } from "react-router-dom";
import { LayoutGroup, motion } from "motion/react";
import {
  CalendarCheck,
  ChartNoAxesColumn,
  Compass,
  Database,
  PencilLine,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import type { MyProfile } from "@/api/types";
import { USE_MOCKS } from "@/api/env";
import { useAuth } from "@/auth/AuthProvider";
import { BrandMark } from "@/components/brand/BrandMark";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Skeleton } from "@/components/ui/skeleton";
import { transition } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { initialsOf } from "./lib";

interface Tab {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Whether this tab is the current section, given the path. */
  active: (pathname: string) => boolean;
}

/**
 * Five places, because a phone's tab bar holds five. Confidence sits under
 * Log (both are the student telling the planner something) and Mistakes under
 * Progress (both are reading results), so every screen lights a tab.
 */
export const TABS: Tab[] = [
  { to: "/", label: "Today", icon: CalendarCheck, active: (p) => p === "/" },
  { to: "/revisions", label: "Revisions", icon: RotateCcw, active: (p) => p.startsWith("/revisions") },
  {
    to: "/log",
    label: "Log",
    icon: PencilLine,
    active: (p) => p.startsWith("/log") || p.startsWith("/confidence"),
  },
  {
    to: "/progress",
    label: "Progress",
    icon: ChartNoAxesColumn,
    active: (p) => p.startsWith("/progress") || p.startsWith("/mistakes"),
  },
  { to: "/guide", label: "Guide", icon: Compass, active: (p) => p.startsWith("/guide") },
];

/**
 * The student's own app around every screen.
 *
 * The masthead is the console's — the institute's name in the serif, the
 * four-bubble mark — so it is plainly the same product. Everything else is
 * quieter: one column at reading width, no badge strip, no switcher. On a
 * phone the five places sit at the bottom, under the thumb; from tablet width
 * up they move into the top bar and the bottom bar goes away.
 */
export function StudentShell({ profile }: { profile: MyProfile }) {
  const { me } = useAuth();
  const location = useLocation();
  const navigationType = useNavigationType();
  const lastPath = useRef(location.pathname);

  // A new screen starts at its top — except on Back/Forward, where the
  // browser restores the reader's place.
  useLayoutEffect(() => {
    if (lastPath.current === location.pathname) return;
    lastPath.current = location.pathname;
    if (navigationType !== "POP") window.scrollTo({ top: 0 });
  }, [location.pathname, navigationType]);

  // An in-page link (`/progress#chapters`) lands on its section once the
  // screen has drawn it.
  useLayoutEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    const timer = window.setTimeout(() => document.getElementById(id)?.scrollIntoView(), 350);
    return () => window.clearTimeout(timer);
  }, [location.hash, location.pathname]);

  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-popover focus:px-3 focus:py-2 focus:text-sm focus:shadow-raised focus:ring-3 focus:ring-ring/50"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <Link
            to="/"
            className="flex min-w-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <BrandMark className="size-6 text-brand-ink" />
            <span className="truncate font-serif text-base font-semibold tracking-tight">
              {me?.institute?.name ?? "Student AI"}
            </span>
          </Link>

          <nav aria-label="Primary" className="ml-4 hidden items-center gap-0.5 md:flex">
            <LayoutGroup id="student-top">
              {TABS.map((tab) => (
                <TopTab key={tab.to} tab={tab} active={tab.active(location.pathname)} />
              ))}
            </LayoutGroup>
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1">
            {USE_MOCKS ? (
              <span
                className="mr-1 inline-flex items-center gap-1 rounded-sm border border-border bg-card px-2 py-1 text-xs font-medium text-foreground"
                title="Served by the mock server from fixtures — nothing here is a real student's."
              >
                <Database aria-hidden className="size-3.5 text-brand-ink" />
                Demo data
              </span>
            ) : null}
            <ThemeToggle />
            <Link
              to="/onboarding"
              aria-label="Your study time and profile"
              title="Your study time and profile"
              className={cn(
                "flex size-9 items-center justify-center rounded-md border border-border bg-card text-xs font-semibold text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                location.pathname.startsWith("/onboarding") && "border-brand-line bg-brand-soft",
              )}
            >
              {initialsOf(profile.name) || "Me"}
            </Link>
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto max-w-3xl px-4 pb-32 outline-none md:pb-16">
        <div key={location.pathname}>
          <Suspense fallback={<ScreenLoading />}>
            <Outlet />
          </Suspense>
        </div>
      </main>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      >
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {TABS.map((tab) => {
            const active = tab.active(location.pathname);
            const Icon = tab.icon;
            return (
              <li key={tab.to}>
                <Link
                  to={tab.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex min-h-14 flex-col items-center justify-center gap-1 px-1 pt-1.5 pb-1 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
                    active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {active ? (
                    <span aria-hidden className="absolute inset-x-5 top-0 h-0.5 rounded-b-sm bg-brand" />
                  ) : null}
                  <Icon aria-hidden className={cn("size-5", active && "text-brand-ink")} />
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

/** A tab in the top bar. The current one carries the filled bubble, as in the console. */
function TopTab({ tab, active }: { tab: Tab; active: boolean }) {
  return (
    <Link
      to={tab.to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {active ? (
        <motion.span
          layoutId="student-active-bubble"
          transition={transition.layout}
          aria-hidden
          className="size-2 rounded-full bg-brand"
        />
      ) : (
        <span aria-hidden className="size-2" />
      )}
      {tab.label}
    </Link>
  );
}

function ScreenLoading() {
  return (
    <div role="status" aria-label="Loading this screen" className="pt-8">
      <div aria-hidden className="animate-in fill-mode-both delay-150 duration-200 fade-in-0">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="mt-3 h-8 w-3/4" />
        <Skeleton className="mt-8 h-40 w-full rounded-xl" />
      </div>
    </div>
  );
}
