import { defineConfig } from "@playwright/test";

const port = Number(process.env.DOMAINKIT_DOCS_PORT ?? "4321");

export default defineConfig({
  testDir: "tests/browser",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: "chrome",
    colorScheme: "light",
    reducedMotion: "reduce",
  },
  webServer: {
    command: `bun run --cwd ../../apps/docs dev -- --host 127.0.0.1 --port ${port}`,
    port,
    reuseExistingServer: !process.env.CI,
  },
});
