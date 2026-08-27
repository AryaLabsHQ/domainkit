import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    effect: "src/effect.ts",
    index: "src/index.ts",
    testing: "src/testing.ts",
  },
  fixedExtension: true,
  format: "esm",
  platform: "neutral",
  sourcemap: true,
});
