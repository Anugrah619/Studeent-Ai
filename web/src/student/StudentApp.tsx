import { lazy } from "react";
import { Route, Routes } from "react-router-dom";
import { useMyProfile } from "@/api/student";
import { useAuth } from "@/auth/AuthProvider";
import { Bubble } from "@/components/brand/Bubble";
import { Wordmark } from "@/components/brand/Wordmark";
import { Button } from "@/components/ui/button";
import { StudentShell } from "./StudentShell";
import { Onboarding } from "./screens/Onboarding";
import { Today } from "./screens/Today";
import { Trouble } from "./ui";

/**
 * One chunk per screen, as in the console. Today is the screen almost every
 * visit opens on, so it comes with the app; KaTeX (the question view) and the
 * charts arrive only when their screen is opened.
 */
const Revisions = lazy(() => import("./screens/Revisions").then((m) => ({ default: m.Revisions })));
const LogStudy = lazy(() => import("./screens/LogStudy").then((m) => ({ default: m.LogStudy })));
const Confidence = lazy(() => import("./screens/Confidence").then((m) => ({ default: m.Confidence })));
const Progress = lazy(() => import("./screens/Progress").then((m) => ({ default: m.Progress })));
const Mistakes = lazy(() => import("./screens/Mistakes").then((m) => ({ default: m.Mistakes })));
const MistakeDetail = lazy(() =>
  import("./screens/MistakeDetail").then((m) => ({ default: m.MistakeDetail })),
);
const Guide = lazy(() => import("./screens/Guide").then((m) => ({ default: m.Guide })));
const StudentNotFound = lazy(() =>
  import("./screens/NotFound").then((m) => ({ default: m.StudentNotFound })),
);

/**
 * The student's own app, mounted by `RequireAuth` for a student account in
 * place of the console. It owns its routes; no console route is declared
 * here, so a console address (`/students/1`) is simply a page this app does
 * not have.
 *
 * The first thing it asks is the profile, because `needs_onboarding` decides
 * what comes first: until the two onboarding questions are answered there is
 * nothing to plan around, so onboarding is the whole screen. Afterwards it is
 * one of the app's pages, at `/onboarding`.
 */
export function StudentApp() {
  const profile = useMyProfile();

  if (profile.isPending) return <StudentBoot />;
  if (profile.error) return <ProfileTrouble error={profile.error} onRetry={() => void profile.refetch()} />;
  if (profile.data.needs_onboarding) return <Onboarding firstRun />;

  return (
    <Routes>
      <Route element={<StudentShell profile={profile.data} />}>
        <Route index element={<Today />} />
        <Route path="revisions" element={<Revisions />} />
        <Route path="log" element={<LogStudy />} />
        <Route path="confidence" element={<Confidence />} />
        <Route path="progress" element={<Progress />} />
        <Route path="mistakes" element={<Mistakes />} />
        <Route path="mistakes/:questionPk" element={<MistakeDetail />} />
        <Route path="guide" element={<Guide />} />
        <Route path="onboarding" element={<Onboarding />} />
        <Route path="*" element={<StudentNotFound />} />
      </Route>
    </Routes>
  );
}

/** The same marking-in-progress the sign-in boot shows, for one more round trip. */
export function StudentBoot() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <div role="status" aria-label="Loading your app" className="flex gap-2.5">
        {["A", "B", "C", "D"].map((letter, i) => (
          <Bubble
            key={letter}
            letter={letter}
            size="md"
            className="animate-bubble-read"
            style={{ animationDelay: `${i * 300}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function ProfileTrouble({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { logout, logoutPending } = useAuth();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <Wordmark className="mb-8" />
        <Trouble error={error} what="your account" onRetry={onRetry} />
        <Button variant="ghost" size="sm" className="mt-4" onClick={() => void logout()} disabled={logoutPending}>
          Sign out
        </Button>
      </div>
    </main>
  );
}
