import { assert, describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import {
  DnsPlan,
  DnsProvider,
  DnsRecord,
  Digest,
  Provisioning as EffectProvisioning,
} from "../../src/index.ts";
import { Deletion, Provisioning } from "../../src/promise.ts";
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
      const { plan: first } = yield* EffectProvisioning.create({
        requirements: [requirement],
        target: EffectProvisioning.Target.ExactZone({ zone: "example.com" }),
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

      const { plan: second } = yield* EffectProvisioning.create({
        requirements: [requirement],
        target: EffectProvisioning.Target.ExactZone({ zone: "example.com" }),
      });
      assert.deepStrictEqual(
        second.operations.map(({ _tag }) => _tag),
        ["noop"],
      );
    }).pipe(Effect.provide(layer));
  });

  it("mirrors the tracer through the Promise namespace", async () => {
    const provider = InMemoryDnsProvider.toAsync();
    const { plan } = await Provisioning.create({
      provider,
      requirements: [requirement],
      target: Provisioning.Target.ExactZone({ zone: "example.com" }),
    });
    const authorization = await Provisioning.authorize(plan);
    const receipt = await Provisioning.apply({ authorization, plan, provider });
    assert.strictEqual(receipt.status, "complete");
  });

  it("deletes only receipt-proven records after separate consent and fresh readback", async () => {
    const provider = InMemoryDnsProvider.toAsync();
    const { plan } = await Provisioning.create({
      provider,
      requirements: [requirement],
      target: Provisioning.Target.ExactZone({ zone: "example.com" }),
    });
    const createAuthorization = await Provisioning.authorize(plan);
    const createReceipt = await Provisioning.apply({
      authorization: createAuthorization,
      plan,
      provider,
    });
    const deletion = await Deletion.create({ plan, provider, receipt: createReceipt });
    const deletionAuthorization = await Deletion.authorize(deletion);
    const deletionReceipt = await Deletion.apply({
      authorization: deletionAuthorization,
      plan: deletion,
      provider,
    });
    assert.strictEqual(deletionReceipt.status, "complete");
    assert.deepStrictEqual(await provider.listRecords(plan.zone), []);
  });

  it("fails closed when a receipt-proven record changed before deletion", async () => {
    const provider = InMemoryDnsProvider.toAsync();
    const { plan } = await Provisioning.create({
      provider,
      requirements: [requirement],
      target: Provisioning.Target.ExactZone({ zone: "example.com" }),
    });
    const createAuthorization = await Provisioning.authorize(plan);
    const createReceipt = await Provisioning.apply({
      authorization: createAuthorization,
      plan,
      provider,
    });
    const createdId = createReceipt.operations[0]?.providerRecordId;
    if (createdId === null || createdId === undefined) throw new Error("create ID missing");
    const changedProvider: DnsProvider.AsyncInterface = {
      ...provider,
      getRecord: async () => DnsRecord.parse({ ...requirement, target: "changed.example.net" }),
    };
    await expect(
      Deletion.create({ plan, provider: changedProvider, receipt: createReceipt }),
    ).rejects.toMatchObject({ _tag: "UnsafeDeletionError" });
    assert.notStrictEqual(await provider.getRecord(plan.zone, createdId), null);
  });

  it("resumes only the remaining operations from a partial deletion receipt", async () => {
    const backing = InMemoryDnsProvider.toAsync();
    const second = DnsRecord.parse({
      _tag: "TXT",
      metadata,
      name: "verify.example.com",
      policy: "append",
      ttl: 300,
      value: "proof",
    });
    const { plan } = await Provisioning.create({
      provider: backing,
      requirements: [requirement, second],
      target: Provisioning.Target.ExactZone({ zone: "example.com" }),
    });
    const createReceipt = await Provisioning.apply({
      authorization: await Provisioning.authorize(plan),
      plan,
      provider: backing,
    });
    const deletion = await Deletion.create({ plan, provider: backing, receipt: createReceipt });
    const authorization = await Deletion.authorize(deletion);
    let deletes = 0;
    const flakyProvider: DnsProvider.AsyncInterface = {
      ...backing,
      deleteRecord: async (zone, providerRecordId) => {
        deletes += 1;
        if (deletes === 2) throw new Error("injected delete failure");
        await backing.deleteRecord(zone, providerRecordId);
      },
    };
    let partial: Deletion.DeletionReceipt;
    try {
      await Deletion.apply({ authorization, plan: deletion, provider: flakyProvider });
      throw new Error("expected partial deletion");
    } catch (cause) {
      if (!(cause instanceof Deletion.PartialError)) throw cause;
      partial = cause.receipt;
    }
    assert.strictEqual(partial.operations.length, 1);

    const complete = await Deletion.apply({
      authorization,
      plan: deletion,
      priorReceipt: partial,
      provider: flakyProvider,
    });
    assert.strictEqual(complete.status, "complete");
    assert.strictEqual(complete.operations.length, 2);
    assert.deepStrictEqual(await backing.listRecords(plan.zone), []);
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
      const { plan } = yield* EffectProvisioning.create({
        requirements: [requirement],
        target: EffectProvisioning.Target.ExactZone({ zone: "example.com" }),
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
      const { plan } = yield* EffectProvisioning.create({
        requirements: [requirement, incompatible],
        target: EffectProvisioning.Target.ExactZone({ zone: "example.com" }),
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
      const { plan } = yield* EffectProvisioning.create({
        requirements: [requirement],
        target: EffectProvisioning.Target.ExactZone({ zone: "example.com" }),
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
      const { plan } = yield* EffectProvisioning.create({
        requirements: [requirement],
        target: EffectProvisioning.Target.ExactZone({ zone: "example.com" }),
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
      deleteRecord: backing.deleteRecord,
      getRecord: backing.getRecord,
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
      const { plan } = yield* EffectProvisioning.create({
        requirements: [requirement, second],
        target: EffectProvisioning.Target.ExactZone({ zone: "example.com" }),
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
