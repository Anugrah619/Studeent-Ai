import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import type { Onboarding as OnboardingData } from "@/api/types";
import {
  detailOf,
  fieldErrors,
  statusOf,
  useMyOnboarding,
  useMyProfile,
  useSaveOnboarding,
} from "@/api/student";
import { useAuth } from "@/auth/AuthProvider";
import { Wordmark } from "@/components/brand/Wordmark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { daysFromToday, fullDate, minutesSpoken, minutesText } from "../lib";
import { FieldMessages, FormNotice, Pending, ScreenHeader, Sheet, Trouble } from "../ui";

/** `engine_serializers.MIN_DAILY_MINUTES` / `MAX_DAILY_MINUTES`. */
export const MIN_MINUTES = 45;
export const MAX_MINUTES = 720;
const PRESETS = [60, 120, 180, 240, 300, 360];

/**
 * Onboarding: what the institute decided, and the two things that are the
 * student's to say — how long they can study a day, and the rank they are
 * aiming for.
 *
 * Shown on its own, before anything else, the first time (`needs_onboarding`),
 * because the plan is sized to the answer; and reachable afterwards from the
 * initials in the top bar, where it doubles as the student's profile and the
 * place to sign out.
 */
export function Onboarding({ firstRun = false }: { firstRun?: boolean }) {
  const onboarding = useMyOnboarding();

  const body = onboarding.isPending ? (
    <div role="status" aria-label="Loading your details" className="space-y-3">
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  ) : onboarding.error ? (
    <Trouble error={onboarding.error} what="your details" onRetry={() => void onboarding.refetch()} />
  ) : (
    <OnboardingForm data={onboarding.data} firstRun={firstRun} />
  );

  if (firstRun) {
    return (
      <main className="min-h-dvh bg-background px-4 py-8 sm:py-12">
        <div className="mx-auto w-full max-w-lg">
          <Wordmark tagline="Your preparation" className="mb-6" />
          <ScreenHeader title="Let's fit your plan to your day.">
            Two questions, and your daily plan is ready. You can change both later.
          </ScreenHeader>
          {body}
        </div>
      </main>
    );
  }

  return (
    <>
      <ScreenHeader kicker="You" title="Your study time and target." />
      <ProfileCard />
      <div className="mt-6">{body}</div>
      <SignOut />
    </>
  );
}

