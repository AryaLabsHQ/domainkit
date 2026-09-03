import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./tests/setup.ts"],
    // A test vitest abandons on timeout keeps running and drives the next test's DOM, so the
    // budget covers a loaded CI runner rather than the local best case.
    testTimeout: 60_000,
  },
});
