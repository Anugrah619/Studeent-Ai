import type { Diagnosis, HumanVerdict } from "@/api/diagnosis";
import type { Diagnosis as WireDiagnosis } from "@/api/types";

/**
 * Reasoning-layer fixtures, transcribed from real responses.
 *
 * These were invented, and it showed the moment the console met a live server:
 * the fixture `time_to_fix` was the prose `"one 40-minute sitting"`, the
 * fixture `trace_id` was an opaque `"rsn_01JQ8F3K2M7ZB4V"`, and the fixture
 * `human_verdict` was `null`. The server sends a four-valued enum, an integer,
 * and the literal `"unreviewed"`. A mock that disagrees with the server on
 * three fields is not a test double, it is a second product.
 *
 * So every diagnosis below is the actual body returned by
 * `GET /api/students/{id}/diagnosis/?paper=17` against the seeded institute,
 * copied verbatim — headline, claim, counter-evidence, marks, band, and the
 * resolved `evidence` rows with the option each student actually chose.
 * Student ids match the live roster, which is what makes flipping
 * `VITE_USE_MOCKS` a change of *source* rather than a change of subject.
 *
 * Exactly one row is not a transcript, and says so where it sits: an
 * unresolved citation on Tanvi's weakest hypothesis, because every live trace
 * so far resolves cleanly and the null branch would otherwise never render.
 *
 * Between them these reach every state the card can be in, so the whole thing
 * is demonstrable by clicking through the roster with no backend and no API
 * key:
 *
 *   1  Aarav Mehta      MIS-ORG-EAS, high confidence, one hypothesis
 *   2  Ishita Rao       MIS-ORG-MARKOV, three hypotheses, mixed confidence
 *   3  Md. Faizan Ali   pattern_found: false — scattered carelessness
 *   4  Kunal Deshpande  MIS-ROT-AXIS, high confidence
 *   5  Tanvi Shah       MIS-CALC-CHAIN, four hypotheses
 *   6  Priya Nair       503, the reasoning layer is not configured
 *   everyone else       422, not enough tagged evidence on this paper
 */

