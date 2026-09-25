import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { API_BASE, USE_MOCKS } from "./api/env";
import "./index.css";

/**
 * The console runs entirely on fixtures unless `VITE_USE_MOCKS=false`. That is
 * the default on purpose: `npm run dev` must work with no Django server up, and
 * a demo must never depend on one being reachable.
 *
 * With mocks off it talks to the real Django API — same origin by default, via
 * the Vite dev proxy configured in `vite.config.ts`, which is what keeps the
 * session cookie and the CSRF token working without arguing with the browser
 * about cross-site cookies.
 *
 * The MSW import is dynamic so it and every fixture land in their own chunk
 * rather than in the main bundle.
 */
async function bootstrap() {
  if (USE_MOCKS) {
    const { startMocks } = await import("./mocks/browser");
    await startMocks();
  } else if (import.meta.env.DEV) {
    console.info(
      `[api] live mode — talking to ${API_BASE || "this origin (dev proxy → Django)"}`,
    );
  }

  const container = document.getElementById("root");
  if (!container) throw new Error("#root is missing from index.html");

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
