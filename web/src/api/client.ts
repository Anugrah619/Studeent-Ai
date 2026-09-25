/**
 * A typed fetch wrapper whose path list, path params, query params and
 * response bodies are all inferred from the generated `paths` type. Calling an
 * endpoint that isn't in `openapi.yaml`, or forgetting a required param, is a
 * compile error.
 *
 * Beyond the types it carries the three things a real Django session API needs
 * and a mock server never asked for: cookies on every request, a CSRF token on
 * every unsafe one, and an unwrapper that survives the fact that DRF paginates
 * some list routes and not others. See `pagination.ts` for that last one — it
 * is the single most likely thing to break on first contact with the backend.
 */
import { API_BASE } from "./env";
import { nextPageNumber, rowsOf } from "./pagination";
import type { paths } from "./schema";

export { API_BASE };

/* ------------------------------------------------------------------ *
 * Type plumbing over the generated `paths`
 * ------------------------------------------------------------------ */

type HasVerb<P extends keyof paths, V extends string> = paths[P] extends Record<
  V,
  object
>
  ? P
  : never;

export type GetPath = { [P in keyof paths]: HasVerb<P, "get"> }[keyof paths];
export type PostPath = { [P in keyof paths]: HasVerb<P, "post"> }[keyof paths];

type Op<P extends keyof paths, V extends string> = paths[P] extends Record<V, infer O>
  ? O
  : never;

type OkBody<O> = O extends {
  responses: { 200: { content: { "application/json": infer T } } };
}
  ? T
  : O extends { responses: { 201: { content: { "application/json": infer T } } } }
    ? T
    : never;

type ReqBody<O> = O extends {
  requestBody: { content: { "application/json": infer T } };
}
  ? T
  : O extends { requestBody?: { content: { "application/json": infer T } } }
    ? T | undefined
    : undefined;

type PathParams<O> = O extends { parameters: { path: infer T } }
  ? T extends object
    ? T
    : never
  : never;

type QueryParams<O> = O extends { parameters: { query?: infer T } }
  ? T extends object
    ? T
    : never
  : never;

/** True when the operation declares `query` as required rather than optional. */
type QueryRequired<O> = O extends { parameters: { query: object } } ? true : false;

/** `never` params collapse away so callers only pass what the endpoint declares. */
type ArgsFor<O> = ([PathParams<O>] extends [never]
  ? { path?: undefined }
  : { path: PathParams<O> }) &
  ([QueryParams<O>] extends [never]
    ? { query?: undefined }
    : QueryRequired<O> extends true
      ? { query: QueryParams<O> }
      : { query?: QueryParams<O> }) & {
    /**
     * Escape hatch for query params the server honours but `openapi.yaml` does
     * not declare. Every use is a contract gap — see `src/api/gaps.ts`.
     */
    undocumentedQuery?: Record<string, string | number | boolean | undefined>;
    signal?: AbortSignal;
  };

/** The args object itself is only mandatory when something in it is. */
type ArgsRequired<O> = [PathParams<O>] extends [never] ? QueryRequired<O> : true;

export type GetResult<P extends GetPath> = OkBody<Op<P, "get">>;
export type PostResult<P extends PostPath> = OkBody<Op<P, "post">>;
export type PostBody<P extends PostPath> = ReqBody<Op<P, "post">>;

/**
 * One row of a list response, whichever shape the server chose. The contract
 * claims an envelope for every list route; four of them actually return a bare
 * array, so both branches are real.
 */
export type RowOf<R> = R extends { results: (infer T)[] }
  ? T
  : R extends readonly (infer T)[]
    ? T
    : never;

export type ListRow<P extends GetPath> = RowOf<GetResult<P>>;

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

/**
 * DRF speaks in three error shapes: `{detail}`, `{field: [messages]}` and a
 * bare string. A login form that renders `[object Object]` at a buyer is worse
 * than one that renders nothing, so all three are flattened here rather than at
 * each call site.
 */
