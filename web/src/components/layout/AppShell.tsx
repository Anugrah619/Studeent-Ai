import { NavLink, Outlet } from "react-router-dom";
import { Database, Wifi } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { StudentSwitcher } from "./StudentSwitcher";
import { BrandMark } from "@/components/brand/BrandMark";
import { USE_MOCKS } from "@/api/env";
import { useMe } from "@/api/session";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Director console", end: true },
  { to: "/students/1", label: "Student 360", end: false },
  // The explanation layer: how a diagnosis is made, and why to trust it. In
  // the main navigation rather than a footer, because in a pitch they are the
  // pages a director is shown second, right after the console.
  { to: "/how-it-works", label: "How it works", end: false },
  { to: "/trust", label: "Data & trust", end: false },
];

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    "inline-flex shrink-0 items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium whitespace-nowrap transition-colors",
    isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
  );
}

/**
 * The page you are on is the filled bubble — the option that was picked — and
 * the others wait as empty space where a bubble would be, so the row never
 * shifts as you move. Colour and the bubble say it together; neither is the
 * only cue.
 */
function NavItem({ item }: { item: (typeof NAV)[number] }) {
  return (
    <NavLink to={item.to} end={item.end} className={navClass}>
      {({ isActive }) => (
        <>
          <span
            aria-hidden
            className={cn(
              "size-2 rounded-full transition-colors",
              isActive ? "bg-foreground" : "bg-transparent",
            )}
          />
          {item.label}
        </>
      )}
    </NavLink>
  );
}

/**
 * The masthead is the institute's letterhead: the name of the institute the
 * signed-in account actually belongs to, in the serif a printed result sheet
 * would use, with the product and the place beneath it.
 *
 * It used to be hardcoded, because there was no endpoint to ask. `/api/me/` is
 * in the contract now and carries `institute`, so the console stops asserting
 * "Aarambh Classes" at whoever is logged in and reads it instead — with the
 * static pair as the pre-login placeholder, not as the answer. (The exam it
 * used to name beside the city was hardcoded too, and would have been wrong the
 * day a NEET batch appeared; the shell no longer claims one.)
 */
export function AppShell() {
  const me = useMe();
  const institute = me.data?.institute;

  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-popover focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1360px] items-center gap-5 px-5 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark className="text-foreground" />
            <div className="min-w-0 leading-tight">
              <div className="truncate font-serif text-lg font-semibold tracking-tight">
                {institute?.name ?? "Aarambh Classes"}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Student AI</span>
                <span aria-hidden className="h-3 w-px bg-border" />
                <span>{institute?.city ?? "Kota"}</span>
              </div>
            </div>
          </div>

          <nav aria-label="Primary" className="ml-4 hidden items-center gap-1 xl:flex">
            {NAV.map((item) => (
              <NavItem key={item.to} item={item} />
            ))}
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

      {/* Below `xl` four inline links, the fixture badge and the student
          switcher do not fit one bar — at tablet width the masthead pushed the
          page sideways. Below `md` the nav used to simply vanish, so on a phone
          nothing but the console was reachable. A scrolling row under the
          masthead fixes both, without a menu to open first. */}
      <nav
        aria-label="Primary"
        className="sticky top-16 z-20 border-b border-border bg-background/90 backdrop-blur xl:hidden"
      >
        <div className="mx-auto flex max-w-[1360px] gap-1 overflow-x-auto px-5 py-1.5 sm:px-8">
          {NAV.map((item) => (
            <NavItem key={item.to} item={item} />
          ))}
        </div>
      </nav>

      <main id="main" className="mx-auto max-w-[1360px] px-5 pb-24 sm:px-8">
        <Outlet />
      </main>
    </div>
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
 * makes a real answer look staged. The detail lives in the tooltip now; the
 * badge itself is two words, so it fits the bar at every width it is shown.
 */
function FixtureBadge() {
  if (!USE_MOCKS) {
    return (
      <span
        className="hidden items-center gap-1.5 rounded-sm border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground lg:inline-flex"
        title="Every figure on screen came from the API, including the diagnosis."
      >
        <Wifi aria-hidden className="size-3.5" />
        Live API
      </span>
    );
  }

  return (
    <span
      className="hidden items-center gap-1.5 rounded-sm border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground lg:inline-flex"
      title="Served by Mock Service Worker from schema-derived fixtures. 14 of the institute's 312 students are seeded."
    >
      <Database aria-hidden className="size-3.5" />
      Demo data
    </span>
  );
}
