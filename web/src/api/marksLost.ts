/**
 * One correction, applied where the marks-lost row enters the client.
 *
 * `apiGet` types this route from the generated `paths`, and this worktree's
 * `openapi.yaml` predates the three fields the response now carries
 * ({@link API_GAPS.MARKS_LOST_FIFTH_CAUSE}). Rather than cast the row and hope,
 * it is widened here, once, in the only place that has to know.
 *
 * Note what is *not* filled in. `recoverable_pct` passes straight through and
 * defaults to `null` — it is never computed. The server divides `recoverable`
 * by `attributed_lost`; the old client divided by `total_lost`, which is how
 * "61 of the 90 we can explain (68%)" came out as "37% of your marks". A
 * client that recomputes the field cannot be wrong in a way anyone notices,
 * which is precisely why it must not. A server too old to send it gets no
 * percentage shown, which is the honest outcome.
 */
import type { MarksLost } from "./types";

/** The generated row: everything except the three fields added since. */
type StaleMarksLost = Omit<
  MarksLost,
  "insufficient_evidence" | "attributed_lost" | "recoverable_pct" | "causes"
> &
  Partial<Pick<MarksLost, "insufficient_evidence" | "attributed_lost" | "recoverable_pct">> & {
    causes: { cause: string; marks: number; questions: number; share_pct: number }[];
  };

export function coerceMarksLost(row: StaleMarksLost): MarksLost {
  // A server that predates the split attributed everything, which is exactly
  // what `insufficient_evidence: 0` means — so the old numbers stay right.
  const insufficient = row.insufficient_evidence ?? 0;
  return {
    ...row,
    causes: row.causes as MarksLost["causes"],
    insufficient_evidence: insufficient,
    attributed_lost: row.attributed_lost ?? row.total_lost - insufficient,
    recoverable_pct: row.recoverable_pct ?? null,
  };
}
