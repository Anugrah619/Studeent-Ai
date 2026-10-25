/**
 * Places where the UI needs something `openapi.yaml` does not currently give it.
 *
 * Nothing here is a workaround hidden in a component — every gap is named, and
 * the code that compensates for it imports from this file so the debt is
 * greppable. When the contract catches up, delete the entry and the call sites
 * stop compiling.
 *
 * MOST OF THIS FILE WAS DELETED against the 27-endpoint contract, which is what
 * the file is for. Gone, and why:
 *
 *   FLAGS_OPEN_FILTER / FLAGS_STUDENT_FILTER   `?open=`, `?student=`,
 *     `?severity=` and `?mentor=` are declared. Student 360 no longer pulls
 *     every flag in the institute in order to find one student's.
 *   STUDENTS_ORDERING                          `?ordering=` is declared, with
 *     the sortable columns enumerated and `-risk_score,name` as the default.
 *   DASHBOARD_BATCH_SCOPE                      `?batch=` is declared.
 *   RISK_SCORE_BANDS                           the scale (0–1, **not** 0–100)
 *     and the four band cut-offs are documented on `StudentList.risk_score`.
 *     The console was banding a 0–1 score at 75/55/35, which rendered every
 *     student on the live server as "On track".
 *   MARKS_LOST_DENOMINATOR                     `MarksLost` carries `max_marks`
 *     and `score`, so "X of Y" needs no second request.
 *   MARKS_LOST_CAUSE_SHARE_DENOMINATOR         `share_pct` is documented as a
 *     share of `total_lost`, with the five rows summing to 100%.
 *   MARKS_LOST_FIFTH_CAUSE                     the fifth bucket,
 *     `attributed_lost` and `recoverable_pct` are all in the schema, so
 *     `api/marksLost.ts` and its widening cast are deleted.
 *   TOPIC_STATE_ACCURACY_30D_REMOVED           the stale field is gone from
 *     the contract, so the `Omit<>` that hid it is gone too.
 *   NO_SESSION_ENDPOINT                        `/api/me/` is declared.
 *   NO_MENTOR_LIST                             `/api/mentors/` is declared.
 *   DIAGNOSIS_NOT_IN_CONTRACT / ..._VERDICT_   both reasoning routes are
 *     declared, so `apiGetAhead`/`apiPostAhead` are deleted and
 *     `api/diagnosis.ts` is generated types plus a parser.
 *   DIAGNOSIS_EVIDENCE_ID_TYPE                 declared `string[]`, and the
 *     live server returns paper labels (`"D16"`).
 *   DIAGNOSIS_EVIDENCE_NOT_LINKABLE            `DiagnosisHypothesis.evidence`
 *     resolves every cited label to a `question_id` that
 *     `GET /api/questions/{id}/` answers on, plus the option this student
 *     picked. A label alone never could be linked — it is unique only within
 *     one paper — which is exactly why the server resolves it now.
 *
 * And against the round-two contract:
 *
 *   MOCK_SCORES_ORDER                          `mock-scores/` is documented
 *     `held_on` ascending, a guarantee, so `useMockScores` no longer re-sorts.
 *   QUESTION_PROVENANCE                        `TestPaper.source` says where a
 *     paper came from (official past paper, the institute's own, ours, or
 *     generated). The Papers screen labels every paper by it and "Data & trust"
 *     counts the official ones from `usePapers()`; `importRecords.ts` keeps only
 *     what no route reports (syllabus chapter counts, the cross-check's
 *     agreement figures).
 *
 * Still open below, though the contract now carries what would close them —
 * `counter_evidence_questions`, `tally` and `student_ref` on the diagnosis.
 * Their compensations live in `lib/explainer.ts`, which the console round did
 * not own; deleting each entry means deleting its compensation with it.
 */

export const API_GAPS = {
  /**
   * `human_verdict` is declared a plain `string`, but the server's third value
   * is the literal `"unreviewed"` and that enum is not in the schema.
   * `api/diagnosis.ts` normalises it to `null`; a client that trusts the type
   * tells a teacher who never answered that they disagreed.
   */
  DIAGNOSIS_VERDICT_UNREVIEWED:
    'Diagnosis.human_verdict is typed `string` and carries an undeclared "unreviewed"',
  /**
   * `DiagnosisHypothesis.counter_evidence` is a sentence. The questions it
   * names — the ones the student got *right*, which is the whole argument —
   * come back with no `question_id`, so the line that sells the product is the
   * one line on the card that cannot open the question behind it. The "How it
   * works" page looks the named labels up in the student's answer sheet
   * (`lib/explainer.ts: labelsNamedIn`) to show their recorded status; a
   * resolved `counter_evidence_questions: DiagnosisEvidence[]` would replace it.
   */
  COUNTER_EVIDENCE_UNRESOLVED:
    "DiagnosisHypothesis.counter_evidence names questions in prose and resolves none of them",
  /**
   * The server counts which tagged wrong options each student chose
   * (`marks_lost_by_pattern`, `totals.wrong_with_known_cause` in the reasoning
   * payload) before the model is called. No route returns that count, so step
   * 2 of "How it works" — "we count, exactly" — recounts over the answers the
   * diagnosis cites, one `GET /api/questions/{id}/` each, rather than over every
   * wrong answer on the paper.
   */
  DISTRACTOR_TALLY_NOT_EXPOSED:
    "No route returns the per-student tally of tagged wrong options the model is given",
  /**
   * The pseudonym the model saw (`student_ref`, `"S-{id}"`) is not echoed on
   * the `Diagnosis` response, so "Data & trust" restates the server's rule in
   * `lib/explainer.ts: pseudonymFor` rather than reading it.
   */
  STUDENT_REF_NOT_EXPOSED: "Diagnosis does not echo the student_ref the model was sent",
} as const;

export type ApiGap = keyof typeof API_GAPS;
