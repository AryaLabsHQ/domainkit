import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import {
  DnsPlan,
  DnsProvider,
  DnsRecord,
  Digest,
  Provisioning as EffectProvisioning,
} from "../../src/effect.ts";
import { Provisioning } from "../../src/index.ts";
import { InMemoryDnsProvider } from "../../src/testing.ts";

const metadata = {
  ownership: "customer",
  provenance: "test",
  purpose: "tracking",
};

const requirement = DnsRecord.parse({
  _tag: "CNAME",
  metadata,
  name: "track.example.com",
  policy: "exclusive",
  target: "target.example.net",
  ttl: 300,
});

describe("provisioning tracer", () => {
  it.effect("runs missing, apply, and exact no-op through the Effect API", () => {
    const provider = InMemoryDnsProvider.make();
    const layer = Layer.merge(Layer.succeed(DnsProvider.Service, provider), Digest.webCryptoLayer);
    return Effect.gen(function* () {
      const first = yield* EffectProvisioning.create({
        requirements: [requirement],
        zone: "example.com",
      });
      assert.deepStrictEqual(
        first.operations.map(({ _tag }) => _tag),
        ["create"],
      );

      const authorization = yield* EffectProvisioning.authorize(first);
      const receipt = yield* EffectProvisioning.apply({
        authorization,
        plan: first,
      });
      assert.strictEqual(receipt.status, "complete");
      assert.ok(receipt.appliedAt instanceof Date);

      const second = yield* EffectProvisioning.create({
        requirements: [requirement],
        zone: "example.com",
      });
      assert.deepStrictEqual(
        second.operations.map(({ _tag }) => _tag),
        ["noop"],
      );
    }).pipe(Effect.provide(layer));
  });

  it("mirrors the tracer through the Promise namespace", async () => {
    const provider = InMemoryDnsProvider.toAsync();
    const plan = await Provisioning.create({
      provider,
      requirements: [requirement],
      zone: "example.com",
    });
    const authorization = await Provisioning.authorize(plan);
    const receipt = await Provisioning.apply({ authorization, plan, provider });
    assert.strictEqual(receipt.status, "complete");
  });

  it.effect("fails closed on incompatible CNAME state", () => {
    const layer = Layer.merge(
      InMemoryDnsProvider.layer({
        records: {
          "example.com": [
            DnsRecord.parse({
              _tag: "TXT",
              metadata,
              name: "track.example.com",
              policy: "append",
              ttl: 300,
              value: "occupied",
            }),
          ],
        },
      }),
      Digest.webCryptoLayer,
    );
    return Effect.gen(function* () {
      const plan = yield* EffectProvisioning.create({
        requirements: [requirement],
        zone: "example.com",
      });
      assert.strictEqual(plan.operations[0]?._tag, "conflict");
      const authorization = yield* EffectProvisioning.authorize(plan);
      const failure = yield* EffectProvisioning.apply({
        authorization,
        plan,
      }).pipe(Effect.flip);
      assert.ok(failure instanceof EffectProvisioning.ConflictError);
    }).pipe(Effect.provide(layer));
  });

  it.effect("rejects mutually incompatible requirements before any provider write", () => {
    const provider = InMemoryDnsProvider.make();
    const layer = Layer.merge(Layer.succeed(DnsProvider.Service, provider), Digest.webCryptoLayer);
    const incompatible = DnsRecord.parse({
      ...requirement,
      target: "other.example.net",
    });
    return Effect.gen(function* () {
      const plan = yield* EffectProvisioning.create({
        requirements: [requirement, incompatible],
        zone: "example.com",
      });
      assert.deepStrictEqual(
        plan.operations.map(({ _tag }) => _tag),
        ["create", "conflict"],
      );

      const authorization = yield* EffectProvisioning.authorize(plan);
      const failure = yield* EffectProvisioning.apply({
        authorization,
        plan,
      }).pipe(Effect.flip);
      assert.ok(failure instanceof EffectProvisioning.ConflictError);
      assert.deepStrictEqual(yield* provider.listRecords(plan.zone), []);
    }).pipe(Effect.provide(layer));
  });

  it.effect("rejects a plan whose digest-bound contents were altered", () => {
    const layer = Layer.merge(InMemoryDnsProvider.layer(), Digest.webCryptoLayer);
    return Effect.gen(function* () {
      const plan = yield* EffectProvisioning.create({
        requirements: [requirement],
        zone: "example.com",
      });
      const altered: DnsPlan.DnsPlan = {
        ...plan,
        providerId: "different-provider",
      };
      const failure = yield* EffectProvisioning.authorize(altered).pipe(Effect.flip);
      assert.ok(failure instanceof EffectProvisioning.AuthorizationError);
    }).pipe(Effect.provide(layer));
  });

  it.effect("detects DNS state changes after authorization", () => {
    const provider = InMemoryDnsProvider.make();
    const layer = Layer.merge(Layer.succeed(DnsProvider.Service, provider), Digest.webCryptoLayer);
    return Effect.gen(function* () {
      const plan = yield* EffectProvisioning.create({
        requirements: [requirement],
        zone: "example.com",
      });
      const authorization = yield* EffectProvisioning.authorize(plan);
      yield* provider.createRecord(
        plan.zone,
        DnsRecord.parse({ ...requirement, target: "unexpected.example.net" }),
      );
      const failure = yield* EffectProvisioning.apply({
        authorization,
        plan,
      }).pipe(Effect.flip);
      assert.ok(failure instanceof EffectProvisioning.StaleError);
    }).pipe(Effect.provide(layer));
  });

  it.effect("returns a partial receipt after a confirmed write and later failure", () => {
    const backing = InMemoryDnsProvider.make();
    let creates = 0;
    const provider: DnsProvider.Interface = {
      id: backing.id,
      listRecords: backing.listRecords,
      createRecord: Effect.fn("TestDnsProvider.createRecord")((zone, record) => {
        creates += 1;
        return creates === 1
          ? backing.createRecord(zone, record)
          : Effect.fail(
              new DnsProvider.Error({
                message: "injected failure",
                operation: "createRecord",
                providerId: backing.id,
              }),
            );
      }),
    };
    const layer = Layer.merge(Layer.succeed(DnsProvider.Service, provider), Digest.webCryptoLayer);
    const second = DnsRecord.parse({
      _tag: "TXT",
      metadata,
      name: "verify.example.com",
      policy: "append",
      ttl: 300,
      value: "second",
    });
    return Effect.gen(function* () {
      const plan = yield* EffectProvisioning.create({
        requirements: [requirement, second],
        zone: "example.com",
      });
      const authorization = yield* EffectProvisioning.authorize(plan);
      const failure = yield* EffectProvisioning.apply({
        authorization,
        plan,
      }).pipe(Effect.flip);
      assert.ok(failure instanceof EffectProvisioning.PartialApplyError);
      if (failure instanceof EffectProvisioning.PartialApplyError) {
        assert.strictEqual(failure.receipt.status, "partial");
        assert.strictEqual(failure.receipt.operations.length, 1);
      }
    }).pipe(Effect.provide(layer));
  });
});
