/**
 * A ~100-line typed fetch wrapper whose path list, path params, query params and
 * response bodies are all inferred from the generated `paths` type. Calling an
 * endpoint that isn't in `openapi.yaml`, or forgetting a required param, is a
 * compile error.
 */
import type { paths } from "./schema";

export const API_BASE = "";

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

/* ------------------------------------------------------------------ *
 * Runtime
 * ------------------------------------------------------------------ */

export class ApiError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: unknown;

  constructor(status: number, url: string, body: unknown) {
    super(`${status} on ${url}`);
    this.name = "ApiError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

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
  init: RequestInit & { signal?: AbortSignal },
): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: { Accept: "application/json", ...init.headers },
  });

  const payload: unknown = response.status === 204 ? null : await response.json();
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
