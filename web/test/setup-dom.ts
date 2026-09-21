import { installDom } from "./dom";

/**
 * Side-effect module, loaded through `node --import` so the DOM globals exist
 * before React, Radix or any app module is evaluated. Radix's
 * `use-layout-effect` in particular decides once, at module load, whether
 * `globalThis.document` exists — get the order wrong and every portal renders
 * as null with no error.
 */
installDom();

/**
 * Query results land outside `act` by design — the tests poll the DOM the way a
 * user would rather than driving React's scheduler. Drop that one warning so a
 * real console error is still visible in the output.
 */
const realError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("not wrapped in act")) return;
  realError(...args);
};
