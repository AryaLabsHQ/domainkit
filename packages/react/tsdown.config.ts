import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: { index: "src/index.ts" },
  deps: {
    neverBundle: [
      "@base-ui/react",
      "@effect/atom-react",
      "domainkit",
      "effect",
      "react",
      "react-dom",
      "scheduler",
    ],
  },
  fixedExtension: true,
  format: "esm",
  platform: "neutral",
  sourcemap: true,
});
