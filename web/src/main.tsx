import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

/**
 * The console runs entirely on fixtures unless `VITE_API_MOCK=false`. That is
 * the default on purpose: `npm run dev` must work with no Django server up, and
 * a demo must never depend on one being reachable.
 *
 * The import is dynamic so MSW and every fixture land in their own chunk rather
 * than the main bundle.
 */
const MOCKING_ENABLED = import.meta.env.VITE_API_MOCK !== "false";

async function bootstrap() {
  if (MOCKING_ENABLED) {
    const { startMocks } = await import("./mocks/browser");
    await startMocks();
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
