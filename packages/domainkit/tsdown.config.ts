import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  // Declarations come from `tsc -p tsconfig.build.json`: one file per module, so every public
  // type stays nameable through an exported entry (bundled chunks renamed colliding symbols).
  dts: false,
  entry: {
    client: "src/entry/client.ts",
    index: "src/index.ts",
    server: "src/entry/server.ts",
    testing: "src/entry/testing.ts",
  },
  fixedExtension: true,
  format: "esm",
  platform: "neutral",
  sourcemap: true,
});
