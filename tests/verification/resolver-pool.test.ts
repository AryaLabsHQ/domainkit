import * as DnsPacket from "@leichtgewicht/dns-packet";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { DnsResolverPool, DomainName } from "../../src/effect.ts";
import { DnsResolverPool as AsyncDnsResolverPool } from "../../src/index.ts";
import { InMemoryDnsResolver } from "../../src/testing.ts";

const query = { name: DomainName.parse("example.com"), type: "TXT" as const };

describe("DnsResolverPool", () => {
  it.effect("preserves named disagreement from concurrent resolvers", () => {
    const pool = DnsResolverPool.make([
      {
        id: "cloudflare",
        resolver: InMemoryDnsResolver.make(() => ({ _tag: "nodata" })),
      },
      {
        id: "google",
        resolver: InMemoryDnsResolver.make(() => ({
          _tag: "answer",
          answers: [{ data: "domainkit", name: query.name, ttl: 60, type: query.type }],
        })),
      },
    ]);
    return Effect.gen(function* () {
      const observations = yield* pool.observe(query);
      assert.deepStrictEqual(
        observations.map(({ _tag, resolverId }) => ({ _tag, resolverId })),
        [
          { _tag: "NoData", resolverId: "cloudflare" },
          { _tag: "Answer", resolverId: "google" },
        ],
      );
    });
  });

  it("records independent timeouts without discarding successful answers", async () => {
    const pool = DnsResolverPool.make([
      { id: "slow", resolver: { resolve: () => Effect.never }, timeoutMs: 1 },
      {
        id: "fast",
        resolver: InMemoryDnsResolver.make(() => ({ _tag: "nodata" })),
      },
    ]);
    await Effect.runPromise(
      Effect.gen(function* () {
        const observations = yield* pool.observe(query);
        assert.deepStrictEqual(
          observations.map(({ _tag, resolverId }) => ({ _tag, resolverId })),
          [
            { _tag: "TimedOut", resolverId: "slow" },
            { _tag: "NoData", resolverId: "fast" },
          ],
        );
      }),
    );
  });

  it.effect("uses Cloudflare and Google wire-format DoH in the default pool", () => {
    const endpoints: Array<string> = [];
    const pool = DnsResolverPool.defaultMake({
      fetch: async (input, init) => {
        endpoints.push(String(input));
        assert.ok(init?.body instanceof Uint8Array);
        const packet = DnsPacket.decode(init.body);
        return wireResponse(packet.questions ?? []);
      },
    });
    return Effect.gen(function* () {
      const observations = yield* pool.observe(query);
      assert.deepStrictEqual(endpoints.sort(), [
        "https://cloudflare-dns.com/dns-query",
        "https://dns.google/dns-query",
      ]);
      assert.deepStrictEqual(
        observations.map(({ _tag, resolverId }) => ({ _tag, resolverId })),
        [
          { _tag: "NoData", resolverId: "cloudflare" },
          { _tag: "NoData", resolverId: "google" },
        ],
      );
    });
  });

  it("preserves resolver evidence through the Promise facade", async () => {
    const pool = AsyncDnsResolverPool.make([
      {
        id: "cloudflare",
        resolver: InMemoryDnsResolver.toAsync(() => ({ _tag: "nodata" })),
      },
    ]);
    const observations = await pool.observe(query);
    assert.strictEqual(observations[0]?._tag, "NoData");
    assert.strictEqual(observations[0]?.resolverId, "cloudflare");
  });

  it("exposes explicit tagged policy values", () => {
    assert.deepStrictEqual(DnsResolverPool.Policy.AnyMatch(), { _tag: "AnyMatch" });
    assert.deepStrictEqual(DnsResolverPool.Policy.AllMatch(), { _tag: "AllMatch" });
    assert.deepStrictEqual(DnsResolverPool.Policy.Quorum({ minimum: 2 }), {
      _tag: "Quorum",
      minimum: 2,
    });
  });
});

function wireResponse(questions: ReadonlyArray<DnsPacket.Question>): Response {
  return new Response(
    Uint8Array.from(
      DnsPacket.encode({
        answers: [],
        flags: DnsPacket.RECURSION_DESIRED | DnsPacket.RECURSION_AVAILABLE,
        id: 0,
        questions: [...questions],
        rcode: "NOERROR",
        type: "response",
      }),
    ),
    { headers: { "content-type": "application/dns-message" } },
  );
}
