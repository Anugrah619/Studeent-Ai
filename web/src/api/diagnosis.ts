/**
 * The reasoning layer's two routes.
 *
 * Everything else the console talks to is typed from `openapi.yaml` via
 * `schema.d.ts`. These two are not in that file yet
 * ({@link API_GAPS.DIAGNOSIS_NOT_IN_CONTRACT}), so the shapes below are
 * hand-written — the only hand-written request types in the client, and they
 * are marked as such so nobody mistakes them for generated truth.
 *
 * They are written *defensively* on purpose. A hand-written type is a claim
 * about a server that has never answered this build, and the two places that
 * claim is least safe are the ones the parsers below guard:
 *
 *   - `evidence_questions` has no documented element type
 *     ({@link API_GAPS.DIAGNOSIS_EVIDENCE_ID_TYPE}) — "D3" and `3` are both
 *     plausible, so both are accepted and rendered as text.
 *   - `counter_evidence` and `human_verdict` are nullable in the obvious
 *     reading, and absent in the other one. Both collapse to `null`.
 */
import { apiGetAhead, apiPostAhead } from "./client";

export const DIAGNOSIS_PATH = "/api/students/{id}/diagnosis/";
export const DIAGNOSIS_VERDICT_PATH = "/api/students/{id}/diagnosis/verdict/";

/** How sure the reasoning layer is. Ordered — `high` is the strongest claim. */
export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export type HumanVerdict = "agreed" | "disagreed";

export interface Hypothesis {
  /** Stable code for the misconception, e.g. `MIS-ORG-EAS`. */
  misconception_code: string;
  /** One sentence naming what the student believes that is not true. */
  claim: string;
  confidence: Confidence;
  /** Question ids the claim rests on. Ints or paper labels — see the note. */
  evidence_questions: (string | number)[];
  /**
   * The observation that argues *against* the claim, or narrows it. This is the
   * field that separates a diagnosis from a topic report: it is what shows the
   * trigger is specific rather than the whole chapter being weak.
   */
  counter_evidence: string | null;
  marks_at_stake: number;
}

export interface Diagnosis {
  /** One sentence a teacher can act on. Rendered as the hero. */
  headline: string;
  /** `false` is a real answer: scattered carelessness, not a systematic error. */
  pattern_found: boolean;
  hypotheses: Hypothesis[];
  recommended_action: string;
  /** Human-readable, e.g. "one 40-minute sitting". */
  time_to_fix: string;
  trace_id: string;
  from_cache: boolean;
  human_verdict: HumanVerdict | null;
}

export interface DiagnosisVerdictBody {
  verdict: HumanVerdict;
  note?: string;
}

/* ------------------------------------------------------------------ *
 * Parsing
 *
 * A malformed field must degrade one row of the card, never throw inside a
 * render. The narrowing below is the whole reason the raw response is not
 * handed straight to the component.
 * ------------------------------------------------------------------ */

function isConfidence(value: unknown): value is Confidence {
  return CONFIDENCE_LEVELS.includes(value as Confidence);
}

function isVerdict(value: unknown): value is HumanVerdict {
  return value === "agreed" || value === "disagreed";
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableStr(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function int(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseHypothesis(raw: unknown): Hypothesis {
  const row = (raw ?? {}) as Record<string, unknown>;
  const evidence = Array.isArray(row.evidence_questions)
    ? row.evidence_questions.filter(
        (q): q is string | number =>
          typeof q === "string" || typeof q === "number",
      )
    : [];
  return {
    misconception_code: str(row.misconception_code, "UNCODED"),
    claim: str(row.claim),
    // An unrecognised confidence must not read as high. Default down.
    confidence: isConfidence(row.confidence) ? row.confidence : "low",
    evidence_questions: evidence,
    counter_evidence: nullableStr(row.counter_evidence),
    marks_at_stake: int(row.marks_at_stake),
  };
}

export function parseDiagnosis(raw: unknown): Diagnosis {
  const body = (raw ?? {}) as Record<string, unknown>;
  return {
    headline: str(body.headline),
    // Absent `pattern_found` with no hypotheses is "no pattern", not a pattern
    // with nothing behind it — the card must never claim more than it has.
    pattern_found:
      typeof body.pattern_found === "boolean"
        ? body.pattern_found
        : Array.isArray(body.hypotheses) && body.hypotheses.length > 0,
    hypotheses: Array.isArray(body.hypotheses)
      ? body.hypotheses.map(parseHypothesis)
      : [],
    recommended_action: str(body.recommended_action),
    time_to_fix: str(body.time_to_fix),
    trace_id: str(body.trace_id),
    from_cache: body.from_cache === true,
    human_verdict: isVerdict(body.human_verdict) ? body.human_verdict : null,
  };
}

/* ------------------------------------------------------------------ *
 * Calls
 * ------------------------------------------------------------------ */

export async function fetchDiagnosis(
  studentId: number,
  paperId: number | undefined,
  signal?: AbortSignal,
): Promise<Diagnosis> {
  const raw = await apiGetAhead<unknown>(DIAGNOSIS_PATH, {
    path: { id: studentId },
    query: { paper: paperId },
    signal,
  });
  return parseDiagnosis(raw);
}

export function postDiagnosisVerdict(
  studentId: number,
  body: DiagnosisVerdictBody,
): Promise<unknown> {
  return apiPostAhead<unknown>(DIAGNOSIS_VERDICT_PATH, {
    path: { id: studentId },
    body,
  });
}

/* ------------------------------------------------------------------ *
 * The two failures the card has to say something intelligent about
 * ------------------------------------------------------------------ */

/** No API key configured: the reasoning layer is not wired up yet. */
export const REASONING_UNAVAILABLE = 503;
/** Not enough tagged evidence to reason over. A different thing entirely. */
export const NOT_ENOUGH_EVIDENCE = 422;
