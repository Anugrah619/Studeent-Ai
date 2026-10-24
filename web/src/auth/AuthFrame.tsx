import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand/Wordmark";

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
        <Wordmark className="mb-9" />
        {children}
      </div>
    </main>
  );
}
