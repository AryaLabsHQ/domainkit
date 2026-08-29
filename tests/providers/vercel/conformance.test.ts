import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { DomainName, Secret } from "../../../src/effect.ts";
import * as Vercel from "../../../src/providers/vercel/index.ts";
import { ProviderConformance } from "../../../src/testing.ts";
import { conformanceFetch } from "./fixtures.ts";

describe("Vercel provider conformance", () => {
  it.effect("passes the shared offline provider-author contract", () =>
    Effect.gen(function* () {
      const report = yield* ProviderConformance.run({
        makeProvider: () =>
          Effect.succeed(
            Vercel.make({
              capabilities: ["dns:read", "dns:write"],
              context: { _tag: "team", teamId: "team-1" },
              fetch: conformanceFetch(),
              token: Secret.make("token"),
            }),
          ),
        zone: DomainName.parse("example.com"),
      });
      assert.strictEqual(report.providerId, "vercel");
      assert.strictEqual(report.cases.length, 5);
    }),
  );
});
