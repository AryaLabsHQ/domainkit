import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { DomainName } from "../../src/effect.ts";
import { InMemoryDnsProvider, ProviderConformance } from "../../src/testing.ts";

describe("provider-author conformance contract", () => {
  it.effect("runs against an external-style adapter without first-party internals", () =>
    Effect.gen(function* () {
      const report = yield* ProviderConformance.run({
        makeProvider: ProviderConformance.fromAsync(() =>
          InMemoryDnsProvider.toAsync({ id: "third-party" }),
        ),
        prefix: "external-adapter",
        zone: DomainName.parse("example.com"),
      });
      assert.deepStrictEqual(report, {
        cases: [
          "create-readback-cleanup",
          "exact-noop",
          "conflict",
          "stale-plan",
          "partial-apply-cleanup",
        ],
        providerId: "third-party",
        zone: DomainName.parse("example.com"),
      });
    }),
  );
});
