import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { StudyMode } from "@/api/types";
import {
  detailOf,
  fieldErrors,
  statusOf,
  useLogStudy,
  useMyStudyLogs,
  useMyTopics,
} from "@/api/student";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ChapterPicker } from "../ChapterPicker";
import { minutesText, modeLabel, toLocalInput, whenText } from "../lib";
import {
  Block,
  FieldMessages,
  FormNotice,
  LoadingRows,
  Pending,
  Quiet,
  ScreenHeader,
  Sheet,
  Trouble,
} from "../ui";

const MODES: { value: StudyMode; hint: string }[] = [
  { value: "learn", hint: "Something new" },
  { value: "practice", hint: "Questions" },
  { value: "revise", hint: "Going back over" },
];
const MINUTE_PRESETS = [15, 30, 45, 60, 90, 120];

/** A phone that is a minute fast may still log "just now", as on the server. */
const FUTURE_SKEW_MS = 5 * 60_000;

/**
 * Log a study session. Four answers — which chapter, how long, what kind of
 * work, and when — and the plan learns how much time the student really has.
 *
 * The server is the one judge of what it accepts. Anything it refuses comes
 * back as field errors, which are shown under their own field, in its words.
 * The one rule checked here as well is "not in the future", because the time
 * picker should not offer a moment that has not happened.
 */