function messageFor(status: number, url: string, body: unknown): string {
  if (typeof body === "string" && body.trim()) return body;
  if (body && typeof body === "object") {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    const fields = Object.entries(body as Record<string, unknown>)
      .map(([key, value]) =>
        Array.isArray(value) ? `${key}: ${value.join(" ")}` : null,
      )
      .filter(Boolean);
    if (fields.length) return fields.join(" · ");
  }
  return `${status} on ${url}`;
}

export class ApiError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: unknown;

  constructor(status: number, url: string, body: unknown) {
    super(messageFor(status, url, body));
    this.name = "ApiError";
    this.status = status;
    this.url = url;
    this.body = body;
  }

  /** 401/403 from a session API means "log in again", not "this panel broke". */
  get isAuthFailure(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/* ------------------------------------------------------------------ *
 * Session + CSRF
 *
 * Django's `CsrfViewMiddleware` is active, so every unsafe request needs the
 * `csrftoken` cookie AND the matching `X-CSRFToken` header. A browser that has
 * never spoken to the API has neither, hence `/api/auth/csrf/`.
 *
 * `login()` rotates the token along with the session key, so the value is
 * re-read from the cookie before every unsafe request rather than cached —
 * a cached pre-login token fails the next POST with a 403 that reads like a
 * permissions bug.
 * ------------------------------------------------------------------ */

const CSRF_COOKIE = "csrftoken";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** In flight, so a burst of mutations triggers one priming request, not five. */
let csrfPriming: Promise<string | null> | null = null;

/**
 * The CSRF token, priming the cookie first if the browser does not have one.
 *
 * Returns `null` rather than throwing when priming fails. The request then goes
 * out without the header and Django answers 403 — which is the honest outcome,
 * and a far more legible failure than a client-side exception with no HTTP
 * exchange behind it.
 */
export async function ensureCsrfToken(): Promise<string | null> {
  const existing = readCookie(CSRF_COOKIE);
  if (existing) return existing;

  csrfPriming ??= (async () => {
    try {
      await fetch(`${API_BASE}/api/auth/csrf/`, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
    } catch {
      // Network down. Fall through; the caller gets a real HTTP error next.
    }
    return readCookie(CSRF_COOKIE);
  })().finally(() => {
    csrfPriming = null;
  });

  return csrfPriming;
}

/* ------------------------------------------------------------------ *
 * Runtime
 * ------------------------------------------------------------------ */

type AnyArgs = {
  path?: Record<string, string | number>;
  query?: Record<string, unknown>;
  undocumentedQuery?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
};

function buildUrl(template: string, args: AnyArgs | undefined): string {
  const filled = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = args?.path?.[key];
    if (value === undefined) {
      throw new Error(`Missing path param "${key}" for ${template}`);
    }
    return encodeURIComponent(String(value));
  });

  const search = new URLSearchParams();
  for (const source of [args?.query, args?.undocumentedQuery]) {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (value !== undefined && value !== null && value !== "") {
        search.append(key, String(value));
      }
    }
  }
  const qs = search.toString();
  return `${API_BASE}${filled}${qs ? `?${qs}` : ""}`;
}

async function request<T>(
  url: string,
  init: RequestInit & { method: string; signal?: AbortSignal },
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };

  if (!SAFE_METHODS.has(init.method.toUpperCase())) {
    const token = await ensureCsrfToken();
    if (token) headers["X-CSRFToken"] = token;
  }

  const response = await fetch(url, {
    // `include`, not `same-origin`: the dev proxy keeps us same-origin in the
    // normal case, but a direct `VITE_API_BASE` is cross-origin and Django is
    // configured for exactly that (`CORS_ALLOW_CREDENTIALS = True`).
    ...init,
    credentials: "include",
    headers,
  });

  // 204, and any other body-less success, must not go through `.json()`.
  const payload: unknown =
    response.status === 204 || response.headers.get("content-length") === "0"
      ? null
      : await response.json().catch(() => null);

  if (!response.ok) throw new ApiError(response.status, url, payload);
  return payload as T;
}

