import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { Connection, DnsRecord, DomainName, ProviderSession, Secret } from "../../../src/index.ts";
import * as Vercel from "../../../src/providers/vercel/index.ts";
import * as Records from "../../../src/providers/vercel/records.ts";
import {
  authoritativeConfig,
  domain,
  domainEnvelope,
  domainPage,
  portableZone,
  record,
  recordedFetch,
} from "./fixtures.ts";

const token = Secret.make("test-token-that-must-remain-secret");
const capabilities = ["dns:read", "dns:write"] as const;

describe("Vercel Effect client", () => {
  it.effect("exposes normalized optional zone discovery", () => {
    const recording = recordedFetch([{ body: domainPage([domain]) }]);
    const client = make(recording.fetch, { _tag: "team", teamId: "team-1" });
    return Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* Vercel.discovery(client).listZones(DomainName.parse("example.com")),
        [portableZone],
      );
      assert.strictEqual(Vercel.discovery(client).provider, client);
    });
  });

  it.effect("discovers every authoritative domain in one team installation", () => {
    const delegated = {
      ...domain,
      id: "domain-2",
      name: "mail.example.com",
      nameservers: ["ns1.mail.example.net", "ns2.mail.example.net"],
    };
    const recording = recordedFetch([
      { body: domainPage([domain, delegated]), expect: { pathname: "/v5/domains" } },
    ]);
    const client = make(recording.fetch, { _tag: "team", teamId: "team-1" });
    return Effect.gen(function* () {
      const targets = yield* client.listTargets();
      assert.deepStrictEqual(
        targets.map(({ accountId, accountKind, zoneId, zoneName }) => ({
          accountId,
          accountKind,
          zoneId,
          zoneName,
        })),
        [
          {
            accountId: "team-1",
            accountKind: "team",
            zoneId: "domain-1",
            zoneName: DomainName.parse("example.com"),
          },
          {
            accountId: "team-1",
            accountKind: "team",
            zoneId: "domain-2",
            zoneName: DomainName.parse("mail.example.com"),
          },
        ],
      );
      assert.deepStrictEqual(targets[1]?.evidence, {
        nameservers: [
          DomainName.parse("ns1.mail.example.net"),
          DomainName.parse("ns2.mail.example.net"),
        ],
        status: "active",
        zoneType: "zeit.world",
      });
      assert.strictEqual(
        new URL(recording.requests[0]?.url ?? "").searchParams.get("teamId"),
        "team-1",
      );
    });
  });

  it.effect("resolves the closest Vercel installation target and reports not found", () => {
    const delegated = { ...domain, id: "domain-2", name: "mail.example.com" };
    const resolved = make(recordedFetch([{ body: domainPage([domain, delegated]) }]).fetch, {
      _tag: "team",
      teamId: "team-1",
    });
    const missing = make(
      recordedFetch([
        { body: domainPage([]) },
        {
          body: { error: { code: "not_found", message: "Domain not found" } },
          init: { status: 404 },
        },
        {
          body: { error: { code: "not_found", message: "Domain not found" } },
          init: { status: 404 },
        },
      ]).fetch,
      { _tag: "team", teamId: "team-1" },
    );
    return Effect.gen(function* () {
      const domainName = DomainName.parse("mail.example.com");
      const selection = yield* resolved.resolveTarget(domainName);
      assert.strictEqual(selection._tag, "Resolved");
      if (selection._tag === "Resolved") {
        assert.strictEqual(selection.target.zoneId, "domain-2");
        assert.strictEqual(selection.target.zoneName, "mail.example.com");
      }
      assert.deepStrictEqual(
        yield* missing.resolveTarget(domainName),
        ProviderSession.Resolution.NotFound({ domain: domainName }),
      );
    });
  });

  it.effect("binds Vercel writes to a selected domain without re-discovering it", () => {
    const selected: Connection.ProviderTarget = {
      accountId: "team-1",
      accountKind: "team",
      evidence: {
        nameservers: [DomainName.parse("ns1.vercel-dns.com")],
        status: "active",
        zoneType: "zeit.world",
      },
      zoneId: "domain-1",
      zoneName: DomainName.parse("example.com"),
    };
    const recording = recordedFetch([
      {
        body: { uid: "selected-record" },
        expect: { method: "POST", pathname: "/v2/domains/example.com/records" },
      },
    ]);
    const client = make(recording.fetch, { _tag: "team", teamId: "team-1" });
    return Effect.gen(function* () {
      const provider = yield* client.forTarget(selected);
      const result = yield* provider.createRecord(
        selected.zoneName,
        DnsRecord.parse({
          _tag: "TXT",
          metadata: { ownership: "customer", provenance: "test", purpose: "verification" },
          name: "_probe.example.com",
          policy: "append",
          ttl: 300,
          value: "domainkit",
        }),
      );
      assert.deepStrictEqual(result, { providerRecordId: "selected-record" });
      assert.strictEqual(recording.requests.length, 1);
    });
  });

  it.effect("rejects targets outside the selected team installation", () => {
    const client = make(
      async () => {
        throw new Error("must not call the provider");
      },
      { _tag: "team", teamId: "team-1" },
    );
    return Effect.gen(function* () {
      const failure = yield* client
        .forTarget({
          accountId: "team-2",
          accountKind: "team",
          zoneId: "domain-2",
          zoneName: DomainName.parse("other.example"),
        })
        .pipe(Effect.flip);
      assert.strictEqual(failure.reason, "authorization");
    });
  });

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
      intendedNameservers: [],
      name: "external.example",
      nameservers: ["external.example.net"],
      serviceType: "external",
      zone: false,
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

  it.effect("exposes an external domain with Vercel DNS storage enabled", () => {
    const storageZone = {
      ...domain,
      nameservers: ["external.example.net"],
      serviceType: "external",
    };
    const recording = recordedFetch([
      { body: domainPage([storageZone]), expect: { pathname: "/v5/domains" } },
    ]);
    const client = make(recording.fetch, { _tag: "team", teamId: "team-1" });
    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* client.listZones(), [portableZone]);
    });
  });

  it.effect("uses intended nameservers when an integration response omits the zone flag", () => {
    const { zone: _zone, ...storageZone } = {
      ...domain,
      nameservers: ["external.example.net"],
      serviceType: "external",
    };
    const recording = recordedFetch([
      { body: domainPage([storageZone]), expect: { pathname: "/v5/domains" } },
    ]);
    const client = make(recording.fetch, { _tag: "team", teamId: "team-1" });
    return Effect.gen(function* () {
      assert.deepStrictEqual(yield* client.listZones(), [portableZone]);
    });
  });

  it.effect("resolves a requested subdomain to its parent DNS storage zone", () => {
    const recording = recordedFetch([
      { body: domainPage([]), expect: { pathname: "/v5/domains" } },
      {
        body: authoritativeConfig,
        expect: { pathname: "/v6/domains/mail.example.com/config" },
      },
      { body: domainEnvelope, expect: { pathname: "/v5/domains/mail.example.com" } },
    ]);
    const client = make(recording.fetch, { _tag: "team", teamId: "team-1" });
    return Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* client.listZones({ name: DomainName.parse("mail.example.com") }),
        [portableZone],
      );
    });
  });

  it.effect("returns no zone when direct discovery cannot find the requested domain", () => {
    const recording = recordedFetch([
      { body: domainPage([]), expect: { pathname: "/v5/domains" } },
      {
        body: { error: { code: "not_found", message: "Domain not found" } },
        expect: { pathname: "/v6/domains/missing.example/config" },
        init: { status: 404 },
      },
    ]);
    const client = make(recording.fetch, { _tag: "team", teamId: "team-1" });
    return Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* client.listZones({ name: DomainName.parse("missing.example") }),
        [],
      );
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
      record("A", "*", "192.0.2.2"),
      record("ALIAS", "", "alias.vercel-dns.com"),
    ];
    const recording = recordedFetch([
      {
        body: authoritativeConfig,
        expect: { pathname: "/v6/domains/example.com/config" },
      },
      { body: domainEnvelope, expect: { pathname: "/v5/domains/example.com" } },
      { body: { pagination: { count: 4, next: 42, prev: null }, records: first } },
      { body: { pagination: { count: 5, next: null, prev: 42 }, records: second } },
    ]);
    const client = make(recording.fetch, { _tag: "team", teamId: "team-1" });
    return Effect.gen(function* () {
      const records = yield* client.listRecords(DomainName.parse("example.com"));
      assert.deepStrictEqual(
        records.map(({ _tag }) => _tag),
        ["A", "AAAA", "CNAME", "TXT", "MX", "CAA", "NS", "SRV", "Opaque", "Opaque"],
      );
      assert.strictEqual(records[0]?.name, "a.example.com");
      assert.strictEqual(records[2]?._tag === "CNAME" ? records[2].ttl : undefined, 300);
      assert.strictEqual(records[4]?.name, "example.com");
      assert.deepStrictEqual(records[8], {
        _tag: "Opaque",
        name: "*.example.com",
        providerRecordId: "record-a",
        providerType: "A",
      });
      assert.deepStrictEqual(records[9], {
        _tag: "Opaque",
        name: DomainName.parse("example.com"),
        providerRecordId: "record-alias",
        providerType: "ALIAS",
      });
      assert.ok(recording.requests[3]?.url.includes("until=42"));
    });
  });

  it.effect("creates relative record payloads and returns Vercel's record id", () => {
    const recording = recordedFetch([
      {
        body: authoritativeConfig,
        expect: { pathname: "/v6/domains/example.com/config" },
      },
      { body: domainEnvelope, expect: { pathname: "/v5/domains/example.com" } },
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
      const write = recording.requests[2];
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

  it.effect("reads and deletes an exact record by Vercel record id", () => {
    const existing = record("TXT", "verify", "proof");
    const recording = recordedFetch([
      {
        body: authoritativeConfig,
        expect: { pathname: "/v6/domains/example.com/config" },
      },
      { body: domainEnvelope, expect: { pathname: "/v5/domains/example.com" } },
      {
        body: { pagination: { count: 1, next: null, prev: null }, records: [existing] },
        expect: { pathname: "/v5/domains/example.com/records" },
      },
      {
        body: authoritativeConfig,
        expect: { pathname: "/v6/domains/example.com/config" },
      },
      { body: domainEnvelope, expect: { pathname: "/v5/domains/example.com" } },
      {
        body: { uid: "record-txt" },
        expect: { method: "DELETE", pathname: "/v2/domains/example.com/records/record-txt" },
      },
    ]);
    const client = make(recording.fetch, { _tag: "team", teamId: "team-1" });
    return Effect.gen(function* () {
      const observed = yield* client.getRecord(DomainName.parse("example.com"), "record-txt");
      assert.strictEqual(observed?._tag, "TXT");
      yield* client.deleteRecord(DomainName.parse("example.com"), "record-txt");
      assert.strictEqual(recording.requests[5]?.init?.method, "DELETE");
    });
  });

  it.effect("validates an exact delegated zone through the domain configuration endpoint", () => {
    const zone = DomainName.parse("dk-live.example.com");
    const recording = recordedFetch([
      {
        body: authoritativeConfig,
        expect: { pathname: "/v6/domains/dk-live.example.com/config" },
      },
      {
        body: domainEnvelope,
        expect: { pathname: "/v5/domains/dk-live.example.com" },
      },
      {
        body: {
          pagination: { count: 2, next: null, prev: null },
          records: [record("TXT", "outside", "ignored"), record("TXT", "inside.dk-live", "kept")],
        },
        expect: { pathname: "/v5/domains/example.com/records" },
      },
    ]);
    const client = make(recording.fetch, { _tag: "team", teamId: "team-1" });
    return Effect.gen(function* () {
      assert.deepStrictEqual(
        (yield* client.listRecords(zone)).map(({ name }) => name),
        [DomainName.parse("inside.dk-live.example.com")],
      );
      assert.ok(recording.requests.every(({ url }) => url.includes("teamId=team-1")));

      const external = make(
        recordedFetch([
          { body: { misconfigured: false, serviceType: "external" } },
          {
            body: {
              domain: {
                ...domain,
                intendedNameservers: [],
                serviceType: "external",
                zone: false,
              },
            },
          },
        ]).fetch,
        { _tag: "team", teamId: "team-1" },
      );
      const failure = yield* external.listRecords(zone).pipe(Effect.flip);
      assert.strictEqual(failure.reason, "not_found");
    });
  });

  it.effect("creates delegated-zone records relative to Vercel's storage zone", () => {
    const recording = recordedFetch([
      {
        body: authoritativeConfig,
        expect: { pathname: "/v6/domains/dk-live.example.com/config" },
      },
      {
        body: domainEnvelope,
        expect: { pathname: "/v5/domains/dk-live.example.com" },
      },
      {
        body: { uid: "delegated-record" },
        expect: { method: "POST", pathname: "/v2/domains/example.com/records" },
      },
    ]);
    const client = make(recording.fetch, { _tag: "team", teamId: "team-1" });
    return Effect.gen(function* () {
      yield* client.createRecord(
        DomainName.parse("dk-live.example.com"),
        DnsRecord.parse({
          _tag: "TXT",
          metadata: { ownership: "customer", provenance: "test", purpose: "verification" },
          name: "_probe.dk-live.example.com",
          policy: "append",
          ttl: 300,
          value: "delegated-zone",
        }),
      );
      assert.deepStrictEqual(JSON.parse(String(recording.requests[2]?.init?.body)), {
        name: "_probe.dk-live",
        ttl: 300,
        type: "TXT",
        value: "delegated-zone",
      });
    });
  });

  it.effect("creates records in an external Vercel DNS storage zone", () => {
    const storageZone = {
      ...domain,
      nameservers: ["external.example.net"],
      serviceType: "external",
    };
    const recording = recordedFetch([
      {
        body: { misconfigured: false, serviceType: "external" },
        expect: { pathname: "/v6/domains/example.com/config" },
      },
      {
        body: { domain: storageZone },
        expect: { pathname: "/v5/domains/example.com" },
      },
      {
        body: { uid: "storage-record" },
        expect: { method: "POST", pathname: "/v2/domains/example.com/records" },
      },
    ]);
    const client = make(recording.fetch, { _tag: "team", teamId: "team-1" });
    return Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* client.createRecord(
          DomainName.parse("example.com"),
          DnsRecord.parse({
            _tag: "TXT",
            metadata: { ownership: "customer", provenance: "test", purpose: "verification" },
            name: "mail.example.com",
            policy: "append",
            ttl: 300,
            value: "storage-zone",
          }),
        ),
        { providerRecordId: "storage-record" },
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
