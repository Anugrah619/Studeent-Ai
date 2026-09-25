/**
 * Smoke tests run through esbuild rather than a test framework: the suite is
 * one file, and bundling is what gives Node the TSX, the `@/` alias and the ESM
 * interop without adding Vitest and its plugin chain to the project.
 *
 * The DOM setup is built as a SEPARATE bundle and passed to `node --import`.
 * It cannot live inside the suite: ESM hoists every external import above the
 * module body, so Radix's `use-layout-effect` module — which decides once, at
 * load time, whether `globalThis.document` exists — would bind to a no-op and
 * silently render every portal as null.
 */
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync, rmSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outdir = resolve(root, "node_modules/.tmp/test");

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const entry = process.argv[2] ?? "test/smoke.test.tsx";
const suiteFile = resolve(outdir, "suite.test.mjs");
const setupFile = resolve(outdir, "setup.mjs");

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  jsx: "automatic",
  sourcemap: "inline",
  logLevel: "warning",
  // Bundle only our own source; every dependency stays a real Node import.
  packages: "external",
  alias: { "@": resolve(root, "src") },
  define: {
    // Keep in step with `src/vite-env.d.ts`. esbuild substitutes these by exact
    // text, so a key the app reads and this block omits survives into the
    // bundle as a literal `import.meta.env.X` — and `import.meta` has no `env`
    // under plain Node, so the suite throws on import rather than failing an
    // assertion, which reads like a broken module and not a missing define.
    "import.meta.env.VITE_USE_MOCKS": '"true"',
    "import.meta.env.VITE_API_MOCK": '"true"',
    "import.meta.env.VITE_API_BASE": '""',
    "import.meta.env.BASE_URL": '"/"',
    "import.meta.env.DEV": "false",
    "import.meta.env.PROD": "true",
    "import.meta.env.MODE": '"test"',
  },
};

await build({
  ...common,
  entryPoints: [resolve(root, "test/setup-dom.ts")],
  outfile: setupFile,
});

await build({
  ...common,
  entryPoints: [resolve(root, entry)],
  outfile: suiteFile,
});

const result = spawnSync(
  process.execPath,
  [
    "--import",
    pathToFileURL(setupFile).href,
    "--test",
    "--test-force-exit",
    suiteFile,
  ],
  { stdio: "inherit", cwd: root },
);

process.exit(result.status ?? 1);
