/**
 * The reasoning layer's two routes.
 *
 * Both are in `openapi.yaml` now, so every type below is an alias into the
 * generated schema and both calls go through `apiGet`/`apiPost` like everything
 * else. The hand-written shapes and the `apiGetAhead`/`apiPostAhead` escape
 * hatches they needed are gone.
 *
 * What is NOT gone is the parser. It survived first contact with the live
 * server for reasons the contract does not capture, and each one is a bug the
 * card would otherwise ship:
 *
 *   - `human_verdict` is a *three*-valued string. The server sends the literal
 *     `"unreviewed"` when nobody has answered yet — not `null`, not `""`. Read
 *     as a truthy string, the card announces "You disagreed with this
 *     diagnosis" to a teacher who has never seen it. It is normalised to
 *     `null` here, once.
 *   - `time_to_fix` is an enum the client must map to a label. An unrecognised
 *     value becomes `null` and renders as nothing, rather than being coerced
 *     into whichever band happens to be first — a wrong band is worse than no
 *     band, which is the entire reason this field stopped being free text.
 *   - `trace_id` is an integer, not the opaque string the hand-written type
 *     guessed. Coercing it to `String()` gave `""`, which is falsy, which is
 *     why the trace chip never appeared.
 *   - `evidence_questions` is declared `string[]` and arrives as `["D16", …]`,
 *     but ints are cheap to accept and a thrown render is not.
 */
import { apiGet, apiPost } from "./client";
import type {
  Confidence,
  Diagnosis as WireDiagnosis,
  DiagnosisEvidence,
  DiagnosisHypothesis,
  DiagnosisVerdictRequest,
  TimeToFix,
  Verdict,
} from "./types";

export const DIAGNOSIS_PATH = "/api/students/{id}/diagnosis/";
export const DIAGNOSIS_VERDICT_PATH = "/api/students/{id}/diagnosis/verdict/";

/** How sure the reasoning layer is. Ordered — `high` is the strongest claim. */
export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;

export type { Confidence, TimeToFix };
export type HumanVerdict = Verdict;
export type Hypothesis = DiagnosisHypothesis;
export type Evidence = DiagnosisEvidence;
export type DiagnosisVerdictBody = DiagnosisVerdictRequest;

/**
 * A citation the server could tie to an answer this student actually gave.
 *
 * `question_id: null` means the model named a question that is not one of this
 * student's wrong answers on this paper. The contract is explicit about what
 * to do: render those as plain text, never as a link to nowhere. This narrowing
 * is what lets the card do that without a null check at every use.
 */
export type ResolvedEvidence = Evidence & { question_id: number };

export function isResolved(row: Evidence): row is ResolvedEvidence {
  return typeof row.question_id === "number";
}

/**
 * The wire shape with the two fields the client is allowed to narrow.
 *
 * `human_verdict` collapses `"unreviewed"` to `null`, so "has this teacher
 * answered?" is one truthiness check rather than a string comparison every
 * call site has to remember. `time_to_fix` collapses anything outside the four
 * bands to `null`, for the same reason the enum exists at all.
 */
export type Diagnosis = Omit<WireDiagnosis, "human_verdict" | "time_to_fix"> & {
  human_verdict: HumanVerdict | null;
  time_to_fix: TimeToFix | null;
};

/* ------------------------------------------------------------------ *
 * The bands
 *
 * `time_to_fix` was free text, and the model — asked for minutes — answered
 * "40 minutes", then "20", then "45" for the same student and the same
 * evidence, while its recommended action never moved. That is false precision
 * on a genuinely fuzzy judgement, and false precision is what costs a director
 * trust in everything *else* on the card: if the forty minutes was invented,
 * so might the misconception have been.
 *
 * So the server returns one of four bands and the client supplies the words.
 * The labels below carry no numbers on purpose. "One focused sitting" is a
 * claim the system can defend; "45 minutes" is not.
 * ------------------------------------------------------------------ */

export const TIME_TO_FIX_BANDS = [
  "minutes",
  "one_session",
  "several_sessions",
  "term_long",
] as const;

export const TIME_TO_FIX_LABEL: Record<TimeToFix, string> = {
  minutes: "A few minutes at the board",
  one_session: "One focused sitting",
  several_sessions: "A few sittings over a week or two",
  term_long: "Sustained work this term",
};

