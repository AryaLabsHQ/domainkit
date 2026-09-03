import { defineConfig } from "vite";

/** Serves `tests/browser/app` for the Playwright run; nothing here ships. */
export default defineConfig({
  root: "tests/browser/app",
  server: { strictPort: true },
});
