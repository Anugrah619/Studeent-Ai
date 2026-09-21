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
 * `risk_score` arrives with no documented scale or thresholds
 * ({@link API_GAPS.RISK_SCORE_BANDS}). These bands assume 0–100 and are a UI
 * decision until the contract states otherwise — the detector tiers that
 * actually own them live in the backend.
 */
export function riskBand(score: number | null | undefined): SeverityToken {
  if (score == null) return SEVERITY.ok;
  if (score >= 75) return SEVERITY.critical;
  if (score >= 55) return SEVERITY.high;
  if (score >= 35) return SEVERITY.watch;
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
