import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import {
  Digest,
  DnsProvider,
  DnsRecord,
  DomainName,
  Provisioning,
  ZoneDiscovery,
} from "../../src/index.ts";
import { InMemoryDnsProvider } from "../../src/testing.ts";

const requirement = DnsRecord.parse({
  _tag: "TXT",
  metadata: { ownership: "customer", provenance: "test", purpose: "verification" },
  name: "track.mail.example.com",
  policy: "append",
  ttl: 300,
  value: "proof",
});

function source(input: {
  readonly accountId: string;
  readonly provider: DnsProvider.Interface;
}): ZoneDiscovery.Source {
  return {
    listZones: (name) =>
      Effect.succeed(
        name === "example.com"
          ? [
              {
                accountId: input.accountId,
                id: `${input.accountId}:example.com`,
                name: DomainName.parse("example.com"),
                nameservers: [DomainName.parse("ns1.example.com")],
                status: "active",
              },
            ]
          : [],
      ),
    provider: input.provider,
  };
}

describe("zone-aware provisioning", () => {
  it.effect("produces the same digest for exact and uniquely discovered targets", () => {
    const provider = InMemoryDnsProvider.make({ id: "cloudflare" });
    const exactLayer = Layer.merge(
      Layer.succeed(DnsProvider.Service, provider),
      Digest.webCryptoLayer,
    );
    const discoveryLayer = Layer.merge(
      Layer.succeed(
        ZoneDiscovery.Service,
        ZoneDiscovery.make([source({ accountId: "a", provider })]),
      ),
      Digest.webCryptoLayer,
    );
    return Effect.gen(function* () {
      const exact = yield* Provisioning.create({
        requirements: [requirement],
        target: Provisioning.Target.ExactZone({ zone: "example.com" }),
      }).pipe(Effect.provide(exactLayer));
      const discovered = yield* Provisioning.create({
        requirements: [requirement],
        target: Provisioning.Target.DiscoverFromDomain({ domain: "track.mail.example.com" }),
      }).pipe(Effect.provide(discoveryLayer));
      assert.strictEqual(discovered._tag, "Resolved");
      if (discovered._tag !== "Resolved") return;
      assert.strictEqual(discovered.plan.digest, exact.plan.digest);
      assert.strictEqual(discovered.candidate?.name, "example.com");
    });
  });

  it.effect("returns selection evidence before any record read or write", () => {
    let recordOperations = 0;
    const monitored = (): DnsProvider.Interface => {
      const backing = InMemoryDnsProvider.make({ id: "cloudflare" });
      return {
        ...backing,
        createRecord: (...input) => {
          recordOperations += 1;
          return backing.createRecord(...input);
        },
        deleteRecord: (...input) => {
          recordOperations += 1;
          return backing.deleteRecord(...input);
        },
        getRecord: (...input) => {
          recordOperations += 1;
          return backing.getRecord(...input);
        },
        listRecords: (...input) => {
          recordOperations += 1;
          return backing.listRecords(...input);
        },
      };
    };
    const discovery = ZoneDiscovery.make([
      source({ accountId: "account-b", provider: monitored() }),
      source({ accountId: "account-a", provider: monitored() }),
    ]);
    return Effect.gen(function* () {
      const result = yield* Provisioning.create({
        requirements: [requirement],
        target: Provisioning.Target.DiscoverFromDomain({ domain: "track.mail.example.com" }),
      });
      assert.strictEqual(result._tag, "SelectionRequired");
      if (result._tag !== "SelectionRequired") return;
      assert.deepStrictEqual(
        result.candidates.map(({ accountId }) => accountId),
        ["account-a", "account-b"],
      );
      assert.strictEqual(recordOperations, 0);
    }).pipe(
      Effect.provide(
        Layer.merge(Layer.succeed(ZoneDiscovery.Service, discovery), Digest.webCryptoLayer),
      ),
    );
  });
});
