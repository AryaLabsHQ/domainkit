import { defineConfig } from "@playwright/test";

const port = Number(process.env.DOMAINKIT_FIXTURE_PORT ?? "4319");

export default defineConfig({
  testDir: "tests/browser",
  testMatch: "**/*.spec.ts",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: "chrome",
    colorScheme: "light",
    reducedMotion: "reduce",
  },
  webServer: {
    command: `bunx vite --config tests/browser/vite.config.ts --host 127.0.0.1 --port ${port}`,
    port,
    reuseExistingServer: !process.env.CI,
  },
});
