import * as DnsPacket from "@leichtgewicht/dns-packet";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { CloudflareDnsOverHttps, DnsOverHttps, DomainName } from "../../src/index.ts";
import { DnsOverHttps as AsyncDnsOverHttps } from "../../src/promise.ts";

const endpoint = "https://resolver.example/dns-query";

describe("DNS over HTTPS", () => {
  it.effect("uses RFC 8484 wireformat and canonicalizes structured answers", () => {
    const resolver = DnsOverHttps.make({
      endpoint,
      fetch: async (input, init) => {
        assert.strictEqual(String(input), endpoint);
        assert.strictEqual(init?.method, "POST");
        assert.deepStrictEqual(init?.headers, {
          accept: "application/dns-message",
          "content-type": "application/dns-message",
        });
        assert.ok(init?.body instanceof Uint8Array);
        const query = DnsPacket.decode(init.body);
        assert.deepStrictEqual(query.questions, [{ class: "IN", name: "example.com", type: "MX" }]);
        return wireResponse({
          answers: [
            {
              class: "IN",
              data: { exchange: "MAIL.Example.COM.", preference: 10 },
              name: "Example.COM.",
              ttl: 300,
              type: "MX",
            },
          ],
          questions: query.questions,
        });
      },
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

  it.effect("decodes CAA fields without relying on JSON presentation formatting", () => {
    const resolver = resolverFor({
      data: { flags: 128, tag: "issue", value: "letsencrypt.org" },
      name: "example.com",
      ttl: 60,
      type: "CAA",
    });
    return Effect.gen(function* () {
      const resolution = yield* resolver.resolve({
        name: DomainName.parse("example.com"),
        type: "CAA",
      });
      assert.deepStrictEqual(resolution, {
        _tag: "answer",
        answers: [
          {
            data: "128 issue letsencrypt.org",
            name: DomainName.parse("example.com"),
            ttl: 60,
            type: "CAA",
          },
        ],
      });
    });
  });

  it.effect("joins multiple TXT character strings before decoding UTF-8", () => {
    const resolver = resolverFor({
      data: [new TextEncoder().encode("hello "), new TextEncoder().encode("world")],
      name: "example.com",
      ttl: 60,
      type: "TXT",
    });
    return Effect.gen(function* () {
      const resolution = yield* resolver.resolve({
        name: DomainName.parse("example.com"),
        type: "TXT",
      });
      assert.deepStrictEqual(resolution, {
        _tag: "answer",
        answers: [
          {
            data: "hello world",
            name: DomainName.parse("example.com"),
            ttl: 60,
            type: "TXT",
          },
        ],
      });
    });
  });

  it("maps NXDOMAIN to no data through the Promise facade", async () => {
    const resolver = CloudflareDnsOverHttps.toAsync({
      fetch: async (_input, init) => {
        assert.ok(init?.body instanceof Uint8Array);
        const query = DnsPacket.decode(init.body);
        return wireResponse({ questions: query.questions, rcode: "NXDOMAIN" });
      },
    });
    assert.deepStrictEqual(
      await resolver.resolve({ name: DomainName.parse("example.com"), type: "A" }),
      { _tag: "nodata" },
    );
  });

  it("preserves timeout classification through the Promise facade", async () => {
    const resolver = AsyncDnsOverHttps.make({
      endpoint,
      timeoutMs: 1,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal == null) throw new Error("Expected a request abort signal");
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    });
    assert.deepStrictEqual(
      await resolver.resolve({ name: DomainName.parse("example.com"), type: "A" }),
      { _tag: "timeout" },
    );
  });

  it.effect("keeps resolver failures distinct from no data", () => {
    const resolver = DnsOverHttps.make({
      endpoint,
      fetch: async (_input, init) => {
        assert.ok(init?.body instanceof Uint8Array);
        const query = DnsPacket.decode(init.body);
        return wireResponse({ questions: query.questions, rcode: "SERVFAIL" });
      },
    });
    return Effect.gen(function* () {
      const failure = yield* resolver
        .resolve({ name: DomainName.parse("example.com"), type: "A" })
        .pipe(Effect.flip);
      assert.strictEqual(failure.reason, "response");
      assert.match(failure.message, /SERVFAIL/);
    });
  });

  it.effect("rejects malformed DNS messages at the wire boundary", () => {
    const resolver = DnsOverHttps.make({
      endpoint,
      fetch: async () =>
        new Response(Uint8Array.from([0, 1, 2]), {
          headers: { "content-type": "application/dns-message" },
        }),
    });
    return Effect.gen(function* () {
      const failure = yield* resolver
        .resolve({ name: DomainName.parse("example.com"), type: "A" })
        .pipe(Effect.flip);
      assert.strictEqual(failure.reason, "response");
      assert.match(failure.message, /invalid DNS message/);
    });
  });
});

function resolverFor(answer: DnsPacket.Answer) {
  return DnsOverHttps.make({
    endpoint,
    fetch: async (_input, init) => {
      assert.ok(init?.body instanceof Uint8Array);
      const query = DnsPacket.decode(init.body);
      return wireResponse({ answers: [answer], questions: query.questions });
    },
  });
}

function wireResponse(packet: Pick<DnsPacket.Packet, "answers" | "questions" | "rcode">): Response {
  return new Response(
    Uint8Array.from(
      DnsPacket.encode({
        answers: packet.answers,
        flags:
          DnsPacket.RECURSION_DESIRED |
          DnsPacket.RECURSION_AVAILABLE |
          responseCode(packet.rcode ?? "NOERROR"),
        id: 0,
        questions: packet.questions,
        rcode: packet.rcode ?? "NOERROR",
        type: "response",
      }),
    ),
    { headers: { "content-type": "application/dns-message" } },
  );
}

function responseCode(rcode: DnsPacket.RecordClass): number {
  switch (rcode) {
    case "NOERROR":
      return 0;
    case "SERVFAIL":
      return 2;
    case "NXDOMAIN":
      return 3;
    default:
      throw new Error(`Unsupported test response code ${rcode}`);
  }
}