/** The label for a band, or `null` when there is no band to speak for. */
export function timeToFixLabel(
  band: TimeToFix | null | undefined,
): string | null {
  return band ? TIME_TO_FIX_LABEL[band] : null;
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

function isTimeToFix(value: unknown): value is TimeToFix {
  return TIME_TO_FIX_BANDS.includes(value as TimeToFix);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function int(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nullableInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseEvidence(raw: unknown): Evidence {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    // Anything that is not a number is an unresolved citation, which the card
    // renders as plain text. Coercing it to 0 would build a link to /questions/0.
    question_id: nullableInt(row.question_id),
    label: str(row.label),
    chose: str(row.chose),
    marks_at_stake: int(row.marks_at_stake),
  };
}

function parseHypothesis(raw: unknown): Hypothesis {
  const row = (raw ?? {}) as Record<string, unknown>;
  const labels = Array.isArray(row.evidence_questions)
    ? row.evidence_questions
        .filter(
          (q): q is string | number =>
            typeof q === "string" || typeof q === "number",
        )
        .map(String)
    : [];
  /**
   * `evidence` is the list to render; `evidence_questions` is what the model
   * literally wrote and is display-only. When the server sends no `evidence` —
   * an older deployment — the labels are lifted into unresolved rows, so the
   * card has exactly one list to walk and shows chips that visibly are not
   * links rather than showing nothing.
   */
  const evidence = Array.isArray(row.evidence)
    ? row.evidence.map(parseEvidence)
    : labels.map((label) => ({
        question_id: null,
        label,
        chose: "",
        marks_at_stake: 0,
      }));
  return {
    misconception_code: str(row.misconception_code, "UNCODED"),
    claim: str(row.claim),
    // An unrecognised confidence must not read as high. Default down.
    confidence: isConfidence(row.confidence) ? row.confidence : "low",
    evidence_questions: labels,
    evidence,
    counter_evidence: str(row.counter_evidence),
    marks_at_stake: int(row.marks_at_stake),
  };
}

export function parseDiagnosis(raw: unknown): Diagnosis {
  const body = (raw ?? {}) as Record<string, unknown>;
  const hypotheses = Array.isArray(body.hypotheses)
    ? body.hypotheses.map(parseHypothesis)
    : [];
  return {
    // Echoed back from `?paper=`. Null is not "unknown" — it means the
    // diagnosis spans every paper this student has sat.
    paper_id: nullableInt(body.paper_id),
    paper_name: typeof body.paper_name === "string" ? body.paper_name : null,
    headline: str(body.headline),
    // Absent `pattern_found` with no hypotheses is "no pattern", not a pattern
    // with nothing behind it — the card must never claim more than it has.
    pattern_found:
      typeof body.pattern_found === "boolean"
        ? body.pattern_found
        : hypotheses.length > 0,
    hypotheses,
    /**
     * Counted server-side over *distinct* cited questions, so it is not the sum
     * of `hypotheses[].marks_at_stake` when the model cites one question twice.
     * The card used to do that sum itself; it reads this instead, because the
     * arithmetic belongs where the de-duplication happens. Falls back to the
     * sum only for a server too old to send it.
     */
    total_marks_at_stake:
      typeof body.total_marks_at_stake === "number"
        ? int(body.total_marks_at_stake)
        : hypotheses.reduce((sum, h) => sum + h.marks_at_stake, 0),
    recommended_action: str(body.recommended_action),
    time_to_fix: isTimeToFix(body.time_to_fix) ? body.time_to_fix : null,
    trace_id: int(body.trace_id),
    from_cache: body.from_cache === true,
    // `"unreviewed"` is the server's third value and means nobody has answered.
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
  const raw = await apiGet(DIAGNOSIS_PATH, {
    path: { id: studentId },
    query: { paper: paperId },
    signal,
  });
  return parseDiagnosis(raw);
}

/**
 * The verdict, which answers with the whole diagnosis, `human_verdict` set.
 *
 * Parsed on the way back for the same reason the GET is: the 200 is the same
 * `Diagnosis` schema, so it carries the same `"unreviewed"` trap the moment a
 * caller trusts it.
 */
export async function postDiagnosisVerdict(
  studentId: number,
  body: DiagnosisVerdictBody,
): Promise<Diagnosis> {
  const raw = await apiPost(DIAGNOSIS_VERDICT_PATH, {
    path: { id: studentId },
    body,
  });
  return parseDiagnosis(raw);
}

/* ------------------------------------------------------------------ *
 * The two failures the card has to say something intelligent about
 * ------------------------------------------------------------------ */

/** No API key configured: the reasoning layer is not wired up yet. */
export const REASONING_UNAVAILABLE = 503;
/** Not enough tagged evidence to reason over. A different thing entirely. */
export const NOT_ENOUGH_EVIDENCE = 422;
