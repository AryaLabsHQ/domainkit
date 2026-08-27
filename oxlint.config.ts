import { defineConfig } from "oxlint";

export default defineConfig({
  categories: {
    correctness: "error",
    suspicious: "warn",
    perf: "warn",
  },
  jsPlugins: [{ name: "domainkit", specifier: "./tools/oxlint/index.js" }],
  plugins: ["typescript", "import", "node"],
  rules: {
    "domainkit/no-foreign-promise-outside-boundary": "error",
    "domainkit/no-runtime-exit": "error",
    "eslint/no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "vitest",
            message: "Import test helpers from @effect/vitest.",
          },
        ],
      },
    ],
    "eslint/no-unused-vars": ["error", { args: "none", ignoreRestSiblings: true }],
    "eslint/no-underscore-dangle": "off",
    "import/namespace": "off",
    "typescript/no-explicit-any": "error",
    "typescript/no-non-null-assertion": "error",
  },
});
