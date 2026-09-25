/**
 * Every type in this file is an alias into `schema.d.ts`, which is generated
 * from `../../openapi.yaml` by `npm run gen:api`. Nothing here is hand-written —
 * if a shape is wrong, fix the contract and regenerate.
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
export type MarksLost = S["MarksLost"];
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
export type TopicState = S["TopicState"];

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
