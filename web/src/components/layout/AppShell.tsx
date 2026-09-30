import { NavLink, Outlet } from "react-router-dom";
import { Database, GraduationCap, Wifi } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { StudentSwitcher } from "./StudentSwitcher";
import { USE_MOCKS } from "@/api/env";
import { useMe } from "@/api/session";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Director console", end: true },
  { to: "/students/1", label: "Student 360", end: false },
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

  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-popover focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-md bg-foreground text-background">
              <GraduationCap aria-hidden className="size-4" />
            </span>
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight">
                {institute?.name ?? "Aarambh Classes"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {institute?.city ?? "Kota"} · JEE 2027 &amp; 2028
              </div>
            </div>
          </div>

          <nav aria-label="Primary" className="ml-4 hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <FixtureBadge />
            <StudentSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-[1440px] px-4 pb-16 sm:px-6">
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
 * makes a real answer look staged.
 */
function FixtureBadge() {
  if (!USE_MOCKS) {
    return (
      <span
        className="hidden items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground lg:inline-flex"
        title="Every figure on screen came from the API, including the diagnosis."
      >
        <Wifi aria-hidden className="size-3" />
        Live API
      </span>
    );
  }

  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground lg:inline-flex"
      title="Served by Mock Service Worker from schema-derived fixtures. 14 of the institute's 312 students are seeded."
    >
      <Database aria-hidden className="size-3" />
      Demo dataset · 14 of 312 students seeded
    </span>
  );
}
