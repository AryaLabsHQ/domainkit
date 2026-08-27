import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { CloudflareDnsOverHttps, DomainName } from "../../src/effect.ts";

describe("Cloudflare DNS over HTTPS", () => {
  it.effect("schema-decodes and canonicalizes provider answers", () => {
    const resolver = CloudflareDnsOverHttps.make({
      fetch: async () =>
        Response.json({
          Answer: [{ data: "10 MAIL.Example.COM.", name: "Example.COM.", TTL: 300, type: 15 }],
          Status: 0,
        }),
    });
    return Effect.gen(function* () {
      const resolution = yield* resolver.resolve({
        name: DomainName.parse("example.com"),
        type: "MX",
      });
      assert.deepStrictEqual(resolution, {
        _tag: "answer",
        answers: [
          {
            data: "10 mail.example.com",
            name: DomainName.parse("example.com"),
            ttl: 300,
            type: "MX",
          },
        ],
      });
    });
  });

  it("exposes an ordinary async resolver adapter", async () => {
    const resolver = CloudflareDnsOverHttps.toAsync({
      fetch: async () => Response.json({ Status: 3 }),
    });
    assert.deepStrictEqual(
      await resolver.resolve({ name: DomainName.parse("example.com"), type: "A" }),
      { _tag: "nodata" },
    );
  });

  it.effect("rejects malformed DoH JSON at the schema boundary", () => {
    const resolver = CloudflareDnsOverHttps.make({
      fetch: async () => Response.json({ Answer: [{ data: 42 }], Status: 0 }),
    });
    return Effect.gen(function* () {
      const failure = yield* resolver
        .resolve({ name: DomainName.parse("example.com"), type: "A" })
        .pipe(Effect.flip);
      assert.strictEqual(failure._tag, "ResolverError");
      assert.match(failure.message, /invalid JSON/);
    });
  });
});
