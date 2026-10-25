/**
 * Every type in this file is an alias into `schema.d.ts`, which is generated
 * from `../../openapi.yaml` by `npm run gen:api`. Nothing here is hand-written —
 * if a shape is wrong, fix the contract and regenerate.
 *
 * There used to be an "ahead of the contract" block at the bottom holding a
 * corrected `MarksLost`, `MarksLostCause` and `TopicState`, because the server
 * had moved and the spec had not. It is gone. The contract now carries the
 * fifth cause bucket, `attributed_lost`, `recoverable_pct`, and a `TopicState`
 * with no `accuracy_30d` — so regenerating *deleted* the overrides rather than
 * silently disagreeing with them, which is the property they were written for.
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
export type MarksLostCause = S["MarksLostCause"];
export type Me = S["Me"];
export type Mentor = S["Mentor"];
export type MockScore = S["MockScore"];
export type PasswordChangeRequest = S["PasswordChangeRequest"];
export type PlanBlock = S["PlanBlock"];
export type StudentDetail = S["StudentDetail"];
export type StudentList = S["StudentList"];
export type StudentState = S["StudentState"];
export type SubjectBreakdown = S["SubjectBreakdown"];
export type TestPaper = S["TestPaper"];
export type Topic = S["Topic"];
export type TopicState = S["TopicState"];

export type Severity = S["SeverityEnum"];
/**
 * How a closed flag turned out. Renamed from `OutcomeEnum` in the contract, and
 * `Flag.outcome` unions it with `BlankEnum` (`""`) for a flag still open — so
 * a reader must narrow before indexing a label table by it.
 */
export type Outcome = S["FlagOutcomeEnum"];
export type ResolveOutcome = S["FlagResolveOutcomeEnum"];
export type AttemptStatus = S["StatusEnum"];
export type AttemptSource = S["SourceEnum"];
export type TopicKind = S["KindEnum"];
export type StudyMode = S["ModeEnum"];

/**
 * The mistake taxonomy, now five members.
 *
 * The fifth is not a cause in the sense the other four are. They say what went
 * wrong; `insufficient_evidence` says the engine will not guess, because the
 * chapter sits below the four-attempt evidence floor. `lib/causes.ts` carries
 * that distinction all the way to the pixels.
 */
export type CauseName = S["CauseEnum"];

/* ------------------------------------------------------------------ *
 * The reasoning layer
 *
 * Generated, as of the 27-endpoint contract. These were hand-written in
 * `api/diagnosis.ts` while the routes were live but unspecified; they are
 * ordinary aliases now.
 * ------------------------------------------------------------------ */

export type Diagnosis = S["Diagnosis"];
export type DiagnosisEvidence = S["DiagnosisEvidence"];
export type DiagnosisHypothesis = S["DiagnosisHypothesis"];
export type QuestionDetail = S["QuestionDetail"];
export type QuestionOption = S["QuestionOption"];
export type Misconception = S["Misconception"];
export type DiagnosisVerdictRequest = S["DiagnosisVerdictRequest"];
export type Confidence = S["ConfidenceEnum"];
export type Verdict = S["VerdictEnum"];
export type TimeToFix = S["TimeToFixEnum"];

/* ------------------------------------------------------------------ *
 * The student app — `/api/my/…`
 * ------------------------------------------------------------------ */

export type MyProfile = S["MyProfile"];
export type MyProgress = S["MyProgress"];
export type Onboarding = S["Onboarding"];
export type OnboardingUpdateRequest = S["OnboardingUpdateRequest"];
export type MyTopic = S["MyTopic"];
export type MyAttempt = S["MyAttempt"];
export type MyQuestion = S["MyQuestion"];
export type MyQuestionOption = S["MyQuestionOption"];
export type MyRevision = S["MyRevision"];
export type MockScoreSubject = S["MockScoreSubject"];
export type StudyLogCreate = S["StudyLogCreate"];
export type StudyLogCreateRequest = S["StudyLogCreateRequest"];
export type ConfidenceRating = S["ConfidenceRating"];
export type ConfidenceRatingRequest = S["ConfidenceRatingRequest"];
export type PlanGeneration = S["PlanGeneration"];
export type PlanGenerateRequest = S["PlanGenerateRequestRequest"];
export type PlanExplain = S["PlanExplain"];
export type Guidance = S["Guidance"];
export type NextAction = S["NextAction"];
export type NextActionKind = S["GuidanceActionKindEnum"];
export type Finding = S["Finding"];
export type FindingQuestion = S["FindingQuestion"];
export type AskRequest = S["AskRequest"];
export type AskAnswer = S["AskAnswer"];

/* ------------------------------------------------------------------ *
 * Staff tools — logins, papers and uploads, tagging, answer-key review,
 * and the student's own activity as a mentor reads it. Hooks: `api/staff.ts`.
 * ------------------------------------------------------------------ */

export type LoginStatus = S["LoginStatusEnum"];
export type StudentCredential = S["StudentCredential"];
export type PaperSource = S["PaperSourceEnum"];
export type TestPaperCreateRequest = S["TestPaperCreateRequest"];
export type BlueprintReport = S["BlueprintReport"];
export type ResultsReport = S["ResultsReport"];
export type IngestRowError = S["IngestRowError"];
export type IngestBatch = S["IngestBatch"];
export type ColumnMappingProfile = S["ColumnMappingProfile"];
export type ColumnMappingField = ColumnMappingProfile["mapping"][string];
export type PaperQuestions = S["PaperQuestions"];
export type PaperQuestionsSummary = S["PaperQuestionsSummary"];
export type TaggableQuestion = S["TaggableQuestion"];
export type TaggableOption = S["TaggableOption"];
export type MisconceptionRef = S["MisconceptionRef"];
export type DraftMisconception = S["DraftMisconception"];
export type QuestionContentUpdate = S["PatchedQuestionContentUpdateRequest"];
export type OptionContentUpdate = S["OptionContentUpdateRequest"];
export type Verification = S["VerificationEnum"];
export type KeyDisagreement = S["KeyDisagreement"];
export type KeyReview = S["KeyReview"];
export type KeyReviewDecision = S["KeyReviewDecisionEnum"];
export type KeyReviewStatus = S["KeyReviewStatusEnum"];
export type DisagreementReviewRequest = S["DisagreementReviewRequest"];
export type StudyLog = S["StudyLogCreate"];
export type Revision = S["MyRevision"];

/**
 * The DRF `PageNumberPagination` envelope.
 *
 * Every list route the console reads now delivers this, including the four
 * `@action` detail routes that once returned bare arrays. Nothing outside
 * `api/pagination.ts` and `api/client.ts` should care which — see the note at
 * the top of `pagination.ts` for why both are still accepted.
 */
export interface Paginated<T> {
  count: number;
  next?: string | null;
  previous?: string | null;
  results: T[];
}
