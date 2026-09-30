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
 */

export const API_GAPS = {
  /**
   * `mock-scores/` is ordered by `held_on` in the view, but the contract does
   * not promise it and the trend chart's whole meaning is the order of its
   * points. The hook sorts rather than trusts.
   */
  MOCK_SCORES_ORDER: "GET mock-scores/ does not guarantee held_on ordering",
  /**
   * `human_verdict` is declared a plain `string`, but the server's third value
   * is the literal `"unreviewed"` and that enum is not in the schema.
   * `api/diagnosis.ts` normalises it to `null`; a client that trusts the type
   * tells a teacher who never answered that they disagreed.
   */
  DIAGNOSIS_VERDICT_UNREVIEWED:
    'Diagnosis.human_verdict is typed `string` and carries an undeclared "unreviewed"',
} as const;

export type ApiGap = keyof typeof API_GAPS;