export function LogStudy() {
  const [params] = useSearchParams();
  const topics = useMyTopics();
  const log = useLogStudy();

  const preset = Number(params.get("topic"));
  const presetMode = params.get("mode");
  const [topic, setTopic] = useState<number | null>(Number.isInteger(preset) && preset > 0 ? preset : null);
  const [minutes, setMinutes] = useState("");
  const [mode, setMode] = useState<StudyMode>(
    presetMode === "learn" || presetMode === "practice" || presetMode === "revise" ? presetMode : "practice",
  );
  const [when, setWhen] = useState(() => toLocalInput(new Date()));
  const [logged, setLogged] = useState<string | null>(null);

  const errors = fieldErrors(log.error);
  const status = statusOf(log.error);
  const whenDate = new Date(when);
  const whenValid = when !== "" && !Number.isNaN(whenDate.getTime());
  const inFuture = whenValid && whenDate.getTime() > Date.now() + FUTURE_SKEW_MS;
  const minutesValue = Number(minutes);
  const canSubmit = topic !== null && minutes.trim() !== "" && whenValid && !inFuture && !log.isPending;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || topic === null) return;
    setLogged(null);
    try {
      const saved = await log.mutateAsync({
        topic,
        minutes: minutesValue,
        mode,
        ts: whenDate.toISOString(),
      });
      setLogged(`Logged ${minutesText(saved.minutes)} of ${saved.topic_name}.`);
      setMinutes("");
      setWhen(toLocalInput(new Date()));
    } catch {
      // Rendered from `log.error`.
    }
  }

  const otherProblems = [...(errors.non_field_errors ?? []), ...(errors.detail ?? [])];

  return (
    <>
      <ScreenHeader kicker="Log" title="What did you study?">
        A quick note after each session lets your plan fit the time you really have.
      </ScreenHeader>

      {topics.isPending ? (
        <LoadingRows rows={2} label="Loading your chapters" />
      ) : topics.error ? (
        <Trouble error={topics.error} what="your chapters" onRetry={() => void topics.refetch()} />
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-6">
          <Sheet className="px-4 py-5 sm:px-5">
            <fieldset>
              <legend className="text-base font-semibold text-foreground">Chapter</legend>
              <div className="mt-2">
                <ChapterPicker
                  topics={topics.data}
                  value={topic}
                  onChange={setTopic}
                  invalid={!!errors.topic}
                  describedBy="log-topic-errors"
                />
              </div>
              <FieldMessages id="log-topic-errors" messages={errors.topic} />
            </fieldset>
          </Sheet>

          <Sheet className="space-y-6 px-4 py-5 sm:px-5">
            <div>
              <Label htmlFor="log-minutes" className="text-base font-semibold">
                How long, in minutes?
              </Label>
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Common lengths">
                {MINUTE_PRESETS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={minutesValue === m && minutes !== ""}
                    onClick={() => setMinutes(String(m))}
                    className={cn(
                      "h-9 rounded-md border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      minutesValue === m && minutes !== ""
                        ? "border-brand bg-brand-soft text-foreground"
                        : "border-border bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {minutesText(m)}
                  </button>
                ))}
              </div>
              <Input
                id="log-minutes"
                type="number"
                inputMode="numeric"
                min={1}
                max={720}
                placeholder="Minutes"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                className="mt-3 max-w-40"
                aria-invalid={errors.minutes ? true : undefined}
                aria-describedby="log-minutes-errors"
              />
              <FieldMessages id="log-minutes-errors" messages={errors.minutes} />
            </div>

            <fieldset>
              <legend className="text-base font-semibold text-foreground">What kind of study?</legend>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {MODES.map((m) => (
                  <label
                    key={m.value}
                    className={cn(
                      "flex cursor-pointer flex-col rounded-md border px-3 py-2.5 text-sm transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                      mode === m.value ? "border-brand bg-brand-soft" : "border-border bg-card hover:bg-muted/60",
                    )}
                  >
                    <input
                      type="radio"
                      name="log-mode"
                      value={m.value}
                      checked={mode === m.value}
                      onChange={() => setMode(m.value)}
                      className="sr-only"
                    />
                    <span className="font-semibold text-foreground">{modeLabel(m.value)}</span>
                    <span className="text-xs text-muted-foreground">{m.hint}</span>
                  </label>
                ))}
              </div>
              <FieldMessages messages={errors.mode} />
            </fieldset>

            <div>
              <Label htmlFor="log-when" className="text-base font-semibold">
                When?
              </Label>
              <p className="mt-1 text-sm text-muted-foreground">
                Now, or earlier. Logging this evening for this afternoon is fine.
              </p>
              <Input
                id="log-when"
                type="datetime-local"
                value={when}
                max={toLocalInput(new Date())}
                onChange={(e) => setWhen(e.target.value)}
                className="mt-2 max-w-64"
                aria-invalid={errors.ts || inFuture ? true : undefined}
                aria-describedby="log-when-errors"
              />
              {inFuture ? (
                <p className="mt-1.5 text-sm text-foreground">
                  That time hasn&rsquo;t happened yet. Choose now or earlier.
                </p>
              ) : null}
              <FieldMessages id="log-when-errors" messages={errors.ts} />
            </div>
          </Sheet>

          <div aria-live="polite" className="space-y-2 empty:hidden">
            {otherProblems.length ? <FormNotice tone="problem">{otherProblems.join(" ")}</FormNotice> : null}
            {log.error && status !== 400 ? (
              <FormNotice tone="problem">
                {status === 429
                  ? "You've logged a lot in the last hour. Wait a little, then add this one."
                  : (detailOf(log.error) ?? "That didn't save. Check your connection, then try again.")}
              </FormNotice>
            ) : null}
            {logged ? <FormNotice tone="done">{logged}</FormNotice> : null}
          </div>

          <Button type="submit" size="lg" disabled={!canSubmit}>
            {log.isPending ? (
              <Pending>Logging…</Pending>
            ) : minutes.trim() !== "" && Number.isFinite(minutesValue) && minutesValue > 0 ? (
              `Log ${minutesText(Math.round(minutesValue))}`
            ) : (
              "Log this session"
            )}
          </Button>
        </form>
      )}

      <RecentSessions />

      <p className="mt-8 text-sm text-muted-foreground">
        Want your plan to know which chapters feel shaky?{" "}
        <Link to="/confidence" className="font-medium text-brand-ink underline decoration-brand-line underline-offset-4">
          Rate how sure you feel
        </Link>
      </p>
    </>
  );
}

function RecentSessions() {
  const logs = useMyStudyLogs();
  return (
    <Block title="Recent sessions">
      {logs.isPending ? (
        <LoadingRows rows={2} label="Loading recent sessions" />
      ) : logs.error ? (
        <Trouble error={logs.error} what="your recent sessions" onRetry={() => void logs.refetch()} />
      ) : logs.data.length ? (
        <Sheet as="ul" className="divide-y divide-border">
          {logs.data.map((row) => (
            <li key={row.id} className="flex items-baseline justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{row.topic_name}</p>
                <p className="text-sm text-muted-foreground">{whenText(row.ts)}</p>
              </div>
              <p className="tnum shrink-0 text-sm text-muted-foreground">
                {modeLabel(row.mode)}, {minutesText(row.minutes)}
              </p>
            </li>
          ))}
        </Sheet>
      ) : (
        <Quiet>Nothing logged yet. Your first session will show here.</Quiet>
      )}
    </Block>
  );
}
