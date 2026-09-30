import {
  AlertTriangle,
  ArrowUpRight,
  CircleCheck,
  Eye,
  OctagonAlert,
  type LucideIcon,
} from "lucide-react";
import type { Severity } from "@/api/types";

/**
 * Status is a reserved channel. Every token ships an icon AND a word, so the
 * colour is the third signal, never the only one.
 */
export interface SeverityToken {
  key: Severity | "ok";
  label: string;
  icon: LucideIcon;
  /** Text colour class. */
  text: string;
  /** Tinted chip background. */
  chip: string;
  /** Solid colour for a mark or rail. */
  color: string;
  /** Sort weight — highest first in a triage list. */
  weight: number;
}

export const SEVERITY: Record<Severity | "ok", SeverityToken> = {
  critical: {
    key: "critical",
    label: "Critical",
    icon: OctagonAlert,
    text: "text-status-critical",
    chip: "bg-status-critical/12 text-status-critical ring-1 ring-status-critical/25",
    color: "var(--status-critical)",
    weight: 4,
  },
  high: {
    key: "high",
    label: "High",
    icon: AlertTriangle,
    text: "text-status-warn",
    chip: "bg-status-warn/12 text-status-warn ring-1 ring-status-warn/25",
    color: "var(--status-warn)",
    weight: 3,
  },
  watch: {
    key: "watch",
    label: "Watch",
    icon: Eye,
    text: "text-status-neutral",
    chip: "bg-status-neutral/12 text-foreground/80 ring-1 ring-status-neutral/25",
    color: "var(--status-neutral)",
    weight: 2,
  },
  improving: {
    key: "improving",
    label: "Improving",
    icon: ArrowUpRight,
    text: "text-status-good",
    chip: "bg-status-good/12 text-status-good ring-1 ring-status-good/25",
    color: "var(--status-good)",
    weight: 1,
  },
  ok: {
    key: "ok",
    label: "On track",
    icon: CircleCheck,
    text: "text-status-good",
    chip: "bg-status-good/10 text-status-good ring-1 ring-status-good/20",
    color: "var(--status-good)",
    weight: 0,
  },
};

export const SEVERITY_FILTER_ORDER: (Severity | "ok")[] = [
  "critical",
  "high",
  "watch",
  "improving",
  "ok",
];

/**
 * The band cut-offs for `risk_score`, and the scale they sit on.
 *
 * **0–1, not 0–100.** The contract says so now, and this function assumed
 * otherwise: against the live server it banded 0.696 — a high-risk student —
 * at `>= 75`, fell through every branch, and returned "On track". The whole
 * institute rendered as healthy, on the one screen whose entire job is to say
 * who is not. Nothing caught it because the mock fixtures shipped 0–100
 * values, so the console agreed with itself right up to first contact.
 *
 * The four bands are the server's, not a UI decision: `?at_risk=true` keys off
 * the same 0.55, so a student the API calls at-risk and a student this console
 * chips "High" are the same student by construction rather than by luck.
 */
export const RISK_BANDS = {
  critical: 0.75,
  high: 0.55,
  watch: 0.35,
} as const;

export function riskBand(score: number | null | undefined): SeverityToken {
  // Null means not enough signal to score them at all — unmeasured, not safe.
  // It renders as `ok` because there is nothing to claim, but no *number* may
  // arrive here by falling through the bands.
  if (score == null) return SEVERITY.ok;
  if (score >= RISK_BANDS.critical) return SEVERITY.critical;
  if (score >= RISK_BANDS.high) return SEVERITY.high;
  if (score >= RISK_BANDS.watch) return SEVERITY.watch;
  return SEVERITY.ok;
}

/** Human labels for the detector `type` strings the backend emits. */
export const DETECTOR_LABELS: Record<string, string> = {
  weak_topic: "Weak topic",
  over_attempting: "Over-attempting",
  plateau: "Plateau",
  subject_imbalance: "Subject imbalance",
  confidence_mismatch: "Confidence mismatch",
  revision_overdue: "Revision overdue",
  disengagement: "Disengagement",
  overload: "Overload",
  mock_decline: "Mock decline",
};

export function detectorLabel(type: string): string {
  return DETECTOR_LABELS[type] ?? type.replace(/_/g, " ");
}
