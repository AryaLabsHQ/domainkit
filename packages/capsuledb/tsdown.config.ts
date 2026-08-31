import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: { index: "src/index.ts" },
  deps: { neverBundle: ["capsuledb", "domainkit", "effect"] },
  fixedExtension: true,
  format: "esm",
  platform: "neutral",
  sourcemap: true,
});
