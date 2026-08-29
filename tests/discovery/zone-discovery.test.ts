import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { DomainName, ZoneDiscovery } from "../../src/effect.ts";
import type * as DnsProvider from "../../src/provider/provider.ts";
import * as PromiseZoneDiscovery from "../../src/promise/zone-discovery.ts";
import { InMemoryDnsProvider } from "../../src/testing.ts";

function provider(id: string): DnsProvider.Interface {
  return {
    id,
    createRecord: () => Effect.die("discovery must not write records"),
    deleteRecord: () => Effect.die("discovery must not write records"),
    getRecord: () => Effect.die("discovery must not read records"),
    listRecords: () => Effect.die("discovery must not read records"),
  };
}

function source(input: {
  readonly accountId: string;
  readonly providerId: string;
  readonly zone: string;
}): ZoneDiscovery.Source {
  const zone = DomainName.parse(input.zone);
  return {
    listZones: (name) =>
      Effect.succeed(
        name === zone
          ? [
              {
                accountId: input.accountId,
                id: `${input.accountId}:${zone}`,
                name: zone,
                nameservers: [DomainName.parse(`ns1.${zone}`)],
                status: "active" as const,
              },
            ]
          : [],
      ),
    provider: provider(input.providerId),
  };
}

describe("ZoneDiscovery", () => {
  it.effect("resolves the closest authoritative parent without record access", () =>
    Effect.gen(function* () {
      const outcome = yield* ZoneDiscovery.make([
        source({ accountId: "account-parent", providerId: "cloudflare", zone: "example.com" }),
        source({ accountId: "account-near", providerId: "vercel", zone: "mail.example.com" }),
      ]).discover(DomainName.parse("track.mail.example.com"));
      assert.strictEqual(outcome._tag, "Resolved");
      if (outcome._tag !== "Resolved") return;
      assert.strictEqual(outcome.candidate.name, "mail.example.com");
      assert.strictEqual(outcome.candidate.accountId, "account-near");
      assert.strictEqual(outcome.provider.id, "vercel");
    }),
  );

  it.effect("returns deterministic account candidates instead of guessing ambiguity", () =>
    Effect.gen(function* () {
      const outcome = yield* ZoneDiscovery.make([
        source({ accountId: "account-b", providerId: "cloudflare", zone: "example.com" }),
        source({ accountId: "account-a", providerId: "cloudflare", zone: "example.com" }),
      ]).discover(DomainName.parse("track.example.com"));
      assert.strictEqual(outcome._tag, "SelectionRequired");
      if (outcome._tag !== "SelectionRequired") return;
      assert.deepStrictEqual(
        outcome.candidates.map(({ accountId }) => accountId),
        ["account-a", "account-b"],
      );
    }),
  );

  it.effect("returns NotFound when no connected source owns a candidate zone", () =>
    Effect.gen(function* () {
      const domain = DomainName.parse("missing.example.com");
      const outcome = yield* ZoneDiscovery.make([]).discover(domain);
      assert.deepStrictEqual(outcome, ZoneDiscovery.Outcome.NotFound({ domain }));
    }),
  );

  it("does not require record-only providers to implement discovery", () => {
    const recordOnly: DnsProvider.Interface = provider("record-only");
    assert.strictEqual(recordOnly.id, "record-only");
    assert.ok(!("discover" in recordOnly));
  });

  it("delegates Promise discovery to the canonical Effect implementation", async () => {
    const asyncProvider = InMemoryDnsProvider.toAsync({ id: "cloudflare" });
    const outcome = await PromiseZoneDiscovery.discover({
      domain: DomainName.parse("track.example.com"),
      sources: [
        {
          listZones: async (name) =>
            name === "example.com"
              ? [
                  {
                    accountId: "account-1",
                    id: "zone-1",
                    name,
                    nameservers: [DomainName.parse("ns1.example.com")],
                    status: "active",
                  },
                ]
              : [],
          provider: asyncProvider,
        },
      ],
    });
    assert.deepStrictEqual(outcome, {
      _tag: "Resolved",
      candidate: {
        accountId: "account-1",
        id: "zone-1",
        name: DomainName.parse("example.com"),
        nameservers: [DomainName.parse("ns1.example.com")],
        providerId: "cloudflare",
        status: "active",
      },
    });
  });
});
