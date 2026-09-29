import * as DnsPacket from "@leichtgewicht/dns-packet";
import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Layer } from "effect";

import { Connect, DnsRecord, DomainKit, Principal, Resolver, Verify } from "../../src/index.ts";
import { TestClock } from "effect/testing";

import { Testing } from "../../src/entry/testing.ts";

const name = "mail.example.com";
const spf = DnsRecord.spf({ name, value: "v=spf1 -all" });
const exact = DnsRecord.txt({ name, value: spf.value });
const different = DnsRecord.txt({ name, value: "V=SPF1 ~all" });
const unrelated = DnsRecord.txt({ name, value: "verify=ok" });
const cname = DnsRecord.cname({ name, target: "edge.example.net" });
const opaque = new DnsRecord.Opaque({ name, type: "TXT", raw: "empty TXT" });

const wireRecord = (record: DnsRecord.Observed): DnsPacket.Answer => {
  if (record._tag === "CNAME")
    return { class: "IN", name, type: "CNAME", ttl: 60, data: record.target };
  if (record._tag === "TXT")
    return { class: "IN", name, type: "TXT", ttl: 60, data: [record.value] };
  if (record._tag === "Opaque") return { class: "IN", name, type: "TXT", ttl: 60, data: [""] };
  throw new Error(`Unscripted wire record ${record._tag}`);
};

const cases = [
  {
    label: "single matching SPF with unrelated TXT",
    requirement: spf,
    records: [exact, unrelated],
    status: "satisfied",
  },
  {
    label: "missing SPF with unrelated TXT",
    requirement: spf,
    records: [unrelated],
    status: "missing",
  },
  { label: "different SPF", requirement: spf, records: [different], status: "mismatch" },
  {
    label: "matching and different SPF",
    requirement: spf,
    records: [exact, different],
    status: "mismatch",
  },
  {
    label: "identical duplicate SPF",
    requirement: spf,
    records: [exact, exact],
    status: "mismatch",
  },
  {
    label: "exclusive exact and different",
    requirement: DnsRecord.txt({ name, value: exact.value, policy: "exclusive" }),
    records: [exact, unrelated],
    status: "mismatch",
  },
  {
    label: "append exact and different",
    requirement: exact,
    records: [exact, unrelated],
    status: "satisfied",
  },
  { label: "opaque and exact", requirement: spf, records: [exact, opaque], status: "mismatch" },
  { label: "CNAME and exact TXT", requirement: spf, records: [exact, cname], status: "mismatch" },
  {
    label: "exact CNAME and TXT",
    requirement: cname,
    records: [cname, unrelated],
    status: "mismatch",
  },
  {
    label: "SPF token boundary",
    requirement: spf,
    records: [exact, DnsRecord.txt({ name, value: "v=spf10 -all" })],
    status: "satisfied",
  },
] as const;

describe("provider and public DNS safety evidence", () => {
  for (const test of cases) {
    it.effect(`agrees on ${test.label} through actual DNS decoding`, () => {
      const fake = Testing.provider({
        zones: ["example.com"],
        records: test.records.map((record) => ({ zone: "example.com", record })),
      });
      const resolver = Resolver.layerWith({
        endpoints: [{ name: "wire", url: "https://resolver.test/dns-query" }],
        fetch: async () =>
          new Response(
            Uint8Array.from(
              DnsPacket.encode({
                type: "response",
                id: 0,
                flags: DnsPacket.RECURSION_AVAILABLE,
                questions: [{ class: "IN", name, type: test.requirement._tag }],
                answers: test.records.map(wireRecord),
              }),
            ),
            { headers: { "content-type": "application/dns-message" } },
          ),
      }).pipe(Layer.orDie);
      return Effect.gen(function* () {
        yield* Connect.start({
          provider: fake.id,
          method: Connect.Method.token("t"),
          domain: name,
        });
        const observed = yield* Verify.observe({ domain: name, requirements: [test.requirement] });
        assert.strictEqual(observed.requirements[0]?.status, test.status);
        assert.deepStrictEqual(
          observed.requirements[0]?.evidence.map(({ _tag, status }) => [_tag, status]),
          [
            ["Provider", test.status],
            ["PublicDns", test.status],
          ],
        );
        const publicOnly = yield* Verify.observe({
          domain: "standalone.example.net",
          requirements: [test.requirement],
        });
        assert.strictEqual(publicOnly.requirements[0]?.status, test.status);
        assert.deepStrictEqual(
          publicOnly.requirements[0]?.evidence.map(({ _tag }) => _tag),
          ["PublicDns"],
        );
      }).pipe(
        Effect.provideService(Principal.Service, Testing.principal),
        Effect.provide(DomainKit.layerMemory({ providers: [fake], resolver })),
      );
    });
  }

  it.effect("restarts pending backoff when TXT gains the SPF constraint", () => {
    const fake = Testing.provider({ zones: ["example.com"] });
    return Effect.gen(function* () {
      yield* Verify.observe({ domain: name, requirements: [exact] });
      yield* TestClock.adjust("30 minutes");
      const same = yield* Verify.observe({ domain: name, requirements: [exact] });
      const now = yield* DateTime.now;
      assert.strictEqual(
        DateTime.toEpochMillis(same.nextCheckAt ?? now) - DateTime.toEpochMillis(now),
        5 * 60_000,
      );
      const constrained = yield* Verify.observe({ domain: name, requirements: [spf] });
      assert.strictEqual(
        DateTime.toEpochMillis(constrained.nextCheckAt ?? now) - DateTime.toEpochMillis(now),
        15_000,
      );
      assert.deepStrictEqual(constrained.requirements[0]?.record, spf);
    }).pipe(
      Effect.provideService(Principal.Service, Testing.principal),
      Effect.provide(DomainKit.layerMemory({ providers: [fake], resolver: Testing.resolver([]) })),
    );
  });
});
