/**
 * The two switches that decide who the console is talking to.
 *
 * Every read below is a *literal* `import.meta.env.X` access rather than a
 * destructure or an object spread. That is deliberate: Vite and the esbuild
 * test harness both substitute these by exact text match, and
 * `import.meta.env` does not exist as an object at all under plain Node — so
 * `const e = import.meta.env` would compile fine and then throw in the suite.
 * Add a key here and you must add it to the `define` block in
 * `scripts/run-tests.mjs` too.
 */

/**
 * `VITE_USE_MOCKS` is the flag. `VITE_API_MOCK` is the name the console
 * shipped with; it is still honoured so existing `.env` files keep working,
 * and the new name wins when both are set.
 *
 * Mocks are the default on purpose: `npm run dev` must work with no Django
 * server up, and a demo must never depend on one being reachable.
 */
const RAW_MOCKS =
  import.meta.env.VITE_USE_MOCKS ?? import.meta.env.VITE_API_MOCK;

/**
 * Where the API lives. Empty means same origin, which is what the Vite dev
 * proxy gives us — and same origin is the configuration that makes session
 * cookies and CSRF work without arguing with the browser. Set it only to
 * bypass the proxy.
 */
const RAW_BASE = import.meta.env.VITE_API_BASE;

function truthy(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  return !(raw === "false" || raw === "0" || raw === "off" || raw === "no");
}

export const USE_MOCKS = truthy(RAW_MOCKS, true);

/** Normalised with no trailing slash, so `${API_BASE}/api/...` is always right. */
export const API_BASE = (RAW_BASE ?? "").replace(/\/+$/, "");
