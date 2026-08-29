import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  use: {
    baseURL: "http://127.0.0.1:4178",
    channel: "chrome",
    colorScheme: "light",
    reducedMotion: "reduce",
  },
  webServer: {
    command: "bun run build && bun run vite examples/vite --host 127.0.0.1 --port 4178",
    port: 4178,
    reuseExistingServer: false,
  },
});