const DIAGNOSES: Record<number, Diagnosis> = {
  1: {
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    headline:
      "Reverses electrophilic aromatic substitution directing effects across multiple functional groups, costing 25 marks.",
    pattern_found: true,
    hypotheses: [
      {
        misconception_code: "MIS-ORG-EAS",
        claim:
          "The student systematically treats activating groups as meta-directing and deactivating groups as ortho/para-directing in electrophilic aromatic substitution.",
        confidence: "high",
        evidence_questions: ["D16", "D17", "D18", "D20", "D21"],
        evidence: [
          { question_id: 923, label: "D16", chose: "C", marks_at_stake: 5 },
          { question_id: 924, label: "D17", chose: "C", marks_at_stake: 5 },
          { question_id: 925, label: "D18", chose: "D", marks_at_stake: 5 },
          { question_id: 927, label: "D20", chose: "B", marks_at_stake: 5 },
          { question_id: 928, label: "D21", chose: "C", marks_at_stake: 5 },
        ],
        counter_evidence:
          "In D22 and D23, the stems explicitly named the directing nature of the -SO3H and -OH groups, and the student answered them correctly. The direct prompting bypasses the faulty internal model of group activation.",
        marks_at_stake: 25,
      },
    ],
    recommended_action:
      "Work through questions D16, D17, and D18 on the board, drawing the resonance structures for toluene, nitrobenzene, and phenol to derive electron density at ortho, meta, and para positions rather than relying on memorized rules. The remaining errors in electrostatics, kinematics, trigonometry, and chemical bonding are scattered across unrelated chapters.",
    total_marks_at_stake: 25,
    time_to_fix: "one_session",
    trace_id: 53,
    from_cache: false,
    human_verdict: null,
  },
  2: {
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    headline:
      "Reverses Markovnikov and anti-Markovnikov rules on unsymmetrical alkenes — costing 20 marks.",
    pattern_found: true,
    hypotheses: [
      {
        misconception_code: "MIS-ORG-MARKOV",
        claim:
          "The student systematically reverses the regiochemistry of hydrohalogenation, applying anti-Markovnikov addition in the absence of peroxides and Markovnikov addition in their presence.",
        confidence: "high",
        evidence_questions: ["D24", "D25", "D27", "D28"],
        evidence: [
          { question_id: 931, label: "D24", chose: "B", marks_at_stake: 5 },
          { question_id: 932, label: "D25", chose: "A", marks_at_stake: 5 },
          { question_id: 934, label: "D27", chose: "B", marks_at_stake: 5 },
          { question_id: 935, label: "D28", chose: "B", marks_at_stake: 5 },
        ],
        counter_evidence:
          "D29: the alkene was symmetrical, so regiochemistry did not affect the product. The addition mechanics are fine; the error only triggers when choosing between unsymmetrical positions.",
        marks_at_stake: 20,
      },
      {
        misconception_code: "MIS-ROT-SHAPE",
        claim:
          "The student defaults to MR^2 for a disc's moment of inertia, failing to distinguish between different rotational axes (diameter vs. perpendicular through center).",
        confidence: "medium",
        evidence_questions: ["D02", "D07"],
        evidence: [
          { question_id: 909, label: "D02", chose: "C", marks_at_stake: 5 },
          { question_id: 914, label: "D07", chose: "B", marks_at_stake: 5 },
        ],
        counter_evidence:
          "D04, D06, D08: the questions involved rods and the parallel-axis theorem, which were solved correctly. The integration and theorem application are sound; the error is isolated to memorized disc formulas.",
        marks_at_stake: 10,
      },
      {
        misconception_code: "MIS-CALC-CHAIN",
        claim:
          "The student multiplies by the inner derivative instead of dividing when integrating simple exponential functions.",
        confidence: "medium",
        evidence_questions: ["D34"],
        evidence: [
          { question_id: 941, label: "D34", chose: "A", marks_at_stake: 5 },
        ],
        counter_evidence:
          "D39: the substitution u = x^2 + 1 was explicitly provided in the stem, and they integrated it correctly. The basic integration process is sound; the error occurs when they must perform the chain-rule adjustment mentally.",
        marks_at_stake: 5,
      },
    ],
    recommended_action:
      "Have the student draw the carbocation and radical intermediates for HBr addition to propene (D24, D25) to ground the rules in intermediate stability. The remaining errors (D11, D20, D30, D37, D45) are scattered across unrelated chapters like electrostatics, organic directing groups, and basic algebra.",
    total_marks_at_stake: 35,
    time_to_fix: "one_session",
    trace_id: 64,
    from_cache: false,
    human_verdict: null,
  },
  3: {
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    headline:
      "No systematic misconception in Faizan's paper — the six wrong answers do not share a cause.",
    pattern_found: false,
    hypotheses: [],
    recommended_action:
      "Nothing to re-teach. The six he lost were spread across five chapters with no repeated error and all six in the last forty minutes — that is a checking and pacing conversation, not a teaching one.",
    // The band exists even when the finding is "no finding": a pacing
    // conversation is minutes at the board, and saying so is the difference
    // between an honest null result and a card that just gives up.
    total_marks_at_stake: 0,
    time_to_fix: "minutes",
    trace_id: 71,
    from_cache: false,
    human_verdict: null,
  },
  4: {
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    headline:
      "Defaults to standard central-axis formulas instead of applying parallel/perpendicular axis theorems — 25 marks.",
    pattern_found: true,
    hypotheses: [
      {
        misconception_code: "MIS-ROT-AXIS",
        claim:
          "The student consistently defaults to standard central-axis formulas (or incorrect default axes) for moment of inertia calculations, failing to apply the parallel-axis or perpendicular-axis theorems when the axis of rotation is shifted or rotated.",
        confidence: "high",
        evidence_questions: ["D02", "D03", "D04", "D05", "D06"],
        evidence: [
          { question_id: 909, label: "D02", chose: "A", marks_at_stake: 5 },
          { question_id: 910, label: "D03", chose: "C", marks_at_stake: 5 },
          { question_id: 911, label: "D04", chose: "D", marks_at_stake: 5 },
          { question_id: 912, label: "D05", chose: "A", marks_at_stake: 5 },
          { question_id: 913, label: "D06", chose: "D", marks_at_stake: 5 },
        ],
        counter_evidence:
          "D07 and D08: the axis was either the standard central perpendicular one or the question explicitly prompted the use of the parallel-axis theorem, both of which they answered correctly. The formulas are memorized; the breakdown occurs when they must independently recognize a non-standard axis and select the correct theorem to apply.",
        marks_at_stake: 25,
      },
    ],
    recommended_action:
      "Conduct a focused session on identifying shifted or rotated axes of rotation, practicing the step-by-step application of parallel and perpendicular axis theorems on discs, rings, and rods. The remaining four errors are scattered across unrelated chapters (Magnetism, Organic Chemistry, and Equilibrium) with no clear systematic pattern.",
    total_marks_at_stake: 25,
    time_to_fix: "one_session",
    trace_id: 56,
    from_cache: false,
    human_verdict: null,
  },
  5: {
    paper_id: 17,
    paper_name: "Mock 15 — Diagnostic",
    headline:
      "Drops inner derivative factors in chain-rule differentiation and integration — 25 marks lost.",
    pattern_found: true,
    hypotheses: [
      {
        misconception_code: "MIS-CALC-CHAIN",
        claim:
          "Consistently ignores the chain rule inner derivative factor when differentiating or integrating composite functions.",
        confidence: "high",
        evidence_questions: ["D32", "D33", "D35", "D36", "D37"],
        evidence: [
          { question_id: 939, label: "D32", chose: "A", marks_at_stake: 5 },
          { question_id: 940, label: "D33", chose: "C", marks_at_stake: 5 },
          { question_id: 942, label: "D35", chose: "D", marks_at_stake: 5 },
          { question_id: 943, label: "D36", chose: "B", marks_at_stake: 5 },
          { question_id: 944, label: "D37", chose: "D", marks_at_stake: 5 },
        ],
        counter_evidence:
          "In D38 and D39, the questions required applying the product rule and explicit u-substitution rather than standard direct composite functions; the algebra of the structural setup was different, proving the student can execute basic rules when the chain is forced into view via substitution.",
        marks_at_stake: 25,
      },
      {
        misconception_code: "MIS-ROT-SHAPE",
        claim:
          "Confuses standard moment of inertia formulas for different bodies.",
        confidence: "low",
        evidence_questions: ["D05"],
        evidence: [
          { question_id: 912, label: "D05", chose: "B", marks_at_stake: 5 },
        ],
        counter_evidence:
          "In D04, D06, and D08, the stems dealt with rods rather than rings and required parallel-axis theorem applications correctly; the geometry was distinct, showing the error is isolated to ring axis configurations.",
        marks_at_stake: 5,
      },
      {
        misconception_code: "MIS-KIN-RELVEL",
        claim:
          "Fails to correctly apply relative velocity frames in vector kinematics.",
        confidence: "low",
        // The one row in this file that is NOT a transcript. The live traces so
        // far resolve every citation, so nothing here would exercise the
        // unresolved case — and a state with no fixture is a state nobody sees
        // until it is in front of a buyer. D12 is the model naming a question
        // that is not one of this student's wrong answers on this paper:
        // `question_id: null`, no chosen option, and — per the contract — no
        // marks, which is why `marks_at_stake` below stays 5 for the one
        // citation that did resolve.
        evidence_questions: ["D15", "D12"],
        evidence: [
          { question_id: 922, label: "D15", chose: "C", marks_at_stake: 5 },
          { question_id: null, label: "D12", chose: "", marks_at_stake: 0 },
        ],
        counter_evidence:
          "In D13 and D14, the questions involved simple average speed and direct scalar differentiation without vector frame transformations; the absence of relative velocity components allowed correct navigation.",
        marks_at_stake: 5,
      },
      {
        misconception_code: "MIS-ORG-MARKOV",
        claim: "Misapplies Markovnikov's rule during alkene additions.",
        confidence: "low",
        evidence_questions: ["D24"],
        evidence: [
          { question_id: 931, label: "D24", chose: "B", marks_at_stake: 5 },
        ],
        counter_evidence:
          "In D16, D17, D19, D22, and D29, the questions focused on aromatic electrophilic substitution and symmetric alkenes like but-2-ene; the symmetrical nature or aromatic ring context bypassed the need for regioselective addition.",
        marks_at_stake: 5,
      },
    ],
    recommended_action:
      "Work through questions D32, D33, and D36 side-by-side with an explicit substitution step (let u equal the inner expression) to force writing out the inner derivative factor before final integration or differentiation. The single unexplained error on question D20 looks like an isolated factual recall lapse regarding anisole chlorination orientation.",
    total_marks_at_stake: 40,
    time_to_fix: "one_session",
    trace_id: 61,
    from_cache: false,
    human_verdict: null,
  },
};

