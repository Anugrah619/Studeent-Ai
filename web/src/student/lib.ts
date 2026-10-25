import type { NextAction } from "@/api/types";
import { resolveSubject } from "@/lib/subjects";

/**
 * Small, pure helpers the student screens share: calendar days counted the way
 * the student's phone counts them, durations in words, and the few phrases
 * that must read the same on every screen ("was due 3 days ago").
 */

const IN = "en-IN";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Today, as `YYYY-MM-DD` in local time. */
export function todayISO(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Whole calendar days from today to `day`: negative is in the past. */
export function daysFromToday(day: string, now = new Date()): number {
  const target = parseDay(day);
  const today = parseDay(todayISO(now));
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** "Thu 29 Oct". */
export function shortDay(day: string): string {
  return parseDay(day).toLocaleDateString(IN, { weekday: "short", day: "numeric", month: "short" });
}

/** "6 April 2027". */
export function fullDate(day: string): string {
  return parseDay(day).toLocaleDateString(IN, { day: "numeric", month: "long", year: "numeric" });
}

/** "Saturday, 24 October". */
export function todayLine(now = new Date()): string {
  return now.toLocaleDateString(IN, { weekday: "long", day: "numeric", month: "long" });
}

/**
 * When a revision is or was due, as a plain fact. An overdue one "was due 3
 * days ago" — never "overdue", never in red: it is still worth doing today.
 */
export function dueText(day: string, now = new Date()): string {
  const diff = daysFromToday(day, now);
  if (diff < -1) return `Was due ${-diff} days ago`;
  if (diff === -1) return "Was due yesterday";
  if (diff === 0) return "Due today";
  if (diff === 1) return "Due tomorrow";
  if (diff < 7) return `Due ${parseDay(day).toLocaleDateString(IN, { weekday: "long" })}`;
  return `Due ${shortDay(day)}`;
}

/** "Today, 7:10 pm", "Yesterday, 4:00 pm", "Thu 22 Oct, 9:10 am". */
export function whenText(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString(IN, { hour: "numeric", minute: "2-digit" });
  const diff = daysFromToday(todayISO(d), now);
  if (diff === 0) return `Today, ${time}`;
  if (diff === -1) return `Yesterday, ${time}`;
  return `${shortDay(todayISO(d))}, ${time}`;
}

/** "45 min", "2 h", "3 h 30 min". */
export function minutesText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  if (!m) return `${h} h`;
  return `${h} h ${m} min`;
}

/** The same, spelled out for a screen reader. */
export function minutesSpoken(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h ? `${h} hour${h === 1 ? "" : "s"}` : "";
  const mins = m ? `${m} minute${m === 1 ? "" : "s"}` : "";
  return [hours, mins].filter(Boolean).join(" ") || "0 minutes";
}

/** `<input type="datetime-local">` value for an instant, in local time. */
export function toLocalInput(date: Date): string {
  return `${todayISO(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "Good morning" / "Good afternoon" / "Good evening". */
export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** The name to greet someone by. "Md. Faizan Ali" is Faizan, not "Md.". */
export function firstName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return parts.find((part) => !part.endsWith(".")) ?? parts[0] ?? full;
}

export function initialsOf(full: string): string {
  return full
    .split(/\s+/)
    .filter((part) => /[A-Za-z]/.test(part) && !part.endsWith("."))
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export const MODE_LABEL: Record<string, string> = {
  learn: "Learn",
  practice: "Practice",
  revise: "Revise",
};

export function modeLabel(mode: string): string {
  return MODE_LABEL[mode] ?? mode;
}

/**
 * A subject's own colour, for a small swatch beside its name — or null for a
 * subject the palette has no colour for (NEET's Botany and Zoology). A grey
 * swatch would read as "no claim", so none is drawn; the name carries it.
 */
export function subjectColor(subject: string): string | null {
  const token = resolveSubject(subject);
  return token.color === "var(--status-neutral)" ? null : token.color;
}

/** Where a next action leads, as a route in this app. */
export function targetPath(target: NextAction["target"]): string {
  if (typeof target === "object" && target !== null) {
    return `/progress?paper=${target.mock}#marks`;
  }
  switch (target) {
    case "plan":
      return "/";
    case "revisions":
      return "/revisions";
    case "topics":
      return "/progress#chapters";
    case "study-log":
      return "/log";
    case "confidence":
      return "/confidence";
    default:
      return "/guide";
  }
}

/** Distinct values, in first-seen order. */
export function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
