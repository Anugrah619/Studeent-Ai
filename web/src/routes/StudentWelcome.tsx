import { AuthFrame } from "@/auth/AuthFrame";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/components/ui/button";

/**
 * Where a student lands for now.
 *
 * Their account works — they signed in with a roll number, chose their own
 * password, and the student API (`/api/my/…`) answers for them — but there is
 * no student app to show it in yet. The console is not the fallback: every
 * console route is closed to student accounts, so mounting it would be a
 * screen of "forbidden". Saying so plainly is kinder, and it does not pretend
 * a plan or a progress page exists that does not.
 */
export function StudentWelcome() {
  const { me, logout, logoutPending } = useAuth();
  return (
    <AuthFrame>
      <h1 className="font-heading text-2xl font-semibold tracking-tight">
        You&rsquo;re all set{me?.name ? `, ${me.name.split(" ")[0]}` : ""}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Your account{me?.institute ? ` at ${me.institute.name}` : ""} is ready and the
        password is yours. The student app is not available yet — your mentor can
        already see your results and your plan, and will go through them with you.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-6"
        onClick={() => void logout()}
        disabled={logoutPending}
      >
        Sign out
      </Button>
    </AuthFrame>
  );
}
