import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { Connect, DomainKit, Principal, Provider, Reason } from "../../src/index.ts";
import { Testing } from "../../src/entry/testing.ts";
import { DomainKitError } from "../../src/internal/error.ts";

const withPrincipal = Effect.provideService(Principal.Service, Testing.principal);

const connect = (provider: string) =>
  Connect.start({ provider, method: Connect.Method.token("token") }).pipe(
    Effect.map((started) => {
      if (started._tag !== "Connected") throw new Error("expected a connection");
      return started.connection;
    }),
  );

/** A provider that is simply down: nothing is wrong with the credential. */
const unavailable = Provider.make({
  id: "unavailable",
  name: "Unavailable",
  context: Schema.Struct({}),
  contextVersion: "unavailable.v1",
  auth: {
    token: Provider.tokenAuth({
      label: "Token",
      requiredCapabilities: [],
      fields: Schema.Struct({ token: Schema.RedactedFromValue(Schema.String) }),
      authenticate: ({ token }) => Effect.succeed({ secret: token, context: {}, expiresAt: null }),
    }),
  },
  session: () => ({
    capabilities: () => Effect.succeed(["dns:read", "dns:write"]),
    listTargets: () =>
      Effect.fail(
        new DomainKitError({
          reason: new Reason.ProviderUnavailable({
            provider: "unavailable",
            message: "the provider is down",
          }),
        }),
      ),
    resolveTarget: () => Effect.succeed(Provider.Resolution.NotFound()),
    dns: () => ({
      list: () => Effect.succeed([]),
      create: () => Effect.succeed({ providerRecordId: "unused" }),
      get: () => Effect.succeed(null),
      delete: () => Effect.void,
    }),
  }),
});

/** A provider whose credential the account turns down the moment anything asks it for zones. */
const rejecting = Provider.make({
  id: "rejecting",
  name: "Rejecting",
  context: Schema.Struct({}),
  contextVersion: "rejecting.v1",
  auth: {
    token: Provider.tokenAuth({
      label: "Token",
      requiredCapabilities: [],
      fields: Schema.Struct({ token: Schema.RedactedFromValue(Schema.String) }),
      authenticate: ({ token }) => Effect.succeed({ secret: token, context: {}, expiresAt: null }),
    }),
  },
  session: () => ({
    capabilities: () => Effect.succeed(["dns:read", "dns:write"]),
    listTargets: () =>
      Effect.fail(
        new DomainKitError({
          reason: new Reason.Unauthenticated({ message: "the account revoked this token" }),
        }),
      ),
    resolveTarget: () => Effect.succeed(Provider.Resolution.NotFound()),
    dns: () => ({
      list: () => Effect.succeed([]),
      create: () => Effect.succeed({ providerRecordId: "unused" }),
      get: () => Effect.succeed(null),
      delete: () => Effect.void,
    }),
  }),
});

describe("Connect.zones", () => {
  it.effect("lists every connection's zones, ordered by zone", () => {
    const one = Testing.provider({
      id: "one",
      zones: ["b.example", "a.example"],
      labels: { "a.example": "a.example (One)", "b.example": "b.example (One)" },
    });
    const two = Testing.provider({
      id: "two",
      zones: ["c.example"],
      labels: { "c.example": "c.example (Two)" },
    });
    return Effect.gen(function* () {
      const first = yield* connect("one");
      const second = yield* connect("two");
      const listing = yield* Connect.zones();
      assert.deepStrictEqual(
        listing.zones.map(({ connectionId, provider, target }) => [
          target.zone,
          target.label,
          provider,
          connectionId,
        ]),
        [
          ["a.example", "a.example (One)", "one", first.id],
          ["b.example", "b.example (One)", "one", first.id],
          ["c.example", "c.example (Two)", "two", second.id],
        ],
      );
      assert.deepStrictEqual(listing.connections, [
        { connectionId: first.id, provider: "one", status: "connected" },
        { connectionId: second.id, provider: "two", status: "connected" },
      ]);
      assert.deepStrictEqual(
        listing.providers.map(({ id, name }) => [id, name]),
        [
          ["one", "Fake one"],
          ["two", "Fake two"],
        ],
      );
      const narrowed = yield* Connect.zones({ provider: "two" });
      assert.deepStrictEqual(
        narrowed.zones.map(({ target }) => target.zone),
        ["c.example"],
      );
    }).pipe(
      withPrincipal,
      Effect.provide(
        DomainKit.layerMemory({ providers: [one, two], resolver: Testing.resolver([]) }),
      ),
    );
  });

  it.effect("marks a connection the provider turned down and keeps the rest", () => {
    const working = Testing.provider({ id: "working", zones: ["example.com"] });
    return Effect.gen(function* () {
      const alive = yield* connect("working");
      const dead = yield* connect("rejecting");
      const listing = yield* Connect.zones();
      assert.deepStrictEqual(
        listing.zones.map(({ connectionId, target }) => [connectionId, target.zone]),
        [[alive.id, "example.com"]],
      );
      assert.deepStrictEqual(
        listing.connections.find(({ connectionId }) => connectionId === dead.id),
        { connectionId: dead.id, provider: "rejecting", status: "reconnect" },
      );
      assert.strictEqual(
        listing.connections.find(({ connectionId }) => connectionId === alive.id)?.status,
        "connected",
      );
    }).pipe(
      withPrincipal,
      Effect.provide(
        DomainKit.layerMemory({
          providers: [working, rejecting],
          resolver: Testing.resolver([]),
        }),
      ),
    );
  });

  it.effect(
    "raises a failure that is not the credential's rather than asking for a reconnect",
    () => {
      return Effect.gen(function* () {
        yield* connect("unavailable");
        const outcome = yield* Effect.flip(Connect.zones());
        // A provider outage is retryable and says so; dressing it up as `reconnect` would send the
        // customer to grant an authorization that was never the problem.
        assert.strictEqual(outcome.reason._tag, "ProviderUnavailable");
      }).pipe(
        withPrincipal,
        Effect.provide(
          DomainKit.layerMemory({ providers: [unavailable], resolver: Testing.resolver([]) }),
        ),
      );
    },
  );

  it.effect("remembers the zone's label on the attachment it creates", () => {
    const fake = Testing.provider({
      id: "labelled",
      zones: ["example.com"],
      labels: { "example.com": "example.com (Labelled)" },
    });
    return Effect.gen(function* () {
      const started = yield* Connect.start({
        provider: "labelled",
        method: Connect.Method.token("token"),
        domain: "app.example.com",
      });
      assert.strictEqual(started._tag, "Connected");
      if (started._tag !== "Connected") return;
      assert.strictEqual(started.attachment?.label, "example.com (Labelled)");
      const snapshot = yield* Connect.inspect("app.example.com");
      assert.strictEqual(snapshot.attachment?.label, "example.com (Labelled)");
    }).pipe(
      withPrincipal,
      Effect.provide(DomainKit.layerMemory({ providers: [fake], resolver: Testing.resolver([]) })),
    );
  });
});
