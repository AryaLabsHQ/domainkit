import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Layer, Logger } from "effect";

import { Connect, DnsRecord, DomainKit, Principal, Provision, Verify } from "../../src/index.ts";
import { Testing } from "../../src/entry/testing.ts";

const requirements = [DnsRecord.cname({ name: "app.example.com", target: "edge.acme.dev" })];

const withPrincipal = Effect.provideService(Principal.Service, Testing.principal);

const connectAndApply = Effect.gen(function* () {
  yield* Connect.start({
    provider: "fake",
    method: Connect.Method.token("t"),
    domain: "app.example.com",
  });
  const plan = yield* Provision.plan({ domain: "app.example.com", requirements });
  return yield* Provision.apply(yield* Provision.approve(plan));
});

const live = () =>
  DomainKit.layerMemory({
    providers: [Testing.provider({ zones: ["example.com"] })],
    resolver: Testing.resolver(),
  });

describe("Verify.Observer", () => {
  it.effect("fires after every stored readiness, with the cause that wrote it", () => {
    const seen: Array<{ domain: string; cause: Verify.Cause; overall: string }> = [];
    const observer: Verify.ObserverShape = {
      readinessChanged: ({ cause, domain, readiness }) =>
        Effect.sync(() => {
          seen.push({ cause, domain, overall: readiness.overall });
        }),
    };
    return Effect.gen(function* () {
      yield* connectAndApply;
      const observed = yield* Verify.observe({ domain: "app.example.com" });
      const observedAt = yield* DateTime.now;
      yield* Verify.attachEvidence({
        domain: "app.example.com",
        evidence: [
          new Verify.HostEvidence({
            source: "edge-certificate",
            status: "pending",
            label: "TLS certificate",
            detail: null,
            observedAt,
          }),
        ],
      });
      assert.deepStrictEqual(seen, [
        { cause: "observe", domain: "app.example.com", overall: observed.overall },
        { cause: "evidence", domain: "app.example.com", overall: "pending" },
      ]);
    }).pipe(
      withPrincipal,
      Effect.provideService(Verify.Observer, observer),
      Effect.provide(live()),
    );
  });

  it.effect("carries the readiness the caller receives", () => {
    let event: Verify.ReadinessChanged | null = null;
    const observer: Verify.ObserverShape = {
      readinessChanged: (input) =>
        Effect.sync(() => {
          event = input;
        }),
    };
    return Effect.gen(function* () {
      yield* connectAndApply;
      const readiness = yield* Verify.observe({ domain: "app.example.com" });
      assert.deepStrictEqual(event, {
        cause: "observe",
        domain: "app.example.com",
        readiness,
      });
    }).pipe(
      withPrincipal,
      Effect.provideService(Verify.Observer, observer),
      Effect.provide(live()),
    );
  });

  it.effect("keeps the observation when the observer fails or dies", () => {
    const observer: Verify.ObserverShape = {
      readinessChanged: ({ cause }) =>
        cause === "observe"
          ? Effect.fail(new Error("projection rejected"))
          : Effect.die(new Error("projection exploded")),
    };
    return Effect.gen(function* () {
      yield* connectAndApply;
      const readiness = yield* Verify.observe({ domain: "app.example.com" });
      assert.strictEqual(readiness.overall, "ready");
      const observedAt = yield* DateTime.now;
      yield* Verify.attachEvidence({
        domain: "app.example.com",
        evidence: [
          new Verify.HostEvidence({
            source: "ses",
            status: "ok",
            label: "SES identity",
            detail: null,
            observedAt,
          }),
        ],
      });
      const latest = yield* Verify.latest("app.example.com");
      assert.strictEqual(latest?.overall, "ready");
      assert.deepStrictEqual(
        latest?.host.map(({ source }) => source),
        ["ses"],
      );
    }).pipe(
      withPrincipal,
      Effect.provideService(Verify.Observer, observer),
      Effect.provide(live()),
      Effect.provide(Layer.succeed(Logger.CurrentLoggers, new Set())),
    );
  });

  it.effect("does nothing by default", () =>
    Effect.gen(function* () {
      yield* connectAndApply;
      const readiness = yield* Verify.observe({ domain: "app.example.com" });
      assert.strictEqual(readiness.overall, "ready");
    }).pipe(withPrincipal, Effect.provide(live())),
  );
});
