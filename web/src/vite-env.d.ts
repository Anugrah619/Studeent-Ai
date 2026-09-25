/// <reference types="vite/client" />

/**
 * Every key here must also appear in the `define` block of
 * `scripts/run-tests.mjs`. The test bundle is built by esbuild, which
 * substitutes these by exact text match; a key that is read but not defined
 * survives into the output as a literal `import.meta.env.X`, and `import.meta`
 * has no `env` under plain Node — so the suite throws on import rather than
 * failing an assertion.
 */
interface ImportMetaEnv {
  /** "false" talks to a real Django server instead of MSW fixtures. */
  readonly VITE_USE_MOCKS?: string;
  /** The name the console shipped with. Honoured; `VITE_USE_MOCKS` wins. */
  readonly VITE_API_MOCK?: string;
  /**
   * Origin of the API. Empty (the default) means same origin, which in dev is
   * the Vite proxy in `vite.config.ts`. Set it only to bypass that proxy.
   */
  readonly VITE_API_BASE?: string;
  /** Dev-proxy target. Read by `vite.config.ts`, not by the app. */
  readonly VITE_API_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
