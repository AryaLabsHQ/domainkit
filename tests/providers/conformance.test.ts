import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { DnsRecord, DomainName } from "../../src/effect.ts";
import { InMemoryDnsProvider, ProviderConformance } from "../../src/testing.ts";

describe("provider-author conformance contract", () => {
  it.effect("runs against an external-style adapter without first-party internals", () =>
    Effect.gen(function* () {
      const report = yield* ProviderConformance.run({
        makeProvider: ProviderConformance.fromAsync(() =>
          InMemoryDnsProvider.toAsync({
            id: "third-party",
            records: {
              "example.com": [
                DnsRecord.parse({
                  _tag: "TXT",
                  metadata: { ownership: "customer", provenance: "fixture", purpose: "unrelated" },
                  name: "existing.example.com",
                  policy: "append",
                  ttl: 300,
                  value: "preserve-me",
                }),
              ],
            },
          }),
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

  it.effect("reports synchronous provider factory failures as typed conformance errors", () =>
    Effect.gen(function* () {
      const result = yield* ProviderConformance.run({
        makeProvider: ProviderConformance.fromAsync(() => {
          throw new Error("invalid adapter fixture");
        }),
        zone: DomainName.parse("example.com"),
      }).pipe(Effect.result);
      assert.strictEqual(result._tag, "Failure");
      if (result._tag !== "Failure") return;
      const failure = result.failure;
      assert.ok(failure instanceof ProviderConformance.Error);
      if (!(failure instanceof ProviderConformance.Error)) return;
      assert.strictEqual(failure.case, "factory");
      assert.match(failure.message, /invalid adapter fixture/);
    }),
  );
});
