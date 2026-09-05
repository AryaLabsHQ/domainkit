import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = resolve(import.meta.dirname, "../..");

/** Serves `tests/browser/app` for the Playwright run; nothing here ships. */
export default defineConfig({
  resolve: {
    alias: [
      { find: "@/components/domainkit", replacement: resolve(root, "registry/domainkit") },
      {
        find: "@/components/ui/copy-value",
        replacement: resolve(root, "registry/ui/copy-value.tsx"),
      },
      {
        find: "@/components/ui/dns-status",
        replacement: resolve(root, "registry/ui/dns-status.tsx"),
      },
      {
        find: "@/components/ui/provider-mark",
        replacement: resolve(root, "registry/ui/provider-mark.tsx"),
      },
      { find: "@/components/ui", replacement: resolve(root, "preview/ui") },
      { find: "@/lib", replacement: resolve(root, "preview/lib") },
    ],
  },
  root: "tests/browser/app",
  server: { strictPort: true },
});
