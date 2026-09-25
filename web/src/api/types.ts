/**
 * Every type in this file is an alias into `schema.d.ts`, which is generated
 * from `../../openapi.yaml` by `npm run gen:api`. Nothing here is hand-written —
 * if a shape is wrong, fix the contract and regenerate.
 *
 * The one exception is the "ahead of the contract" block at the bottom, which
 * exists only while this worktree's `openapi.yaml` is a version behind.
 */
import type { components } from "./schema";

type S = components["schemas"];

export type Attempt = S["Attempt"];
export type Batch = S["Batch"];
export type DashboardSummary = S["DashboardSummary"];
export type Flag = S["Flag"];
export type Institute = S["Institute"];
export type Intervention = S["Intervention"];
export type InterventionRequest = S["InterventionRequest"];
export type LoginRequest = S["LoginRequest"];
export type Me = S["Me"];
export type Mentor = S["Mentor"];
export type MockScore = S["MockScore"];
export type PlanBlock = S["PlanBlock"];
export type StudentDetail = S["StudentDetail"];
export type StudentList = S["StudentList"];
export type StudentState = S["StudentState"];
export type SubjectBreakdown = S["SubjectBreakdown"];
export type TestPaper = S["TestPaper"];
export type Topic = S["Topic"];

export type Severity = S["SeverityEnum"];
export type Outcome = S["OutcomeEnum"];
export type AttemptStatus = S["StatusEnum"];
export type AttemptSource = S["SourceEnum"];
export type TopicKind = S["KindEnum"];
export type StudyMode = S["ModeEnum"];

/**
 * The DRF `PageNumberPagination` envelope.
 *
 * The contract claims this for every list route. The server only delivers it
 * from the router-generated ones — the four `@action` routes return a bare
 * array. Nothing outside `api/pagination.ts` and `api/client.ts` should care;
 * see the note at the top of `pagination.ts` for why.
 */
export interface Paginated<T> {
  count: number;
  next?: string | null;
  previous?: string | null;
  results: T[];
}

/* ------------------------------------------------------------------ *
 * Ahead of the contract
 *
 * The three types below are generated ones with a correction applied on top,
 * because the API changed after this worktree's `openapi.yaml` was generated
 * and regenerating mid-task would drag in an unrelated, half-landed spec. Same
 * discipline as `api/diagnosis.ts`: each override is narrow, each is named in
 * `api/gaps.ts`, and each is written so that regenerating *deletes* it rather
 * than silently disagreeing with it.
 *
 * `MarksLost` is the one place in this client where being a version behind is
 * not a typing inconvenience but a wrong number in front of a buyer:
 * `recoverable` no longer means what its old denominator assumed.
 * ------------------------------------------------------------------ */

/**
 * The taxonomy gained a fifth member.
 *
 * It is not a fifth *cause* in the sense the other four are. The four say what
 * went wrong; this one says the engine will not guess. `lib/causes.ts` carries
 * that distinction all the way to the pixels.
 */
export type CauseName = S["CauseEnum"] | "insufficient_evidence";

export type MarksLostCause = Omit<S["MarksLostCause"], "cause"> & {
  cause: CauseName;
};

export type MarksLost = Omit<S["MarksLost"], "causes"> & {
  causes: MarksLostCause[];
  /**
   * Marks the engine declines to attribute, because the student has barely
   * attempted those chapters. Counted in `total_lost`, excluded from
   * `attributed_lost`.
   */
  insufficient_evidence: number;
  /** `total_lost` minus `insufficient_evidence` — the loss we can explain. */
  attributed_lost: number;
  /**
   * `recoverable` as a share of `attributed_lost`, **not** of `total_lost`.
   * Null when nothing is attributed. Always read from the server: recomputing
   * it locally is exactly the bug this field exists to prevent.
   */
  recoverable_pct: number | null;
};

/** `accuracy_30d` left the contract, so nothing may bind to it. */
export type TopicState = Omit<S["TopicState"], "accuracy_30d">;