/** Students the fixture answers 503 for: the reasoning layer is not configured. */
const UNCONFIGURED = new Set([6]);

export type DiagnosisOutcome =
  | { kind: "ok"; body: WireDiagnosis }
  | { kind: "unavailable"; detail: string }
  | { kind: "insufficient"; detail: string };

/**
 * The stored diagnosis as it goes over the wire.
 *
 * The rows above hold the *parsed* shape, because that is what the card
 * consumes and what a fixture is easiest to read as. The server does not send
 * that shape: `human_verdict` is never null on the wire — it is the literal
 * `"unreviewed"` until a teacher answers, and `null` here would let the client
 * skip the one narrowing that stops the card telling an untouched diagnosis
 * "You disagreed with this". Serialising through this function is what keeps
 * the mock honest about the field it would be most convenient to fake.
 */
function toWire(row: Diagnosis, from_cache: boolean): WireDiagnosis {
  return {
    ...row,
    time_to_fix: row.time_to_fix ?? "one_session",
    human_verdict: row.human_verdict ?? "unreviewed",
    from_cache,
  };
}

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
    // Word for word what the live server answers with a 422.
    return {
      kind: "insufficient",
      detail: "No wrong answers with a recorded option — nothing to diagnose.",
    };
  }

  const key = `${studentId}:${paperId}`;
  const from_cache = served.has(key);
  served.add(key);
  return { kind: "ok", body: toWire(found, from_cache) };
}

/**
 * The verdict sticks for the session, so a refetch shows what was recorded.
 *
 * Returns the updated diagnosis rather than a boolean-plus-receipt, because
 * that is what the live route answers with: a 200 carrying the whole
 * `Diagnosis` schema with `human_verdict` set.
 */
export function recordVerdict(
  studentId: number,
  verdict: HumanVerdict,
): WireDiagnosis | null {
  const found = DIAGNOSES[studentId];
  if (!found) return null;
  found.human_verdict = verdict;
  return toWire(found, true);
}

/** Reset between tests that care about the untouched state. */
export function resetDiagnoses() {
  served.clear();
  for (const row of Object.values(DIAGNOSES)) row.human_verdict = null;
}
