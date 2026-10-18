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
import { mkdirSync, readdirSync, rmSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
// One directory per run, not a shared one. Two `npm test`s running at once
// used to rebuild the same two bundles under each other, and the loser failed
// on a half-written file with an error that looked like a broken test.
const outdir = resolve(
  root,
  `node_modules/.tmp/test-${process.pid}-${Date.now().toString(36)}`,
);

mkdirSync(outdir, { recursive: true });
const cleanUp = () => rmSync(outdir, { recursive: true, force: true });

// Every `test/*.test.tsx` by default, each bundled on its own, so a suite can
// be added without touching this file. Pass paths to run just those.
const entries = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(resolve(root, "test"))
      .filter((name) => name.endsWith(".test.tsx"))
      .sort()
      .map((name) => `test/${name}`);
const setupFile = resolve(outdir, "setup.mjs");
const suiteFile = (entry) =>
  resolve(outdir, entry.replace(/^.*[\\/]/, "").replace(/\.tsx?$/, ".mjs"));

/**
 * Components import their own stylesheets (KaTeX's, React Flow's). With every
 * package left external, Node would be handed `import "x.css"` and refuse the
 * extension, so a stylesheet becomes an empty module here — the smoke tests
 * read the DOM, never computed styles.
 */
const ignoreCss = {
  name: "ignore-css",
  setup(b) {
    b.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: "ignore-css" }));
    b.onLoad({ filter: /.*/, namespace: "ignore-css" }, () => ({ contents: "", loader: "js" }));
  },
};

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
  plugins: [ignoreCss],
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

try {
  await build({
    ...common,
    entryPoints: [resolve(root, "test/setup-dom.ts")],
    outfile: setupFile,
  });

  for (const entry of entries) {
    await build({
      ...common,
      entryPoints: [resolve(root, entry)],
      outfile: suiteFile(entry),
    });
  }
} catch (error) {
  cleanUp();
  throw error;
}

const result = spawnSync(
  process.execPath,
  [
    "--import",
    pathToFileURL(setupFile).href,
    "--test",
    "--test-force-exit",
    ...entries.map(suiteFile),
  ],
  { stdio: "inherit", cwd: root },
);

cleanUp();
process.exit(result.status ?? 1);