function OnboardingForm({ data, firstRun }: { data: OnboardingData; firstRun: boolean }) {
  const navigate = useNavigate();
  const save = useSaveOnboarding();
  const [minutes, setMinutes] = useState<string>(
    data.daily_minutes ? String(data.daily_minutes) : "180",
  );
  const [rank, setRank] = useState<string>(data.target_rank ? String(data.target_rank) : "");
  const [saved, setSaved] = useState(false);

  useEffect(() => setSaved(false), [minutes, rank]);

  const value = Number(minutes);
  const minutesValid =
    minutes.trim() !== "" && Number.isInteger(value) && value >= MIN_MINUTES && value <= MAX_MINUTES;
  const rankValue = rank.trim() === "" ? null : Number(rank);
  const rankValid = rankValue === null || (Number.isInteger(rankValue) && rankValue >= 1);
  const errors = fieldErrors(save.error);
  const status = statusOf(save.error);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!minutesValid || !rankValid || save.isPending) return;
    try {
      await save.mutateAsync({ daily_minutes: value, target_rank: rankValue });
      if (firstRun) navigate("/", { replace: true });
      else setSaved(true);
    } catch {
      // Shown from `save.error` below.
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <Facts data={data} />

      <Sheet className="px-4 py-5 sm:px-5">
        <fieldset>
          <legend className="text-base font-semibold text-foreground">
            How many minutes a day can you study?
          </legend>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Outside class, on a usual day. Your daily plan is sized to this, so it fits the day
            you really have.
          </p>

          <p className="mt-4 text-3xl font-semibold tracking-tight" aria-hidden>
            {minutesValid ? minutesText(value) : "—"}
            <span className="ml-2 text-base font-normal text-muted-foreground">a day</span>
          </p>

          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Common choices">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={value === preset}
                onClick={() => setMinutes(String(preset))}
                className={cn(
                  "h-9 rounded-md border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  value === preset
                    ? "border-brand bg-brand-soft text-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {minutesText(preset)}
              </button>
            ))}
          </div>

          <label htmlFor="daily-minutes-slider" className="sr-only">
            Minutes a day
          </label>
          <input
            id="daily-minutes-slider"
            type="range"
            min={MIN_MINUTES}
            max={MAX_MINUTES}
            step={15}
            value={minutesValid ? value : 180}
            aria-valuetext={minutesValid ? minutesSpoken(value) : undefined}
            onChange={(e) => setMinutes(e.target.value)}
            className="mt-5 w-full accent-[var(--brand)]"
          />
          <div className="tnum flex justify-between text-xs text-muted-foreground" aria-hidden>
            <span>45 min</span>
            <span>12 h</span>
          </div>

          <div className="mt-4 max-w-48 space-y-1.5">
            <Label htmlFor="daily-minutes">Exact minutes</Label>
            <Input
              id="daily-minutes"
              type="number"
              inputMode="numeric"
              min={MIN_MINUTES}
              max={MAX_MINUTES}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              aria-invalid={errors.daily_minutes || (minutes !== "" && !minutesValid) ? true : undefined}
              aria-describedby="daily-minutes-help daily-minutes-errors"
            />
          </div>
          <p id="daily-minutes-help" className="mt-1.5 text-sm text-muted-foreground">
            {minutes !== "" && !minutesValid
              ? "Choose between 45 minutes and 12 hours (720 minutes)."
              : "Anything from 45 minutes to 12 hours."}
          </p>
          <FieldMessages id="daily-minutes-errors" messages={errors.daily_minutes} />
        </fieldset>
      </Sheet>

      <Sheet className="px-4 py-5 sm:px-5">
        <Label htmlFor="target-rank" className="text-base font-semibold">
          The rank you&rsquo;re aiming for <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Leave it empty if you&rsquo;d rather not say. Only you and your mentor see it.
        </p>
        <Input
          id="target-rank"
          type="number"
          inputMode="numeric"
          min={1}
          placeholder="For example 5000"
          value={rank}
          onChange={(e) => setRank(e.target.value)}
          className="mt-3 max-w-48"
          aria-invalid={errors.target_rank || !rankValid ? true : undefined}
          aria-describedby="target-rank-errors"
        />
        {!rankValid ? (
          <p className="mt-1.5 text-sm text-muted-foreground">A rank is a whole number, 1 or more.</p>
        ) : null}
        <FieldMessages id="target-rank-errors" messages={errors.target_rank} />
      </Sheet>

      <div aria-live="polite" className="space-y-2 empty:hidden">
        {save.error && status !== 400 ? (
          <FormNotice tone="problem">
            {status === 429
              ? "You've changed these a few times in a short while. Try again in a little while; your plan keeps working meanwhile."
              : (detailOf(save.error) ?? "Your answers didn't save. Check your connection, then try again.")}
          </FormNotice>
        ) : null}
        {save.error && status === 400 && errors.detail ? (
          <FormNotice tone="problem">{errors.detail.join(" ")}</FormNotice>
        ) : null}
        {saved ? <FormNotice tone="done">Saved. Your next plan is sized to this.</FormNotice> : null}
      </div>

      <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={!minutesValid || !rankValid || save.isPending}>
        {save.isPending ? <Pending>Saving…</Pending> : firstRun ? "Save and see today" : "Save changes"}
      </Button>
    </form>
  );
}

/** What the institute decided, shown so the student can check it — not change it. */
function Facts({ data }: { data: OnboardingData }) {
  const daysLeft = data.exam_date ? daysFromToday(data.exam_date) : null;
  return (
    <section aria-labelledby="facts-heading" className="rounded-xl bg-muted/50 px-4 py-4 sm:px-5">
      <h2 id="facts-heading" className="text-sm font-semibold text-foreground">
        Your institute set these
      </h2>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Exam</dt>
          <dd className="mt-0.5 font-medium text-foreground">{data.exam_name || data.exam_code}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Batch</dt>
          <dd className="mt-0.5 font-medium text-foreground">{data.batch_name}</dd>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <dt className="text-muted-foreground">Exam date</dt>
          <dd className="mt-0.5 font-medium text-foreground">
            {data.exam_date ? (
              <>
                {fullDate(data.exam_date)}
                {daysLeft !== null && daysLeft > 0 ? (
                  <span className="font-normal text-muted-foreground">, {daysLeft} days to go</span>
                ) : null}
              </>
            ) : (
              <span className="font-normal text-muted-foreground">Not set yet</span>
            )}
          </dd>
        </div>
        {data.target ? (
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-muted-foreground">Target on record</dt>
            <dd className="mt-0.5 font-medium text-foreground">{data.target}</dd>
          </div>
        ) : null}
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        If any of these look wrong, tell your mentor; they&rsquo;re your institute&rsquo;s to change.
      </p>
    </section>
  );
}

function ProfileCard() {
  const profile = useMyProfile();
  if (!profile.data) return null;
  const p = profile.data;
  return (
    <Sheet className="px-4 py-4 sm:px-5">
      <p className="text-base font-semibold text-foreground">{p.name}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Roll number</dt>
          <dd className="tnum font-medium">{p.roll_no}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Mentor</dt>
          <dd className="font-medium">{p.mentor_name}</dd>
        </div>
      </dl>
    </Sheet>
  );
}

function SignOut() {
  const { logout, logoutPending } = useAuth();
  return (
    <div className="mt-10 border-t border-border pt-6">
      <Button variant="outline" onClick={() => void logout()} disabled={logoutPending}>
        <LogOut aria-hidden />
        Sign out
      </Button>
    </div>
  );
}
