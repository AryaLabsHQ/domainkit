import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { DnsRecord, DomainName, Secret } from "../../../src/effect.ts";
import * as Cloudflare from "../../../src/providers/cloudflare/index.ts";
import { page, portableZone, recordedFetch, single, zone } from "./fixtures.ts";

const token = Secret.make("test-token-that-must-remain-secret");
const capabilities = ["dns:read", "dns:write"] as const;

describe("Cloudflare Effect client", () => {
  it.effect("exposes normalized optional zone discovery", () => {
    const recording = recordedFetch([{ body: page([{ ...zone, status: "moved" }]) }]);
    const client = Cloudflare.make({
      accountId: "account-1",
      capabilities,
      fetch: recording.fetch,
      token,
    });
    return Effect.gen(function* () {
      const zones = yield* Cloudflare.discovery(client).listZones(DomainName.parse("example.com"));
      assert.strictEqual(zones[0]?.status, "unknown");
      assert.strictEqual(Cloudflare.discovery(client).provider, client);
    });
  });

  it.effect("discovers accounts from paginated zones without the legacy accounts endpoint", () => {
    const recording = recordedFetch([
      { body: page([zone], 1, 2) },
      {
        body: page(
          [
            {
              ...zone,
              account: { id: "account-2", name: "Second Account" },
              id: "zone-2",
              name: "second.example",
            },
          ],
          2,
          2,
        ),
      },
    ]);
    const client = Cloudflare.make({
      accountId: "account-1",
      capabilities,
      fetch: recording.fetch,
      token,
    });
    return Effect.gen(function* () {
      const accounts = yield* client.listAccounts();
      assert.deepStrictEqual(accounts, [
        { id: "account-1", name: "Example Account" },
        { id: "account-2", name: "Second Account" },
      ]);
      assert.strictEqual(recording.requests.length, 2);
      assert.ok(recording.requests.every(({ url }) => url.includes("/zones?")));
      assert.ok(recording.requests[1]?.url.includes("page=2"));
    });
  });

  it.effect("decodes every portable record type and automatic TTL", () => {
    const recording = recordedFetch([
      { body: page([zone]) },
      {
        body: page(
          [
            record("A", "a.example.com", { content: "192.0.2.1" }),
            record("AAAA", "aaaa.example.com", { content: "2001:db8::1" }),
            record("CNAME", "cname.example.com", { content: "target.example.net" }),
            { ...record("TXT", "txt.example.com", { content: "verification=value" }), ttl: 300 },
          ],
          1,
          2,
        ),
      },
      {
        body: page(
          [
            record("MX", "example.com", { content: "mx.example.net", priority: 10 }),
            record("CAA", "example.com", {
              data: { flags: 0, tag: "issue", value: "ca.example" },
            }),
            record("NS", "delegated.example.com", { content: "ns.example.net" }),
            record("SRV", "_service._tcp.example.com", {
              data: { port: 443, priority: 10, target: "service.example.net", weight: 5 },
            }),
          ],
          2,
          2,
        ),
      },
    ]);
    const client = Cloudflare.make({
      accountId: "account-1",
      capabilities,
      fetch: recording.fetch,
      token,
    });
    return Effect.gen(function* () {
      const records = yield* client.listRecords(DomainName.parse("example.com"));
      assert.deepStrictEqual(
        records.map(({ _tag }) => _tag),
        ["A", "AAAA", "CNAME", "TXT", "MX", "CAA", "NS", "SRV"],
      );
      assert.strictEqual(records[0]?._tag === "A" ? records[0].ttl : undefined, null);
      assert.strictEqual(records[3]?._tag === "TXT" ? records[3].ttl : undefined, 300);
      assert.strictEqual(records[2]?._tag === "CNAME" ? records[2].policy : undefined, "exclusive");
      assert.ok(recording.requests[2]?.url.includes("page=2"));
    });
  });

  it.effect("creates DNS-only records and returns Cloudflare's record id", () => {
    const created = record("MX", "example.com", {
      content: "mx.example.net",
      priority: 10,
    });
    const recording = recordedFetch([
      { body: page([zone]), expect: { pathname: "/client/v4/zones" } },
      {
        body: single(created),
        expect: { method: "POST", pathname: "/client/v4/zones/zone-1/dns_records" },
      },
    ]);
    const client = Cloudflare.make({
      accountId: "account-1",
      capabilities,
      fetch: recording.fetch,
      token,
    });
    return Effect.gen(function* () {
      const result = yield* client.createRecord(
        DomainName.parse("example.com"),
        DnsRecord.parse({
          _tag: "MX",
          exchange: "mx.example.net",
          metadata: { ownership: "customer", provenance: "test", purpose: "mail" },
          name: "example.com",
          policy: "append",
          priority: 10,
          ttl: null,
        }),
      );
      assert.strictEqual(result.providerRecordId, created.id);
      const write = recording.requests[1];
      assert.strictEqual(write?.init?.method, "POST");
      const headers = new Headers(write?.init?.headers);
      assert.strictEqual(headers.get("authorization"), `Bearer ${token.expose()}`);
      assert.strictEqual(headers.get("accept"), "application/json");
      assert.strictEqual(headers.get("content-type"), "application/json");
      assert.deepStrictEqual(JSON.parse(String(write?.init?.body)), {
        content: "mx.example.net",
        name: "example.com",
        priority: 10,
        proxied: false,
        ttl: 1,
        type: "MX",
      });
    });
  });

  it.effect("reads and deletes an exact record by Cloudflare record id", () => {
    const existing = record("TXT", "verify.example.com", { content: "proof" });
    const existingId = "record-txt";
    const recording = recordedFetch([
      { body: page([zone]), expect: { pathname: "/client/v4/zones" } },
      {
        body: single(existing),
        expect: { pathname: `/client/v4/zones/zone-1/dns_records/${existingId}` },
      },
      { body: page([zone]), expect: { pathname: "/client/v4/zones" } },
      {
        body: single(existing),
        expect: {
          method: "DELETE",
          pathname: `/client/v4/zones/zone-1/dns_records/${existingId}`,
        },
      },
    ]);
    const client = Cloudflare.make({
      accountId: "account-1",
      capabilities,
      fetch: recording.fetch,
      token,
    });
    return Effect.gen(function* () {
      const observed = yield* client.getRecord(DomainName.parse("example.com"), existingId);
      assert.strictEqual(observed?._tag, "TXT");
      yield* client.deleteRecord(DomainName.parse("example.com"), existingId);
      assert.strictEqual(recording.requests[3]?.init?.method, "DELETE");
    });
  });

  it.effect("classifies rate limits without leaking credentials", () => {
    const recording = recordedFetch([
      {
        body: {
          errors: [{ code: 10000, message: "rate limited" }],
          messages: [],
          result: null,
          success: false,
        },
        init: { headers: { "retry-after": "2" }, status: 429 },
      },
    ]);
    const client = Cloudflare.make({
      accountId: "account-1",
      capabilities,
      fetch: recording.fetch,
      token,
    });
    return Effect.gen(function* () {
      const failure = yield* client.listZones().pipe(Effect.flip);
      assert.strictEqual(failure.reason, "rate_limit");
      assert.strictEqual(failure.retryAfterMs, 2_000);
      assert.ok(!JSON.stringify(failure).includes(token.expose()));
      assert.ok(!failure.message.includes(token.expose()));
    });
  });

  it.effect("classifies HTTP and Cloudflare envelope failures", () =>
    Effect.gen(function* () {
      const cases = [
        [401, "authentication"],
        [403, "authorization"],
        [404, "not_found"],
        [409, "conflict"],
        [500, "response"],
      ] as const;
      for (const [status, expected] of cases) {
        const client = Cloudflare.make({
          accountId: "account-1",
          capabilities,
          fetch: recordedFetch([
            {
              body: {
                errors: [{ code: status, message: "request failed" }],
                messages: [],
                result: null,
                success: false,
              },
              init: { status },
            },
          ]).fetch,
          token,
        });
        const failure = yield* client.listZones().pipe(Effect.flip);
        assert.strictEqual(failure.reason, expected);
        assert.strictEqual(failure.status, status);
      }
    }),
  );

  it.effect("classifies non-JSON rate limits and transport failures", () =>
    Effect.gen(function* () {
      const limited = Cloudflare.make({
        accountId: "account-1",
        capabilities,
        fetch: recordedFetch([
          {
            body: "rate limited",
            init: { headers: { "retry-after": "3" }, status: 429 },
            json: false,
          },
        ]).fetch,
        token,
      });
      const rateLimit = yield* limited.listZones().pipe(Effect.flip);
      assert.strictEqual(rateLimit.reason, "rate_limit");
      assert.strictEqual(rateLimit.retryAfterMs, 3_000);

      const unavailable = Cloudflare.make({
        accountId: "account-1",
        capabilities,
        fetch: async () => {
          throw new Error("socket failed with a private detail");
        },
        token,
      });
      const transport = yield* unavailable.listZones().pipe(Effect.flip);
      assert.strictEqual(transport.reason, "transport");
      assert.strictEqual(transport.message, "Cloudflare request failed");
      assert.strictEqual(transport.cause, undefined);
    }),
  );

  it.effect("accepts sparse pagination metadata and Cloudflare conflict envelopes", () =>
    Effect.gen(function* () {
      const sparse = Cloudflare.make({
        accountId: "account-1",
        capabilities,
        fetch: recordedFetch([
          { body: { errors: [], messages: [], result: [zone], success: true } },
        ]).fetch,
        token,
      });
      assert.deepStrictEqual(yield* sparse.listZones(), [portableZone]);

      const conflict = Cloudflare.make({
        accountId: "account-1",
        capabilities,
        fetch: recordedFetch([
          {
            body: {
              errors: [{ code: 81056, message: "existing NS record" }],
              messages: [],
              result: null,
              success: false,
            },
          },
        ]).fetch,
        token,
      });
      const failure = yield* conflict.listZones().pipe(Effect.flip);
      assert.strictEqual(failure.reason, "conflict");
    }),
  );

  it.effect("rejects malformed successful envelopes at the schema boundary", () => {
    const client = Cloudflare.make({
      accountId: "account-1",
      capabilities,
      fetch: recordedFetch([
        {
          body: { errors: [], messages: [], result: "not-an-array", success: true },
        },
      ]).fetch,
      token,
    });
    return Effect.gen(function* () {
      const failure = yield* client.listZones().pipe(Effect.flip);
      assert.strictEqual(failure.reason, "response");
      assert.ok(failure.message.includes("API contract"));
    });
  });

  it.effect("fails deterministically when zone resolution is missing or ambiguous", () =>
    Effect.gen(function* () {
      for (const [zones, expected] of [
        [[], "not_found"],
        [[zone, { ...zone, id: "duplicate-zone" }], "response"],
      ] as const) {
        const client = Cloudflare.make({
          accountId: "account-1",
          capabilities,
          fetch: recordedFetch([{ body: page(zones) }]).fetch,
          token,
        });
        const failure = yield* client
          .listRecords(DomainName.parse("example.com"))
          .pipe(Effect.flip);
        assert.strictEqual(failure.reason, expected);
      }
    }),
  );

  it.effect("reads portable records and preserves non-portable provider records", () => {
    const proxied = { ...record("A", "a.example.com", { content: "192.0.2.1" }), proxied: true };
    const client = Cloudflare.make({
      accountId: "account-1",
      capabilities,
      fetch: recordedFetch([
        { body: page([zone]) },
        {
          body: page([
            proxied,
            record("A", "*.example.com", { content: "192.0.2.2" }),
            record("HTTPS", "example.com", { data: {} }),
          ]),
        },
      ]).fetch,
      token,
    });
    return Effect.gen(function* () {
      const records = yield* client.listRecords(DomainName.parse("example.com"));
      assert.strictEqual(records.length, 3);
      assert.strictEqual(
        records[0]?._tag === "A" ? records[0].metadata.provenance : undefined,
        "cloudflare:proxied",
      );
      assert.deepStrictEqual(records[1], {
        _tag: "Opaque",
        name: "*.example.com",
        providerRecordId: "record-a",
        providerType: "A",
      });
      assert.deepStrictEqual(records[2], {
        _tag: "Opaque",
        name: "example.com",
        providerRecordId: "record-https",
        providerType: "HTTPS",
      });
    });
  });
});

function record(
  type: string,
  name: string,
  fields: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return {
    id: `record-${type.toLowerCase()}`,
    name,
    proxied: false,
    ttl: 1,
    type,
    ...fields,
  };
}
