import { RefreshCw } from "lucide-react";
import { longDate } from "@/lib/format";

/** "today at 2:00 am", "yesterday at 2:00 am", "on 21 Oct 2026 at 2:00 am". */
export function refreshedWords(iso: string, now = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "at an unknown time";
  const time = at.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(now) - day(at)) / 86_400_000);
  if (diff === 0) return `today at ${time}`;
  if (diff === 1) return `yesterday at ${time}`;
  return `on ${longDate(iso)} at ${time}`;
}

/** Past this, the nightly job has missed a night and the line says so. */
const STALE_MS = 36 * 3_600_000;

/**
 * When the numbers on the console were last recomputed.
 *
 * Quiet on purpose: it answers "how fresh is this?" for the reader who wonders,
 * and stays out of the way of the one who does not. `null` is "never" — the
 * nightly refresh has not run for this institute, so every figure moved only
 * when new answers or logs arrived — and it says that rather than nothing.
 */
export function RefreshedLine({ at }: { at: string | null | undefined }) {
  if (at === undefined) return null;
  const stale = at !== null && Date.now() - Date.parse(at) > STALE_MS;
  return (
    <span
      data-refreshed=""
      className="inline-flex items-center gap-1.5 text-muted-foreground"
      title="The nightly refresh recomputes every student's figures, revision schedule, flags and plans."
    >
      <RefreshCw aria-hidden className="size-3.5" />
      {at === null ? (
        <span>Data refreshed: never. Figures change only as new answers and logs arrive.</span>
      ) : (
        <span>
          Data refreshed {refreshedWords(at)}
          {stale ? ". The nightly refresh has not run since." : ""}
        </span>
      )}
    </span>
  );
}
