import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import {
  DnsRecord,
  DnsResolver,
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

describe("record verification", () => {
  it.effect("keeps provider readback and public propagation as separate evidence", () => {
    const layer = Layer.merge(
      InMemoryDnsProvider.layer({ records: { "example.com": [record] } }),
      InMemoryDnsResolver.layer(() => ({
        _tag: "answer",
        answers: [
          {
            data: "TARGET.EXAMPLE.NET.",
            name: DomainName.parse("track.example.com"),
            ttl: 300,
            type: "CNAME",
          },
        ],
      })),
    );
    return Effect.gen(function* () {
      const result = yield* EffectVerification.record({
        record,
        zone: DomainName.parse("example.com"),
      });
      assert.deepStrictEqual(result, {
        provider: { _tag: "match" },
        publicDns: { _tag: "propagated" },
        status: "verified",
      });
    }).pipe(Effect.provide(layer));
  });

  it("mirrors pending evidence through the Promise namespace", async () => {
    const result = await Verification.record({
      provider: InMemoryDnsProvider.toAsync({ records: { "example.com": [record] } }),
      record,
      resolver: InMemoryDnsResolver.toAsync(() => ({ _tag: "nodata" })),
      zone: DomainName.parse("example.com"),
    });
    assert.deepStrictEqual(result, {
      provider: { _tag: "match" },
      publicDns: { _tag: "missing" },
      status: "pending",
    });
  });

  it("distinguishes mismatch, timeout, and resolver failure", async () => {
    const provider = InMemoryDnsProvider.toAsync();
    const mismatch = await Verification.record({
      provider,
      record,
      resolver: InMemoryDnsResolver.toAsync(() => ({
        _tag: "answer",
        answers: [
          {
            data: "other.example.net",
            name: record.name,
            ttl: 300,
            type: "CNAME",
          },
        ],
      })),
      zone: DomainName.parse("example.com"),
    });
    assert.strictEqual(mismatch.status, "mismatch");

    const timeout = await Verification.record({
      provider,
      record,
      resolver: { resolve: async () => ({ _tag: "timeout" }) },
      zone: DomainName.parse("example.com"),
    });
    assert.strictEqual(timeout.status, "unavailable");
    assert.strictEqual(timeout.publicDns._tag, "timeout");
  });

  it.effect("turns a typed resolver error into unavailable evidence", () => {
    const layer = Layer.merge(
      InMemoryDnsProvider.layer({ records: { "example.com": [record] } }),
      InMemoryDnsResolver.layer(() =>
        Effect.fail(
          new DnsResolver.Error({
            message: "resolver unavailable",
            reason: "transport",
          }),
        ),
      ),
    );
    return Effect.gen(function* () {
      const result = yield* EffectVerification.record({
        record,
        zone: DomainName.parse("example.com"),
      });
      assert.strictEqual(result.status, "unavailable");
      assert.deepStrictEqual(result.publicDns, {
        _tag: "failure",
        message: "resolver unavailable",
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("requires matching owner name as well as type and data", () => {
    const layer = Layer.merge(
      InMemoryDnsProvider.layer({ records: { "example.com": [record] } }),
      Layer.succeed(DnsResolver.Service, {
        resolve: () =>
          Effect.succeed({
            _tag: "answer",
            answers: [
              {
                data: "target.example.net",
                name: DomainName.parse("other.example.com"),
                ttl: 300,
                type: "CNAME",
              },
            ],
          }),
      }),
    );
    return Effect.gen(function* () {
      const result = yield* EffectVerification.record({
        record,
        zone: DomainName.parse("example.com"),
      });
      assert.strictEqual(result.status, "mismatch");
    }).pipe(Effect.provide(layer));
  });
});
