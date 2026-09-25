/**
 * Places where the UI needs something `openapi.yaml` does not currently give it.
 *
 * Nothing here is a workaround hidden in a component — every gap is named, and
 * the code that compensates for it imports from this file so the debt is
 * greppable. When the contract catches up, delete the entry and the call sites
 * stop compiling.
 */

export const API_GAPS = {
  /** `flags_list` declares only `page`. The triage view needs open flags only. */
  FLAGS_OPEN_FILTER: "GET /api/flags/ has no `open` query param",
  /** No `student` filter either, so Student 360 fetches all flags and filters. */
  FLAGS_STUDENT_FILTER: "GET /api/flags/ has no `student` query param",
  /** `students_list` has no ordering, so the triage table sorts client-side. */
  STUDENTS_ORDERING: "GET /api/students/ has no `ordering` / `search` param",
  /** `DashboardSummary` is institute-wide; the console has a batch filter. */
  DASHBOARD_BATCH_SCOPE: "GET /api/dashboard/summary/ has no `batch` param",
  /** `risk_score` has no documented scale or severity thresholds. */
  RISK_SCORE_BANDS: "StudentList.risk_score has no documented scale/bands",
  /** Mock scores are paginated with no guaranteed chronological ordering. */
  MOCK_SCORES_ORDER: "GET mock-scores/ does not guarantee held_on ordering",
  /** `MarksLost` omits the paper max so 'X of Y' needs a second request. */
  MARKS_LOST_DENOMINATOR: "MarksLost carries no max_marks / scored",
  /** Nothing exposes the institute or the signed-in user. */
  NO_SESSION_ENDPOINT: "No /api/me/ or /api/institute/ endpoint",
  /** Intervention requires a mentor id but no mentor list endpoint exists. */
  NO_MENTOR_LIST: "InterventionRequest.mentor has no source endpoint",
  /**
   * The two reasoning-layer routes are live in the API but absent from the copy
   * of `openapi.yaml` this worktree generates from, so `Diagnosis` and its
   * verdict body are hand-written in `api/diagnosis.ts` instead of generated.
   */
  DIAGNOSIS_NOT_IN_CONTRACT:
    "GET /api/students/{id}/diagnosis/ is not in openapi.yaml",
  DIAGNOSIS_VERDICT_NOT_IN_CONTRACT:
    "POST /api/students/{id}/diagnosis/verdict/ is not in openapi.yaml",
  /** Nothing says whether a question id is an int pk or a paper label ("D3"). */
  DIAGNOSIS_EVIDENCE_ID_TYPE:
    "Diagnosis.hypotheses[].evidence_questions has no documented element type",
  /** No documented link from a question id to anything the UI can open. */
  DIAGNOSIS_EVIDENCE_NOT_LINKABLE:
    "Diagnosis evidence question ids have no lookup endpoint",
} as const;

export type ApiGap = keyof typeof API_GAPS;
