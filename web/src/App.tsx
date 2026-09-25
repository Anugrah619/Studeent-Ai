import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ApiError } from "@/api/client";
import { AuthProvider } from "@/auth/AuthProvider";
import { RequireAuth } from "@/auth/RequireAuth";
import { AppShell } from "@/components/layout/AppShell";
import { DirectorConsole } from "@/routes/DirectorConsole";
import { Student360 } from "@/routes/Student360";
import { MockIntelligence } from "@/routes/MockIntelligence";
import { NotFound } from "@/routes/NotFound";
import { ThemeProvider } from "@/theme/theme-provider";

const queryClient = new QueryClient({
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
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </RequireAuth>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
