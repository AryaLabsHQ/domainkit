import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { DnsRecord, DomainName, Secret } from "../../../src/effect.ts";
import * as Vercel from "../../../src/providers/vercel/index.ts";
import * as Records from "../../../src/providers/vercel/records.ts";
import { domain, domainPage, portableZone, record, recordedFetch } from "./fixtures.ts";

const token = Secret.make("test-token-that-must-remain-secret");
const capabilities = ["dns:read", "dns:write"] as const;

describe("Vercel Effect client", () => {
  it.effect("discovers personal and paginated team accounts", () => {
    const recording = recordedFetch([
      { body: { user: { id: "user-1", name: null, username: "saatvik" } } },
      {
        body: {
          pagination: { count: 1, next: 42, prev: null },
          teams: [{ id: "team-1", name: "Team One", slug: "team-one" }],
        },
      },
      {
        body: {
          pagination: { count: 1, next: null, prev: 42 },
          teams: [{ id: "team-2", name: null, slug: "team-two" }],
        },
      },
    ]);
    const client = make(recording.fetch, { _tag: "personal" });
    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* client.listAccounts(), [
        { id: "user-1", name: "saatvik", type: "personal" },
        { id: "team-1", name: "Team One", type: "team" },
        { id: "team-2", name: "team-two", type: "team" },
      ]);
      assert.ok(recording.requests[2]?.url.includes("until=42"));
    });
  });

  it.effect("carries team context and exposes only Vercel-authoritative domains", () => {
    const external = {
      ...domain,
      id: "external-domain",
      name: "external.example",
      nameservers: ["external.example.net"],
      serviceType: "external",
    };
    const recording = recordedFetch([
      { body: domainPage([domain, external]), expect: { pathname: "/v5/domains" } },
    ]);
    const client = make(recording.fetch, { _tag: "team", teamId: "team-1" });
    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* client.listZones(), [portableZone]);
      const url = new URL(recording.requests[0]?.url ?? "");
      assert.strictEqual(url.searchParams.get("teamId"), "team-1");
      assert.strictEqual(url.searchParams.get("limit"), "100");
    });
  });

  it.effect("decodes every portable record type across cursor pages", () => {
    const first = [
      record("A", "a", "192.0.2.1"),
      record("AAAA", "aaaa", "2001:db8::1"),
      record("CNAME", "cname", "target.example.net", { ttl: 300 }),
      record("TXT", "txt.example.com", "verification=value"),
    ];
    const second = [
      record("MX", "", "mx.example.net", { mxPriority: 10 }),
      record("CAA", "", '0 issue "ca.example"'),
      record("NS", "delegated", "ns.example.net"),
      record("SRV", "_service._tcp", "5 443 service.example.net", { priority: 10 }),
      record("ALIAS", "", "alias.vercel-dns.com"),
    ];
    const recording = recordedFetch([
      { body: domainPage([domain]) },
      { body: { pagination: { count: 4, next: 42, prev: null }, records: first } },
      { body: { pagination: { count: 5, next: null, prev: 42 }, records: second } },
    ]);
    const client = make(recording.fetch, { _tag: "team", teamId: "team-1" });
    return Effect.gen(function* () {
      const records = yield* client.listRecords(DomainName.parse("example.com"));
      assert.deepStrictEqual(
        records.map(({ _tag }) => _tag),
        ["A", "AAAA", "CNAME", "TXT", "MX", "CAA", "NS", "SRV", "Opaque"],
      );
      assert.strictEqual(records[0]?.name, "a.example.com");
      assert.strictEqual(records[2]?._tag === "CNAME" ? records[2].ttl : undefined, 300);
      assert.strictEqual(records[4]?.name, "example.com");
      assert.deepStrictEqual(records[8], {
        _tag: "Opaque",
        name: DomainName.parse("example.com"),
        providerRecordId: "record-alias",
        providerType: "ALIAS",
      });
      assert.ok(recording.requests[2]?.url.includes("until=42"));
    });
  });

  it.effect("creates relative record payloads and returns Vercel's record id", () => {
    const recording = recordedFetch([
      { body: domainPage([domain]) },
      {
        body: { uid: "created-record" },
        expect: { method: "POST", pathname: "/v2/domains/example.com/records" },
      },
    ]);
    const client = make(recording.fetch, { _tag: "team", teamId: "team-1" });
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
      assert.strictEqual(result.providerRecordId, "created-record");
      const write = recording.requests[1];
      assert.deepStrictEqual(JSON.parse(String(write?.init?.body)), {
        mxPriority: 10,
        name: "",
        type: "MX",
        value: "mx.example.net",
      });
      assert.strictEqual(
        new Headers(write?.init?.headers).get("authorization"),
        `Bearer ${token.expose()}`,
      );
    });
  });

  it("encodes CAA and SRV bodies without provider DTO leakage", () => {
    assert.deepStrictEqual(
      Records.encode(
        DomainName.parse("example.com"),
        DnsRecord.parse({
          _tag: "CAA",
          flags: 0,
          metadata: { ownership: "customer", provenance: "test", purpose: "certificate" },
          name: "example.com",
          policy: "append",
          tag: "issue",
          ttl: 300,
          value: "ca.example",
        }),
      ),
      { name: "", ttl: 300, type: "CAA", value: '0 issue "ca.example"' },
    );
    assert.deepStrictEqual(
      Records.encode(
        DomainName.parse("example.com"),
        DnsRecord.parse({
          _tag: "SRV",
          metadata: { ownership: "customer", provenance: "test", purpose: "service" },
          name: "_service._tcp.example.com",
          policy: "append",
          port: 443,
          priority: 10,
          target: "service.example.net",
          ttl: 300,
          weight: 5,
        }),
      ),
      {
        name: "_service._tcp",
        srv: { port: 443, priority: 10, target: "service.example.net", weight: 5 },
        ttl: 300,
        type: "SRV",
      },
    );
  });

  it.effect("classifies provider, rate-limit, non-JSON, and transport failures", () =>
    Effect.gen(function* () {
      const cases = [
        [401, "authentication"],
        [403, "authorization"],
        [404, "not_found"],
        [409, "conflict"],
        [500, "response"],
      ] as const;
      for (const [status, expected] of cases) {
        const client = make(
          recordedFetch([
            { body: { error: { code: "failure", message: "request failed" } }, init: { status } },
          ]).fetch,
          { _tag: "team", teamId: "team-1" },
        );
        const failure = yield* client.listZones().pipe(Effect.flip);
        assert.strictEqual(failure.reason, expected);
        assert.strictEqual(failure.status, status);
      }

      const resetMs = Date.now() + 2_000;
      const limited = make(
        recordedFetch([
          {
            body: {
              error: {
                code: "rate_limited",
                limit: { remaining: 0, resetMs, total: 10 },
                message: "slow down",
              },
            },
            init: { status: 429 },
          },
        ]).fetch,
        { _tag: "team", teamId: "team-1" },
      );
      const rateLimit = yield* limited.listZones().pipe(Effect.flip);
      assert.strictEqual(rateLimit.reason, "rate_limit");
      assert.ok((rateLimit.retryAfterMs ?? 0) > 0);
      assert.ok(!JSON.stringify(rateLimit).includes(token.expose()));

      const nonJson = make(
        recordedFetch([{ body: "denied", init: { status: 403 }, json: false }]).fetch,
        { _tag: "team", teamId: "team-1" },
      );
      assert.strictEqual((yield* nonJson.listZones().pipe(Effect.flip)).reason, "authorization");

      const unavailable = make(
        async () => {
          throw new Error("private socket detail");
        },
        { _tag: "team", teamId: "team-1" },
      );
      const transport = yield* unavailable.listZones().pipe(Effect.flip);
      assert.strictEqual(transport.reason, "transport");
      assert.strictEqual(transport.cause, undefined);
    }),
  );

  it.effect("validates personal and team contexts without inventing scopes", () =>
    Effect.gen(function* () {
      const personal = make(
        recordedFetch([{ body: { user: { id: "user-1", name: "Saatvik", username: "saatvik" } } }])
          .fetch,
        { _tag: "personal" },
      );
      assert.deepStrictEqual(yield* personal.validateToken(), {
        accountId: "user-1",
        capabilities,
        expiresAt: null,
        scopes: [],
      });
      const teamRecording = recordedFetch([{ body: domainPage([]) }]);
      const team = make(teamRecording.fetch, { _tag: "team", teamId: "team-1" });
      assert.strictEqual((yield* team.validateToken()).accountId, "team-1");
      assert.ok(teamRecording.requests[0]?.url.includes("teamId=team-1"));
    }),
  );
});

function make(fetch: Vercel.Fetch, context: Vercel.AccountContext): Vercel.Interface {
  return Vercel.make({ capabilities, context, fetch, token });
}
