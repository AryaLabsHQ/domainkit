import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import {
  DnsRecord,
  DnsResolverPool,
  DomainName,
  Verification as EffectVerification,
} from "../../src/effect.ts";
import { Verification } from "../../src/index.ts";
import { InMemoryDnsProvider, InMemoryDnsResolver } from "../../src/testing.ts";

const record = DnsRecord.parse({
  _tag: "CNAME",
  metadata: { ownership: "customer", provenance: "test", purpose: "tracking" },
  name: "track.example.com",
  policy: "exclusive",
  target: "target.example.net",
  ttl: 300,
});
const answer = {
  data: "TARGET.EXAMPLE.NET.",
  name: DomainName.parse("track.example.com"),
  ttl: 300,
  type: "CNAME" as const,
};

describe("Verification.observe", () => {
  it.effect("defaults to public DNS with AnyMatch and preserves every resolver result", () =>
    Effect.gen(function* () {
      const result = yield* EffectVerification.observe({ record });
      assert.strictEqual(result._tag, "Verified");
      assert.strictEqual(result.provider, null);
      assert.strictEqual(result.publicDns?._tag, "Verified");
      if (result.publicDns?._tag !== "Verified") return;
      assert.deepStrictEqual(result.publicDns.matchedResolverIds, ["google"]);
      assert.deepStrictEqual(
        result.publicDns.evidence.map(({ _tag, resolverId }) => ({ _tag, resolverId })),
        [
          { _tag: "NoData", resolverId: "cloudflare" },
          { _tag: "Answer", resolverId: "google" },
        ],
      );
    }).pipe(
      Effect.provide(
        Layer.succeed(
          DnsResolverPool.Service,
          DnsResolverPool.make([
            {
              id: "cloudflare",
              resolver: InMemoryDnsResolver.make(() => ({ _tag: "nodata" })),
            },
            {
              id: "google",
              resolver: InMemoryDnsResolver.make(() => ({ _tag: "answer", answers: [answer] })),
            },
          ]),
        ),
      ),
    ),
  );

  it.effect("supports provider-only observation without a resolver service", () =>
    Effect.gen(function* () {
      const result = yield* EffectVerification.observe({
        provider: EffectVerification.Provider.Enabled({ zone: DomainName.parse("example.com") }),
        publicDns: EffectVerification.PublicDns.Disabled(),
        record,
      });
      assert.strictEqual(result._tag, "Verified");
      assert.strictEqual(result.provider?._tag, "Matched");
      assert.strictEqual(result.publicDns, null);
    }).pipe(Effect.provide(InMemoryDnsProvider.layer({ records: { "example.com": [record] } }))),
  );

  it.effect("requires every requested source for a combined verified result", () =>
    Effect.gen(function* () {
      const result = yield* EffectVerification.observe({
        provider: EffectVerification.Provider.Enabled({ zone: DomainName.parse("example.com") }),
        record,
      });
      assert.strictEqual(result._tag, "Pending");
      assert.strictEqual(result.provider?._tag, "Matched");
      assert.strictEqual(result.publicDns?._tag, "Pending");
    }).pipe(
      Effect.provide(
        Layer.merge(
          InMemoryDnsProvider.layer({ records: { "example.com": [record] } }),
          Layer.succeed(
            DnsResolverPool.Service,
            DnsResolverPool.make([
              {
                id: "cloudflare",
                resolver: InMemoryDnsResolver.make(() => ({ _tag: "nodata" })),
              },
            ]),
          ),
        ),
      ),
    ),
  );

  it.effect("applies AllMatch and Quorum policies across preserved evidence", () => {
    const pool = Layer.succeed(
      DnsResolverPool.Service,
      DnsResolverPool.make([
        {
          id: "one",
          resolver: InMemoryDnsResolver.make(() => ({ _tag: "answer", answers: [answer] })),
        },
        {
          id: "two",
          resolver: InMemoryDnsResolver.make(() => ({ _tag: "answer", answers: [answer] })),
        },
        {
          id: "three",
          resolver: InMemoryDnsResolver.make(() => ({ _tag: "nodata" })),
        },
      ]),
    );
    return Effect.gen(function* () {
      const all = yield* EffectVerification.observe({
        publicDns: EffectVerification.PublicDns.Enabled({
          policy: DnsResolverPool.Policy.AllMatch(),
        }),
        record,
      });
      assert.strictEqual(all._tag, "Pending");

      const quorum = yield* EffectVerification.observe({
        publicDns: EffectVerification.PublicDns.Enabled({
          policy: DnsResolverPool.Policy.Quorum({ minimum: 2 }),
        }),
        record,
      });
      assert.strictEqual(quorum._tag, "Verified");
    }).pipe(Effect.provide(pool));
  });

  it.effect("returns NotObserved when both sources are disabled", () =>
    Effect.gen(function* () {
      const result = yield* EffectVerification.observe({
        provider: EffectVerification.Provider.Disabled(),
        publicDns: EffectVerification.PublicDns.Disabled(),
        record,
      });
      assert.strictEqual(result._tag, "NotObserved");
    }),
  );

  it("keeps Effect and Promise results semantically identical", async () => {
    const provider = InMemoryDnsProvider.toAsync({ records: { "example.com": [record] } });
    const result = await Verification.observe({
      provider: Verification.Provider.Enabled({
        provider,
        zone: DomainName.parse("example.com"),
      }),
      record,
      resolvers: [
        {
          id: "cloudflare",
          resolver: InMemoryDnsResolver.toAsync(() => ({ _tag: "nodata" })),
        },
        {
          id: "google",
          resolver: InMemoryDnsResolver.toAsync(() => ({ _tag: "answer", answers: [answer] })),
        },
      ],
    });
    assert.strictEqual(result._tag, "Verified");
    assert.strictEqual(result.provider?._tag, "Matched");
    assert.strictEqual(result.publicDns?._tag, "Verified");
  });
});
