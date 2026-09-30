/**
 * Two response shapes, one unwrapper.
 *
 * THE PROBLEM THIS SOLVES — read this before changing anything here.
 *
 * DRF is configured with `PageNumberPagination` and `PAGE_SIZE 50`
 * (`config/settings.py`). Router list routes therefore return an envelope:
 *
 *     { count, next, previous, results: [...] }
 *
 * The four `@action` detail routes — `mock_scores`, `subject_breakdown`,
 * `topic_states`, `attempts` — used to answer with a **bare array**: they
 * built their rows by hand, returned `Response(Serializer(rows,
 * many=True).data)`, and never called `paginate_queryset`. `openapi.yaml`
 * disagreed, because drf-spectacular sees a list-shaped `@action` on a
 * paginated viewset and assumes the pagination applies. The generated types
 * inherited the lie, and code that trusted them read `.results` off an array
 * and got `undefined`.
 *
 * VERIFIED AGAINST A RUNNING SERVER: all four now return the envelope.
 * `GET /api/students/1/topic-states/` answers `{count: 56, next: null,
 * results: [56 rows]}` — one page, no `next`, `count === results.length`. The
 * contract and the server agree, and the disagreement this file was written
 * for is closed.
 *
 * **Both branches stay anyway**, and not out of caution. The cost of keeping
 * them is one `Array.isArray` per list response. The cost of being wrong is a
 * panel that renders empty against whichever of the two shapes the client did
 * not expect — and this file has now watched that expectation flip once
 * already. An assumption that has been wrong in both directions is not one to
 * hard-code on the third pass.
 */
import type { Paginated } from "./types";

/** A DRF page envelope, as opposed to a bare array or a single object. */
export function isPaginated<T>(payload: unknown): payload is Paginated<T> {
  return (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    Array.isArray((payload as { results?: unknown }).results)
  );
}

/**
 * The rows, from an envelope, a bare array, or nothing at all.
 *
 * `null`/`undefined` collapse to `[]` rather than throwing: an endpoint that
 * legitimately has nothing to say — RLS returning empty for a caller bound to
 * no institute — must render an empty state, not a crash.
 */
export function rowsOf<T>(payload: Paginated<T> | T[] | null | undefined): T[] {
  if (payload == null) return [];
  if (Array.isArray(payload)) return payload;
  if (isPaginated<T>(payload)) return payload.results;
  return [];
}

/** The same payload normalised to an envelope, for callers that want `count`. */
export function pageOf<T>(
  payload: Paginated<T> | T[] | null | undefined,
): Paginated<T> {
  if (isPaginated<T>(payload)) return payload;
  const results = rowsOf(payload);
  return { count: results.length, next: null, previous: null, results };
}

/**
 * The `?page=` number a DRF `next`/`previous` URL points at.
 *
 * The link is followed by page number rather than by fetching the absolute URL
 * DRF hands back, because that URL is built from `request.build_absolute_uri()`
 * — behind the dev proxy it comes back as `http://127.0.0.1:8000/...`, which is
 * the origin the *proxy* talked to, not the one the browser is allowed to send
 * credentials to. Following it literally would drop the session cookie.
 */
export function nextPageNumber(next: string | null | undefined): number | null {
  if (!next) return null;
  try {
    // A relative `next` needs a base to parse against; the value is thrown away.
    const url = new URL(next, "http://localhost");
    const page = Number(url.searchParams.get("page"));
    return Number.isInteger(page) && page > 1 ? page : null;
  } catch {
    return null;
  }
}
