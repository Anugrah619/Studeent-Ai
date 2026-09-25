import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Port 5173 is not arbitrary: it is what Django's `CORS_ALLOWED_ORIGINS`
 * defaults to (`config/settings.py`), alongside `http://127.0.0.1:5173`.
 * Changing it means changing that list too.
 */
const PORT = 5173;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(import.meta.dirname), "");
  const live = env.VITE_USE_MOCKS === "false" || env.VITE_API_MOCK === "false";
  const target = env.VITE_API_PROXY || "http://127.0.0.1:8000";

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
    server: {
      port: PORT,
      /**
       * In live mode the API is proxied rather than called cross-origin.
       *
       * CORS would work — Django allows this origin with credentials — but
       * proxying makes the API *same origin*, and that removes a whole class of
       * cookie problems rather than configuring around them: no SameSite
       * argument, no preflight on every mutation, and `csrftoken` readable by
       * `document.cookie` without depending on the browser treating two ports
       * on `localhost` as one site.
       *
       * The proxy is off when mocking, so MSW's `onUnhandledRequest: "bypass"`
       * does not quietly forward a missed route to a backend that may be down.
       *
       * `changeOrigin: false` is load-bearing, not a default left in place.
       * Django's CSRF middleware compares the `Origin` header against
       * `request.get_host()`. Rewriting Host to `127.0.0.1:8000` while the
       * browser still sends `Origin: http://localhost:5173` makes every POST
       * fail CSRF with a message that reads like a permissions bug.
       */
      proxy: live
        ? {
            "/api": { target, changeOrigin: false },
            // The Django admin, for cross-checking what the console renders.
            "/admin": { target, changeOrigin: false },
            "/static": { target, changeOrigin: false },
          }
        : undefined,
    },
  };
});
