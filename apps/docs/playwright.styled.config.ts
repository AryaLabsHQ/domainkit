import { defineConfig } from "@playwright/test";

import { browserOptions } from "./scripts/browser-options.mts";

const port = Number(process.env.DOMAINKIT_STYLED_PORT ?? "4322");

/** The production build, styled, in light and dark. Run `bun run build` first. */
export default defineConfig({
  testDir: "tests/styled",
  testMatch: "**/*.spec.ts",
  use: {
    browserName: "chromium",
    baseURL: `http://127.0.0.1:${port}`,
    ...browserOptions(process.env),
  },
  projects: [
    { name: "light", use: { colorScheme: "light" } },
    { name: "dark", use: { colorScheme: "dark" } },
  ],
  webServer: {
    command: "bun scripts/serve-dist.mts",
    port,
    reuseExistingServer: !process.env.CI,
  },
});
