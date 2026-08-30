import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const source = fileURLToPath(new URL("../../src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: "@domainkit/react/styles.css", replacement: `${source}/styles.css` },
      { find: "@domainkit/react", replacement: `${source}/index.ts` },
    ],
  },
});
