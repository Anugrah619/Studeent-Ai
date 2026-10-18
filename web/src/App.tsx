import { lazy } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ApiError } from "@/api/client";
import { AuthProvider } from "@/auth/AuthProvider";
import { RequireAuth } from "@/auth/RequireAuth";
import { AppShell } from "@/components/layout/AppShell";
import { NotFound } from "@/routes/NotFound";
import { ThemeProvider } from "@/theme/theme-provider";
import { transition } from "@/lib/motion";

/**
 * One chunk per screen. Recharts, KaTeX and React Flow are each needed by only
 * some of them, and the console — the first screen a director sees — needs
 * none of the three; bundled together they made the console download all of
 * it before it could draw a number. The `Suspense` boundary is in AppShell,
 * around the outlet, so the masthead and nav stay put while a screen arrives.
 * NotFound stays in the main chunk: it is a few lines, and a mistyped URL
 * should not wait on a request.
 */
const DirectorConsole = lazy(() =>
  import("@/routes/DirectorConsole").then((m) => ({ default: m.DirectorConsole })),
);
const Student360 = lazy(() =>
  import("@/routes/Student360").then((m) => ({ default: m.Student360 })),
);
const MockIntelligence = lazy(() =>
  import("@/routes/MockIntelligence").then((m) => ({ default: m.MockIntelligence })),
);
const HowItWorks = lazy(() =>
  import("@/routes/HowItWorks").then((m) => ({ default: m.HowItWorks })),
);
const DataTrust = lazy(() =>
  import("@/routes/DataTrust").then((m) => ({ default: m.DataTrust })),
);

/**
 * Exported for tests only. It is created once per module, so a suite that
 * renders `<App />` more than once shares it — and `me` is cached for good, so
 * a test that signs in as someone else would hand its identity to the next.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      /**
       * Retry once, but never on an auth failure. Retrying a 401 costs a
       * second round trip to learn what the first one already said, and
       * delays the login screen by exactly that long.
       */
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.isAuthFailure) return false;
        return failureCount < 1;
      },
    },
  },
});

export default function App() {
  return (
    // `reducedMotion="user"` is the whole reduced-motion policy: with the OS
    // setting on, every transform and layout animation below becomes an
    // instant change and only opacity still fades. The default transition is
    // the house one, so a bare `animate` prop moves like everything else.
    <MotionConfig reducedMotion="user" transition={transition.base}>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthProvider>
              <RequireAuth>
                <Routes>
                  <Route element={<AppShell />}>
                    <Route index element={<DirectorConsole />} />
                    <Route path="students/:id" element={<Student360 />} />
                    <Route
                      path="students/:id/mock/:paperId"
                      element={<MockIntelligence />}
                    />
                    <Route path="how-it-works" element={<HowItWorks />} />
                    <Route path="trust" element={<DataTrust />} />
                    <Route path="*" element={<NotFound />} />
                  </Route>
                </Routes>
              </RequireAuth>
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </ThemeProvider>
    </MotionConfig>
  );
}
