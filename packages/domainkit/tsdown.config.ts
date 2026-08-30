import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    index: "src/index.ts",
    promise: "src/promise.ts",
    testing: "src/testing.ts",
  },
  fixedExtension: true,
  format: "esm",
  platform: "neutral",
  sourcemap: true,
});
