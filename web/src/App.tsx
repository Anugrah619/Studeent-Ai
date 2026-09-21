import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
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
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
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
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
