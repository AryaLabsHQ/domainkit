import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: { index: "src/index.ts" },
  deps: { neverBundle: ["@base-ui/react", "domainkit", "react", "react-dom"] },
  fixedExtension: true,
  format: "esm",
  platform: "neutral",
  sourcemap: true,
});
