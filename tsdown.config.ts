import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    cloudflare: "src/cloudflare.ts",
    effect: "src/effect.ts",
    "effect-cloudflare": "src/effect-cloudflare.ts",
    index: "src/index.ts",
    testing: "src/testing.ts",
  },
  fixedExtension: true,
  format: "esm",
  platform: "neutral",
  sourcemap: true,
});