export function apiGet<P extends GetPath>(
  path: P,
  ...[args]: ArgsRequired<Op<P, "get">> extends true
    ? [args: ArgsFor<Op<P, "get">>]
    : [args?: ArgsFor<Op<P, "get">>]
): Promise<GetResult<P>> {
  const a = args as AnyArgs | undefined;
  return request<GetResult<P>>(buildUrl(path as string, a), {
    method: "GET",
    signal: a?.signal,
  });
}

/** How many pages one list call will follow before it gives up and says so. */
export const MAX_PAGES = 20;

/**
 * A list endpoint, unwrapped to rows, following `next` to the end.
 *
 * Both halves of that matter. The unwrapping is what survives the four
 * `@action` routes that return bare arrays; the following is what survives
 * `PAGE_SIZE 50` — an institute with 60 open flags would otherwise show 50 and
 * a triage count that quietly disagrees with the dashboard, which is the worst
 * class of bug this console can have: wrong, and confident.
 */
export async function apiGetRows<P extends GetPath>(
  path: P,
  ...[args]: ArgsRequired<Op<P, "get">> extends true
    ? [args: ArgsFor<Op<P, "get">>]
    : [args?: ArgsFor<Op<P, "get">>]
): Promise<ListRow<P>[]> {
  const a = (args ?? {}) as AnyArgs;
  const first = await request<unknown>(buildUrl(path as string, a), {
    method: "GET",
    signal: a.signal,
  });

  const rows = rowsOf<ListRow<P>>(
    first as ListRow<P>[] | { count: number; results: ListRow<P>[] },
  );

  let next = nextPageNumber((first as { next?: string | null })?.next);
  let guard = 0;
  while (next !== null && guard < MAX_PAGES) {
    guard += 1;
    const page = await request<unknown>(
      buildUrl(path as string, {
        ...a,
        undocumentedQuery: { ...a.undocumentedQuery, page: next },
      }),
      { method: "GET", signal: a.signal },
    );
    rows.push(...rowsOf<ListRow<P>>(page as ListRow<P>[]));
    next = nextPageNumber((page as { next?: string | null })?.next);
  }

  if (next !== null) {
    console.warn(
      `[api] ${String(path)} still had pages after ${MAX_PAGES}; list truncated.`,
    );
  }
  return rows;
}

export function apiPost<P extends PostPath>(
  path: P,
  args: ArgsFor<Op<P, "post">> & { body?: PostBody<P> },
): Promise<PostResult<P>> {
  const a = args as AnyArgs & { body?: unknown };
  return request<PostResult<P>>(buildUrl(path as string, a), {
    method: "POST",
    signal: a.signal,
    headers:
      a.body === undefined ? {} : { "Content-Type": "application/json" },
    body: a.body === undefined ? undefined : JSON.stringify(a.body),
  });
}

/* ------------------------------------------------------------------ *
 * Ahead of the contract
 *
 * `apiGet`/`apiPost` will not compile against a path `openapi.yaml` has never
 * heard of — which is the point of them, and a problem exactly twice: the two
 * reasoning-layer routes shipped in the API before the spec caught up.
 *
 * These two escape hatches take the path as a plain string and the response
 * shape from the caller, so the types are a hand-written promise rather than a
 * generated fact. Everything else — cookies, CSRF, the `ApiError` flattening —
 * is the same code path the generated calls use, so nothing about session
 * handling is special-cased for them.
 *
 * Every call site is listed in `src/api/gaps.ts`. When the routes land in the
 * contract, delete the entry, switch the call to `apiGet`/`apiPost`, and the
 * hand-written types in `api/diagnosis.ts` become generated ones.
 * ------------------------------------------------------------------ */

export interface AheadArgs {
  path?: Record<string, string | number>;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

export function apiGetAhead<T>(template: string, args?: AheadArgs): Promise<T> {
  return request<T>(buildUrl(template, args), {
    method: "GET",
    signal: args?.signal,
  });
}

export function apiPostAhead<T>(
  template: string,
  args: AheadArgs & { body?: unknown },
): Promise<T> {
  return request<T>(buildUrl(template, args), {
    method: "POST",
    signal: args.signal,
    headers: args.body === undefined ? {} : { "Content-Type": "application/json" },
    body: args.body === undefined ? undefined : JSON.stringify(args.body),
  });
}
