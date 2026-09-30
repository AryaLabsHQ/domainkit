import { defineConfig } from "@playwright/test";

import { browserOptions } from "./scripts/browser-options.mts";

const port = Number(process.env.DOMAINKIT_FIXTURE_PORT ?? "4321");

export default defineConfig({
  testDir: "tests/browser",
  testMatch: "**/*.spec.ts",
  use: {
    browserName: "chromium",
    baseURL: `http://127.0.0.1:${port}`,
    ...browserOptions(process.env),
    colorScheme: "light",
  },
  webServer: {
    command: `bunx vite --config tests/browser/vite.config.ts --host 127.0.0.1 --port ${port}`,
    port,
    reuseExistingServer: !process.env.CI,
  },
});
