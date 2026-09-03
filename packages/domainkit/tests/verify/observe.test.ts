import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect } from "effect";
import { TestClock } from "effect/testing";

import { Connect, DnsRecord, DomainKit, Principal, Provision, Verify } from "../../src/index.ts";
import { Testing } from "../../src/entry/testing.ts";

const requirements = [
  DnsRecord.cname({ name: "app.example.com", target: "edge.acme.dev" }),
  DnsRecord.txt({ name: "_acme.app.example.com", value: "acme-verify=7f3a" }),
];

const withPrincipal = Effect.provideService(Principal.Principal, Testing.principal);

const connectAndApply = Effect.gen(function* () {
  yield* Connect.start({
    provider: "fake",
    method: Connect.Method.token("t"),
    domain: "app.example.com",
  });
  const plan = yield* Provision.plan({ domain: "app.example.com", requirements });
  return yield* Provision.apply(yield* Provision.approve(plan));
});

describe("Verify", () => {
  it.effect("reports ready when provider and public DNS both hold the applied records", () => {
    const fake = Testing.provider({ zones: ["example.com"] });
    return Effect.gen(function* () {
      yield* connectAndApply;
      const readiness = yield* Verify.observe({ domain: "app.example.com" });
      assert.strictEqual(readiness.overall, "ready");
      assert.strictEqual(readiness.nextCheckAt, null);
      assert.deepStrictEqual(
        readiness.requirements.map(({ status }) => status),
        ["satisfied", "satisfied"],
      );
      assert.deepStrictEqual(
        readiness.requirements[0]?.evidence.map((evidence) => [evidence._tag, evidence.status]),
        [
          ["Provider", "satisfied"],
          ["PublicDns", "satisfied"],
        ],
      );
      assert.ok(readiness.requirements.every(({ operationId }) => operationId !== null));
      const latest = yield* Verify.latest("app.example.com");
      assert.strictEqual(latest?.overall, "ready");
      assert.strictEqual(latest?.requirements.length, 2);
    }).pipe(
      withPrincipal,
      Effect.provide(DomainKit.layerMemory({ providers: [fake], resolver: Testing.resolver() })),
    );
  });

  it.effect(
    "stays pending with a backoff ladder while public DNS lags, then merges host evidence",
    () => {
      const fake = Testing.provider({ zones: ["example.com"] });
      return Effect.gen(function* () {
        yield* connectAndApply;
        const first = yield* Verify.observe({ domain: "app.example.com" });
        assert.strictEqual(first.overall, "pending");
        assert.deepStrictEqual(
          first.requirements.map(({ status }) => status),
          ["missing", "missing"],
        );
        const now = yield* DateTime.now;
        assert.strictEqual(
          DateTime.toEpochMillis(first.nextCheckAt ?? now) - DateTime.toEpochMillis(now),
          15_000,
        );
        yield* TestClock.adjust("2 minutes");
        const second = yield* Verify.observe({ domain: "app.example.com" });
        const later = yield* DateTime.now;
        assert.strictEqual(
          DateTime.toEpochMillis(second.nextCheckAt ?? later) - DateTime.toEpochMillis(later),
          60_000,
        );
        yield* TestClock.adjust("20 minutes");
        const third = yield* Verify.observe({ domain: "app.example.com" });
        const evenLater = yield* DateTime.now;
        assert.strictEqual(
          DateTime.toEpochMillis(third.nextCheckAt ?? evenLater) -
            DateTime.toEpochMillis(evenLater),
          5 * 60_000,
        );
        const withHost = yield* Verify.attachEvidence({
          domain: "app.example.com",
          evidence: [
            new Verify.HostEvidence({
              source: "ses",
              status: "failed",
              label: "SES identity",
              observedAt: evenLater,
            }),
          ],
        });
        assert.strictEqual(withHost.overall, "failed");
        assert.strictEqual(withHost.host.length, 1);
        const replaced = yield* Verify.attachEvidence({
          domain: "app.example.com",
          evidence: [
            new Verify.HostEvidence({
              source: "ses",
              status: "pending",
              label: "SES identity",
              observedAt: evenLater,
            }),
          ],
        });
        assert.strictEqual(replaced.overall, "pending");
        assert.strictEqual(replaced.host[0]?.status, "pending");
        assert.strictEqual(replaced.requirements.length, 2);
      }).pipe(
        withPrincipal,
        Effect.provide(
          DomainKit.layerMemory({ providers: [fake], resolver: Testing.resolver([]) }),
        ),
      );
    },
  );

  it.effect("fails on a mismatch for exclusive records and observes explicit requirements", () => {
    const fake = Testing.provider({
      zones: ["example.com"],
      records: [
        {
          zone: "example.com",
          record: DnsRecord.cname({ name: "app.example.com", target: "other.acme.dev" }),
        },
      ],
    });
    return Effect.gen(function* () {
      yield* Connect.start({
        provider: "fake",
        method: Connect.Method.token("t"),
        domain: "app.example.com",
      });
      const none = yield* Verify.observe({ domain: "app.example.com" }).pipe(Effect.flip);
      assert.strictEqual(none.reason._tag, "InvalidInput");
      const readiness = yield* Verify.observe({ domain: "app.example.com", requirements });
      assert.strictEqual(readiness.overall, "failed");
      assert.deepStrictEqual(
        readiness.requirements.map(({ status }) => status),
        ["mismatch", "missing"],
      );
      assert.strictEqual(readiness.requirements[0]?.operationId, null);
      const unattached = yield* Verify.observe({ domain: "nobody.example.com", requirements }).pipe(
        Effect.flip,
      );
      assert.strictEqual(unattached.reason._tag, "NotFound");
    }).pipe(
      withPrincipal,
      Effect.provide(DomainKit.layerMemory({ providers: [fake], resolver: Testing.resolver() })),
    );
  });

  it.effect("requires every resolver under the all quorum", () => {
    const fake = Testing.provider({ zones: ["example.com"] });
    return Effect.gen(function* () {
      yield* connectAndApply;
      const any = yield* Verify.observe({ domain: "app.example.com" });
      assert.strictEqual(any.overall, "ready");
      const all = yield* Verify.observe({ domain: "app.example.com" }).pipe(
        Effect.provideService(Verify.Policy, { ...Verify.defaults, quorum: "all" }),
      );
      assert.strictEqual(all.overall, "ready");
      const strict = yield* Verify.observe({ domain: "app.example.com" }).pipe(
        Effect.provideService(Verify.Policy, { ...Verify.defaults, quorum: { minimum: 2 } }),
      );
      assert.strictEqual(strict.overall, "pending");
    }).pipe(
      withPrincipal,
      Effect.provide(DomainKit.layerMemory({ providers: [fake], resolver: Testing.resolver() })),
    );
  });
});
