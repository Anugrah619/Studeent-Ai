"""Pagination classes — and the reason every list-shaped route uses one.

Before this module the project had two list shapes. Router routes
(`/api/students/`, `/api/flags/`, …) went through DRF's configured
`PageNumberPagination` and returned `{count, next, previous, results}`.
The `@action` sub-resources on `StudentViewSet` returned a **bare array**
built by hand: `Response(Serializer(qs[:200], many=True).data)`.

That was not merely inconsistent. `openapi.yaml` declared *all* of them
as paginated — drf-spectacular sees a `many=True` response on a view
that has a paginator and writes `PaginatedTopicStateList` plus a `page`
query parameter — so the generated TypeScript client already read
`page.results` from four endpoints that in fact returned a list. The
console has only ever run against MSW mocks, which were written from the
schema, so the mismatch could not surface until the first live request,
at which point `results` is `undefined` and the panel renders nothing.

The contract was right and the implementation had drifted from it, so
the implementation is what moved: every list-shaped response is now
genuinely paginated. Three things follow from that choice.

1. **No frontend change is needed.** `useTopicStates`, `useMockScores`
   and `useSubjectBreakdown` already do `select: (page) => page.results`.
2. **Two silent truncations are gone.** `topic_states` sliced at 200 and
   `attempts` at 400 with nothing in the payload to say so — and the
   attempts cap bites *today*: the seed averages ~490 attempts per
   student, so an unfiltered request quietly lost a fifth of them. A
   paginated response reports `count` honestly and offers `next`.
3. **`page_size` is now a client decision, within a ceiling.** A fixed
   server-side cap is the thing that caused the silent truncation in the
   first place; a declared, bounded parameter is the same protection
   without the lie.
"""

from rest_framework.pagination import PageNumberPagination


class StandardPagination(PageNumberPagination):
    """Collection routes: students, flags, batches, papers, study logs.

    50 matches the project's existing `PAGE_SIZE`, so no already-working
    route changes shape or default size. The addition is `?page_size=`,
    capped at 200 — high enough for a director's triage table to pull one
    institute in a single request, low enough that it cannot be used to
    ask for an institute's entire attempt history.
    """

    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200


class SubResourcePagination(PageNumberPagination):
    """One student's sub-resources: topic states, attempts, mock scores.

    A larger default (200) on purpose. These are bounded by one student's
    data rather than by the institute's, and they back charts and grids
    that are wrong when partial — a mastery grid showing 50 of 52
    chapters is worse than useless, because nothing on screen says it is
    a subset. 200 is exactly the cap `topic_states` already applied, so
    current behaviour is preserved and the envelope now reports the
    truth alongside it.
    """

    page_size = 200
    page_size_query_param = "page_size"
    max_page_size = 500
