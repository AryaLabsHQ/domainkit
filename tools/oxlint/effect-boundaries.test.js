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
      filename: path.join(process.cwd(), "packages/domainkit/src/promise/provisioning.ts"),
      code: "Effect.runPromise(program);",
    },
    {
      filename: path.join(process.cwd(), "packages/domainkit/src/provider/provider.ts"),
      code: "Effect.runPromise(program);",
    },
    {
      filename: path.join(process.cwd(), "packages/domainkit/src/transport.ts"),
      code: "Effect.runPromise(program);",
    },
  ],
  invalid: [
    {
      filename: path.join(process.cwd(), "packages/domainkit/src/plan/plan.ts"),
      code: "Effect.runPromise(program);",
      errors: [{ message: /Promise facade/ }],
    },
  ],
});

tester.run("domainkit/no-foreign-promise-outside-boundary", noForeignPromiseOutsideBoundary, {
  valid: [
    {
      filename: path.join(process.cwd(), "packages/domainkit/src/auth/authorization-code.ts"),
      code: "Effect.tryPromise(() => request());",
    },
    {
      filename: path.join(process.cwd(), "packages/domainkit/src/providers/cloudflare/auth.ts"),
      code: "Effect.tryPromise(() => request());",
    },
    {
      filename: path.join(process.cwd(), "packages/domainkit/src/promise/connection.ts"),
      code: "Effect.tryPromise(() => callback());",
    },
    {
      filename: path.join(process.cwd(), "packages/domainkit/src/transport.ts"),
      code: "Effect.tryPromise(() => callback());",
    },
    {
      filename: path.join(process.cwd(), "packages/domainkit/src/server/index.ts"),
      code: "Effect.tryPromise(() => request.json());",
    },
  ],
  invalid: [
    {
      filename: path.join(process.cwd(), "packages/domainkit/src/plan/plan.ts"),
      code: "Effect.tryPromise(() => request());",
      errors: [{ message: /foreign Promise boundaries/ }],
    },
  ],
});
