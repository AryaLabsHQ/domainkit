import path from "node:path";
import { describe, it } from "node:test";

import { RuleTester } from "oxlint/plugins-dev";

import { noForeignPromiseOutsideBoundary, noRuntimeExit } from "./effect-boundaries.js";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    parserOptions: { lang: "ts" },
    sourceType: "module",
  },
});

tester.run("domainkit/no-runtime-exit", noRuntimeExit, {
  valid: [
    {
      filename: path.join(process.cwd(), "packages/domainkit/tests/tracer/lifecycle.test.ts"),
      code: "Effect.runPromise(program);",
    },
    {
      filename: path.join(process.cwd(), "packages/domainkit/src/internal/conformance/storage.ts"),
      code: "Effect.runPromise(program);",
    },
  ],
  invalid: [
    {
      filename: path.join(process.cwd(), "packages/domainkit/src/Provision.ts"),
      code: "Effect.runPromise(program);",
      errors: [{ message: /hosts own the runtime/ }],
    },
    {
      filename: path.join(process.cwd(), "packages/domainkit/src/Testing.ts"),
      code: "Effect.runPromise(program);",
      errors: [{ message: /hosts own the runtime/ }],
    },
  ],
});

tester.run("domainkit/no-foreign-promise-outside-boundary", noForeignPromiseOutsideBoundary, {
  valid: [
    {
      filename: path.join(process.cwd(), "packages/domainkit/src/internal/digest.ts"),
      code: "Effect.tryPromise(() => request());",
    },
    {
      filename: path.join(process.cwd(), "packages/domainkit/src/internal/http.ts"),
      code: "Effect.tryPromise(() => request());",
    },
    {
      filename: path.join(process.cwd(), "packages/domainkit/src/Storage.ts"),
      code: "Effect.tryPromise(() => callback());",
    },
    {
      filename: path.join(process.cwd(), "packages/domainkit/tests/storage/memory.test.ts"),
      code: "Effect.tryPromise(() => callback());",
    },
  ],
  invalid: [
    {
      filename: path.join(process.cwd(), "packages/domainkit/src/Provision.ts"),
      code: "Effect.tryPromise(() => request());",
      errors: [{ message: /foreign Promise boundaries/ }],
    },
    {
      filename: path.join(process.cwd(), "packages/domainkit/src/Cloudflare.ts"),
      code: "Effect.tryPromise(() => request());",
      errors: [{ message: /foreign Promise boundaries/ }],
    },
  ],
});
