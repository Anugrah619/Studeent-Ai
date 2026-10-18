import type { ReactNode } from "react";
import { GraduationCap } from "lucide-react";

/**
 * The plain centred page the post-sign-in holding screens share: the first
 * time a student signs in and has to choose a password, and the page a student
 * lands on while there is no student app. Neither has data to show, so neither
 * borrows the sign-in screen's brand panel.
 */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10 sm:px-8">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-10 items-center justify-center rounded-[11px] bg-brand text-brand-foreground"
          >
            <GraduationCap className="size-5" strokeWidth={2.1} />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-foreground">
            Student AI
          </span>
        </div>
        {children}
      </div>
    </main>
  );
}
