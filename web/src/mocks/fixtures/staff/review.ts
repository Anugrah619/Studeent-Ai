import type { KeyDisagreement, KeyReviewDecision } from "@/api/types";
import { REVIEW_ITEMS } from "./reviewItems";

/**
 * The answer-key review queue, as a store the review POST can change. Starts
 * as the live server's own rows (every one unreviewed, as on the server today).
 */
let items: KeyDisagreement[] = clone();

function clone(): KeyDisagreement[] {
  return JSON.parse(JSON.stringify(REVIEW_ITEMS));
}

export function resetReview() {
  items = clone();
}

const VERIFICATION: Record<KeyReviewDecision, KeyDisagreement["verification"]> = {
  key_stands: "key_stands",
  key_wrong: "key_wrong",
  unclear: "key_unclear",
};

/** `?status=` as the server reads it: unreviewed, reviewed, one decision, or all. */
export function disagreements(status: string | null): KeyDisagreement[] {
  return items.filter((item) => {
    if (status === "unreviewed") return item.review.status === "unreviewed";
    if (status === "reviewed") return item.review.status !== "unreviewed";
    if (status === "key_stands" || status === "key_wrong" || status === "unclear") {
      return item.review.status === status;
    }
    return true;
  });
}

export function decide(
  questionPk: number,
  decision: unknown,
  note: unknown,
  reviewer: string,
):
  | { status: 200; body: KeyDisagreement }
  | { status: 400; body: Record<string, string[]> }
  | { status: 404; body: { detail: string } } {
  const item = items.find((i) => i.id === questionPk);
  if (!item) {
    return { status: 404, body: { detail: "No disagreement to review for that question." } };
  }
  if (decision !== "key_stands" && decision !== "key_wrong" && decision !== "unclear") {
    return { status: 400, body: { decision: [`"${String(decision)}" is not a valid choice.`] } };
  }
  item.review = {
    status: decision,
    note: typeof note === "string" ? note : "",
    reviewed_by: reviewer,
    reviewed_at: new Date().toISOString(),
  };
  item.verification = VERIFICATION[decision];
  return { status: 200, body: item };
}
