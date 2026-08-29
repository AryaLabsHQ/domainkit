import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { DomainName, Secret } from "../../../src/effect.ts";
import * as Cloudflare from "../../../src/providers/cloudflare/index.ts";
import { ProviderConformance } from "../../../src/testing.ts";
import { conformanceFetch } from "./fixtures.ts";

describe("Cloudflare provider conformance", () => {
  it.effect("passes the shared offline provider-author contract", () =>
    Effect.gen(function* () {
      const report = yield* ProviderConformance.run({
        makeProvider: () =>
          Effect.succeed(
            Cloudflare.make({
              accountId: "account-1",
              capabilities: ["dns:read", "dns:write"],
              fetch: conformanceFetch(),
              token: Secret.make("token"),
            }),
          ),
        zone: DomainName.parse("example.com"),
      });
      assert.strictEqual(report.providerId, "cloudflare");
      assert.strictEqual(report.cases.length, 5);
    }),
  );
});
