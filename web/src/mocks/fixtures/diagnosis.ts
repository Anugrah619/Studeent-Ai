import type { Diagnosis, HumanVerdict } from "@/api/diagnosis";

/**
 * Reasoning-layer fixtures.
 *
 * The card they feed is the one the pitch turns on, so these are not filler.
 * Aarav's diagnosis is the concept note's worked example, written the way the
 * reasoning layer is meant to write: a claim narrow enough to be wrong, the
 * question ids it rests on, the marks it costs, and — the part every other
 * product leaves out — the observation that argues against it.
 *
 * Between them the five students below reach every state the card can be in,
 * so the whole thing is demonstrable by clicking through the roster with no
 * backend and no API key:
 *
 *   1  Aarav Mehta      two hypotheses, high + medium confidence
 *   2  Ishita Rao       one high-confidence hypothesis
 *   3  Md. Faizan Ali   pattern_found: false — scattered carelessness
 *   5  Tanvi Shah       503, the reasoning layer is not configured
 *   everyone else       422, not enough tagged evidence on this paper
 */

const DIAGNOSES: Record<number, Diagnosis> = {
  1: {
    headline:
      "Aarav does not have an Organic Chemistry problem — he has one rule backwards, and it cost him 20 marks.",
    pattern_found: true,
    hypotheses: [
      {
        misconception_code: "MIS-ORG-EAS",
        claim:
          "He has the directing-effects rule backwards: he treats activating groups (−OH, −NH₂, −CH₃) as meta-directing and deactivating ones (−NO₂, −COOH) as ortho/para-directing.",
        confidence: "high",
        evidence_questions: ["D1", "D2", "D3", "D4"],
        counter_evidence:
          "On the two questions where the directing group was named in the stem, he was correct both times. He can apply the rule — he cannot recall which way it points.",
        marks_at_stake: 20,
      },
      {
        misconception_code: "MIS-ROT-PARALLEL-AXIS",
        claim:
          "He adds the parallel-axis md² term even when the quoted moment of inertia is already about the new axis, double-counting the correction.",
        confidence: "medium",
        evidence_questions: ["P9", "P14"],
        counter_evidence:
          "P21 used the same theorem and he was correct, so this is two errors in three chances — a hypothesis worth testing, not a finding.",
        marks_at_stake: 8,
      },
    ],
    recommended_action:
      "Twenty minutes on ortho/para versus meta directors with the group labelled, then re-run D1–D4 cold. Do not re-teach the chapter.",
    time_to_fix: "one 40-minute sitting",
    trace_id: "rsn_01JQ8F3K2M7ZB4V",
    from_cache: false,
    human_verdict: null,
  },
  2: {
    headline:
      "Ishita understands limiting reagents perfectly — she compares grams instead of moles, and it has cost her 16 marks.",
    pattern_found: true,
    hypotheses: [
      {
        misconception_code: "MIS-STOI-LIMITING",
        claim:
          "She picks whichever reactant is present in the smaller mass as the limiting reagent, rather than converting to moles first.",
        confidence: "high",
        evidence_questions: ["S3", "S7", "S11"],
        counter_evidence:
          "On S5 and S14, where the quantities were already given in moles, she was correct. The concept is intact; the conversion habit is not.",
        marks_at_stake: 16,
      },
    ],
    recommended_action:
      "Five mixed-unit stoichiometry problems where she must write the mole count before choosing. Nothing needs re-teaching.",
    time_to_fix: "one 30-minute sitting",
    trace_id: "rsn_01JQ8F41XD0PM7C",
    from_cache: false,
    human_verdict: null,
  },
  3: {
    headline:
      "No systematic misconception in Faizan's paper — the six wrong answers do not share a cause.",
    pattern_found: false,
    hypotheses: [],
    recommended_action:
      "Nothing to re-teach. The six he lost were spread across five chapters with no repeated error and all six in the last forty minutes — that is a checking and pacing conversation, not a teaching one.",
    time_to_fix: "not a teaching problem — one conversation",
    trace_id: "rsn_01JQ8F4H9WQ2R6N",
    from_cache: false,
    human_verdict: null,
  },
};

/** Students the fixture answers 503 for: the reasoning layer is not configured. */
const UNCONFIGURED = new Set([5]);

export type DiagnosisOutcome =
  | { kind: "ok"; body: Diagnosis }
  | { kind: "unavailable"; detail: string }
  | { kind: "insufficient"; detail: string };

/** Tracks who has been asked once, so `from_cache` flips the way the API's will. */
const served = new Set<string>();

export function diagnosisFor(
  studentId: number,
  paperId: number,
): DiagnosisOutcome {
  if (UNCONFIGURED.has(studentId)) {
    return {
      kind: "unavailable",
      detail:
        "The reasoning layer is not configured on this deployment. Set REASONING_API_KEY and restart to enable diagnoses.",
    };
  }

  const found = DIAGNOSES[studentId];
  if (!found) {
    return {
      kind: "insufficient",
      detail:
        "Not enough tagged evidence on this paper to diagnose. A diagnosis needs at least eight attempts mapped to misconception-tagged questions.",
    };
  }

  const key = `${studentId}:${paperId}`;
  const from_cache = served.has(key);
  served.add(key);
  return { kind: "ok", body: { ...found, from_cache } };
}

/** The verdict sticks for the session, so a refetch shows what was recorded. */
export function recordVerdict(studentId: number, verdict: HumanVerdict): boolean {
  const found = DIAGNOSES[studentId];
  if (!found) return false;
  found.human_verdict = verdict;
  return true;
}

/** Reset between tests that care about the untouched state. */
export function resetDiagnoses() {
  served.clear();
  for (const row of Object.values(DIAGNOSES)) row.human_verdict = null;
}
