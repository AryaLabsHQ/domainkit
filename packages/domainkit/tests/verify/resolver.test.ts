import * as DnsPacket from "@leichtgewicht/dns-packet";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { DnsRecord, Resolver } from "../../src/index.ts";

const wire = (packet: Omit<DnsPacket.Packet, "type" | "id">): Response =>
  new Response(
    Uint8Array.from(
      DnsPacket.encode({
        ...packet,
        flags: (packet.flags ?? 0) | (packet.rcode === undefined ? 0 : rcodeFlag(packet.rcode)),
        id: 0,
        type: "response",
      }),
    ),
    { headers: { "content-type": "application/dns-message" } },
  );

const rcodeFlag = (rcode: string): number =>
  rcode === "SERVFAIL" ? 2 : rcode === "NXDOMAIN" ? 3 : 0;

const question = { class: "IN", name: "example.com", type: "MX" } as const;

describe("Resolver", () => {
  it.effect("queries every endpoint over RFC 8484 wire format and canonicalizes answers", () =>
    Effect.gen(function* () {
      const bodies: Array<Uint8Array> = [];
      const service = yield* Resolver.make({
        endpoints: [
          { name: "one", url: "https://one.example/dns-query" },
          { name: "two", url: "https://two.example/dns-query" },
        ],
        fetch: async (input, init) => {
          bodies.push(init?.body as Uint8Array);
          assert.strictEqual(init?.method, "POST");
          return String(input).startsWith("https://one")
            ? wire({
                questions: [question],
                answers: [
                  {
                    class: "IN",
                    data: { exchange: "MAIL.Example.COM.", preference: 10 },
                    name: "Example.COM.",
                    ttl: 300,
                    type: "MX",
                  },
                  {
                    class: "IN",
                    data: "host.example.com",
                    name: "example.com",
                    ttl: 300,
                    type: "PTR",
                  },
                ],
              })
            : wire({ questions: [question], answers: [], rcode: "NXDOMAIN" });
        },
      });
      const outcomes = yield* service.resolve("Example.com.", "MX");
      assert.strictEqual(outcomes.length, 2);
      const [one, two] = outcomes;
      assert.strictEqual(one?._tag, "Answered");
      if (one?._tag === "Answered") {
        assert.strictEqual(one.answer.resolver, "one");
        assert.strictEqual(one.answer.negative, false);
        assert.strictEqual(one.answer.ttl, 300);
        assert.deepStrictEqual(
          one.answer.records.map((record) =>
            record._tag === "Opaque" ? record.type : DnsRecord.data(record),
          ),
          ["10 mail.example.com", "PTR"],
        );
      }
      assert.strictEqual(two?._tag, "Answered");
      if (two?._tag === "Answered") assert.strictEqual(two.answer.negative, true);
      const decoded = DnsPacket.decode(bodies[0] ?? new Uint8Array());
      assert.deepStrictEqual(decoded.questions, [{ class: "IN", name: "example.com", type: "MX" }]);
    }),
  );

  it.live("keeps failures and timeouts per resolver instead of failing", () =>
    Effect.gen(function* () {
      const service = yield* Resolver.make({
        endpoints: [
          { name: "broken", url: "https://broken.example/dns-query" },
          { name: "slow", url: "https://slow.example/dns-query" },
          { name: "wrong", url: "https://wrong.example/dns-query" },
        ],
        timeoutMs: 20,
        fetch: async (input, init) => {
          if (String(input).startsWith("https://broken")) throw new Error("connection refused");
          if (String(input).startsWith("https://slow")) {
            await new Promise((resolve, reject) => {
              const timer = setTimeout(resolve, 200);
              init?.signal?.addEventListener("abort", () => {
                clearTimeout(timer);
                reject(new Error("aborted"));
              });
            });
            return wire({ questions: [question], answers: [] });
          }
          return wire({ questions: [{ ...question, type: "TXT" }], answers: [] });
        },
      });
      const outcomes = yield* service.resolve("example.com", "MX");
      assert.deepStrictEqual(
        outcomes.map((outcome) => outcome._tag),
        ["Failed", "TimedOut", "Failed"],
      );
      const invalid = yield* service.resolve("not a host", "A");
      assert.ok(invalid.every((outcome) => outcome._tag === "Failed"));
    }),
  );

  it.effect("rejects responses that do not match the query at the wire boundary", () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<[string, () => Response, RegExp]> = [
        [
          "message id",
          () =>
            new Response(
              Uint8Array.from(
                DnsPacket.encode({ questions: [question], answers: [], id: 7, type: "response" }),
              ),
              { headers: { "content-type": "application/dns-message" } },
            ),
          /message ID/,
        ],
        [
          "question class",
          () => wire({ questions: [{ ...question, class: "CH" }], answers: [] }),
          /did not match/,
        ],
        [
          "question type",
          () => wire({ questions: [{ ...question, type: "TXT" }], answers: [] }),
          /did not match/,
        ],
        [
          "truncation",
          () => wire({ questions: [question], answers: [], flags: DnsPacket.TRUNCATED_RESPONSE }),
          /truncated/,
        ],
        [
          "servfail",
          () => wire({ questions: [question], answers: [], rcode: "SERVFAIL" }),
          /SERVFAIL/,
        ],
        [
          "malformed",
          () =>
            new Response(Uint8Array.from([0, 1, 2]), {
              headers: { "content-type": "application/dns-message" },
            }),
          /invalid DNS message/,
        ],
        [
          "content type",
          () => new Response("{}", { headers: { "content-type": "application/json" } }),
          /content type/,
        ],
      ];
      for (const [label, respond, pattern] of cases) {
        const service = yield* Resolver.make({
          endpoints: [{ name: label, url: "https://one.example/dns-query" }],
          fetch: async () => respond(),
        });
        const [outcome] = yield* service.resolve("example.com", "MX");
        assert.strictEqual(outcome?._tag, "Failed", label);
        if (outcome?._tag === "Failed") assert.match(outcome.message, pattern, label);
      }
    }),
  );

  it.effect("joins TXT character strings and decodes CAA and SRV data", () =>
    Effect.gen(function* () {
      const service = yield* Resolver.make({
        endpoints: [{ name: "one", url: "https://one.example/dns-query" }],
        fetch: async (_input, init) => {
          const query = DnsPacket.decode(init?.body as Uint8Array);
          const type = query.questions?.[0]?.type;
          return wire({
            questions: query.questions ?? [],
            answers:
              type === "TXT"
                ? [
                    {
                      class: "IN",
                      data: [new TextEncoder().encode("hello "), new TextEncoder().encode("world")],
                      name: "example.com",
                      ttl: 60,
                      type: "TXT",
                    },
                  ]
                : type === "CAA"
                  ? [
                      {
                        class: "IN",
                        data: { flags: 128, tag: "issue", value: "letsencrypt.org" },
                        name: "example.com",
                        ttl: 60,
                        type: "CAA",
                      },
                    ]
                  : [
                      {
                        class: "IN",
                        data: { port: 5060, priority: 10, target: "sip.example.com", weight: 5 },
                        name: "_sip._tcp.example.com",
                        ttl: 60,
                        type: "SRV",
                      },
                    ],
          });
        },
      });
      const data = (outcomes: ReadonlyArray<Resolver.Outcome>) =>
        outcomes[0]?._tag === "Answered"
          ? outcomes[0].answer.records.map((record) =>
              record._tag === "Opaque" ? record.type : DnsRecord.data(record),
            )
          : [];
      assert.deepStrictEqual(data(yield* service.resolve("example.com", "TXT")), ["hello world"]);
      assert.deepStrictEqual(data(yield* service.resolve("example.com", "CAA")), [
        "128 issue letsencrypt.org",
      ]);
      assert.deepStrictEqual(data(yield* service.resolve("_sip._tcp.example.com", "SRV")), [
        "10 5 5060 sip.example.com",
      ]);
    }),
  );

  it.effect("honours a host-supplied abort signal", () =>
    Effect.gen(function* () {
      const controller = new AbortController();
      controller.abort(new Error("host cancelled"));
      const service = yield* Resolver.make({
        endpoints: [{ name: "one", url: "https://one.example/dns-query" }],
        fetch: async (_input, init) => {
          if (init?.signal?.aborted === true) throw init.signal.reason;
          return wire({ questions: [question], answers: [] });
        },
      });
      const [outcome] = yield* service.resolve("example.com", "MX", { signal: controller.signal });
      assert.strictEqual(outcome?._tag, "Failed");
      if (outcome?._tag === "Failed") assert.match(outcome.message, /host cancelled/);
    }),
  );

  it("ships Cloudflare and Google as the default pool", () => {
    assert.deepStrictEqual(
      Resolver.defaults.endpoints.map(({ name }) => name),
      ["cloudflare", "google"],
    );
    assert.strictEqual(Resolver.cloudflare.url, "https://cloudflare-dns.com/dns-query");
    assert.strictEqual(Resolver.google.url, "https://dns.google/dns-query");
  });

  it.effect("rejects invalid endpoint URLs", () =>
    Effect.gen(function* () {
      const failure = yield* Resolver.make({ endpoints: [{ name: "x", url: "nope" }] }).pipe(
        Effect.flip,
      );
      assert.strictEqual(failure.reason._tag, "InvalidInput");
    }),
  );
});
