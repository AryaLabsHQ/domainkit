import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    adapter: "src/adapter.ts",
    cloudflare: "src/cloudflare.ts",
    effect: "src/effect.ts",
    "effect-adapter": "src/effect-adapter.ts",
    "effect-cloudflare": "src/effect-cloudflare.ts",
    "effect-vercel": "src/effect-vercel.ts",
    index: "src/index.ts",
    testing: "src/testing.ts",
    vercel: "src/vercel.ts",
  },
  fixedExtension: true,
  format: "esm",
  platform: "neutral",
  sourcemap: true,
});
