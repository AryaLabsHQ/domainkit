import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { Connect, DnsRecord, DomainKit, Principal, Storage } from "../../src/index.ts";
import { Testing } from "../../src/entry/testing.ts";

const withPrincipal = Effect.provideService(Principal.Service, Testing.principal);

const connect = (provider: string) =>
  Connect.start({ provider, method: Connect.Method.token("token") }).pipe(
    Effect.map((started) => {
      if (started._tag !== "Connected") throw new Error("expected a connection");
      return started.connection;
    }),
  );

const nsAnswers = (zone: string, nameservers: ReadonlyArray<string>) =>
  Testing.resolver([
    {
      name: zone,
      records: nameservers.map((nameserver) => DnsRecord.ns({ name: zone, nameserver })),
    },
  ]);

describe("Connect.discover", () => {
  it.effect("resolves the closest authoritative zone across connections", () => {
    const parent = Testing.provider({ id: "parent", zones: ["example.com"] });
    const near = Testing.provider({ id: "near", zones: ["mail.example.com"] });
    return Effect.gen(function* () {
      yield* connect("parent");
      const nearConnection = yield* connect("near");
      const discovery = yield* Connect.discover("track.mail.example.com");
      assert.strictEqual(discovery._tag, "Resolved");
      if (discovery._tag !== "Resolved") return;
      assert.strictEqual(discovery.target.zone, "mail.example.com");
      assert.strictEqual(discovery.connectionId, nearConnection.id);
      const apex = yield* Connect.discover("example.com");
      assert.strictEqual(apex._tag, "Resolved");
      if (apex._tag === "Resolved") assert.strictEqual(apex.target.zone, "example.com");
    }).pipe(
      withPrincipal,
      Effect.provide(
        DomainKit.layerMemory({ providers: [parent, near], resolver: Testing.resolver([]) }),
      ),
    );
  });

  it.effect("does not let a parent zone preempt a closer candidate and lists ties in order", () => {
    const wide = Testing.provider({ id: "wide", zones: ["example.com", "mail.example.com"] });
    const near = Testing.provider({ id: "near", zones: ["mail.example.com"] });
    return Effect.gen(function* () {
      const wideConnection = yield* connect("wide");
      const nearConnection = yield* connect("near");
      const discovery = yield* Connect.discover("track.mail.example.com");
      assert.strictEqual(discovery._tag, "SelectionRequired");
      if (discovery._tag !== "SelectionRequired") return;
      assert.deepStrictEqual(
        discovery.candidates.map(({ connectionId, target }) => [connectionId, target.zone]),
        [
          [wideConnection.id, "mail.example.com"],
          [nearConnection.id, "mail.example.com"],
        ].sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
      );
    }).pipe(
      withPrincipal,
      Effect.provide(
        DomainKit.layerMemory({ providers: [wide, near], resolver: Testing.resolver([]) }),
      ),
    );
  });

  it.effect("breaks a tie with decisive nameserver evidence", () => {
    const alpha = Testing.provider({
      id: "alpha",
      zones: ["example.com"],
      nameservers: { "example.com": ["ada.ns.alpha.test", "bob.ns.alpha.test"] },
    });
    const beta = Testing.provider({
      id: "beta",
      zones: ["example.com"],
      nameservers: { "example.com": ["ns1.beta.test"] },
    });
    return Effect.gen(function* () {
      const alphaConnection = yield* connect("alpha");
      yield* connect("beta");
      const decisive = yield* Connect.discover("www.example.com");
      assert.strictEqual(decisive._tag, "Resolved");
      if (decisive._tag === "Resolved") {
        assert.strictEqual(decisive.connectionId, alphaConnection.id);
      }
    }).pipe(
      withPrincipal,
      Effect.provide(
        DomainKit.layerMemory({
          providers: [alpha, beta],
          resolver: nsAnswers("example.com", ["ADA.NS.ALPHA.TEST.", "bob.ns.alpha.test"]),
        }),
      ),
    );
  });

  it.effect("needs a selection when nameserver evidence supports no candidate", () => {
    const alpha = Testing.provider({ id: "alpha", zones: ["example.com"] });
    const beta = Testing.provider({ id: "beta", zones: ["example.com"] });
    return Effect.gen(function* () {
      yield* connect("alpha");
      yield* connect("beta");
      const discovery = yield* Connect.discover("www.example.com");
      assert.strictEqual(discovery._tag, "SelectionRequired");
      if (discovery._tag === "SelectionRequired") {
        assert.strictEqual(discovery.candidates.length, 2);
      }
    }).pipe(
      withPrincipal,
      Effect.provide(
        DomainKit.layerMemory({
          providers: [alpha, beta],
          resolver: nsAnswers("example.com", ["ns1.unknown.test"]),
        }),
      ),
    );
  });

  it.effect("reports NotFound with the observed nameservers and stays tenant-scoped", () => {
    const fake = Testing.provider({ zones: ["other.test"] });
    return Effect.gen(function* () {
      yield* connect("fake");
      const missing = yield* Connect.discover("app.example.com");
      assert.strictEqual(missing._tag, "NotFound");
      if (missing._tag === "NotFound") assert.deepStrictEqual(missing.nameservers, []);
      const foreign = yield* Connect.discover("app.other.test").pipe(
        Effect.provideService(
          Principal.Service,
          Principal.make({ ownerId: "someone-else", actorId: "x" }),
        ),
      );
      assert.strictEqual(foreign._tag, "NotFound");
      if (foreign._tag === "NotFound") {
        assert.deepStrictEqual(foreign.nameservers, ["ns1.other.test", "ns2.other.test"]);
      }
    }).pipe(
      withPrincipal,
      Effect.provide(
        DomainKit.layerMemory({
          providers: [fake],
          resolver: nsAnswers("other.test", ["ns2.other.test", "ns1.other.test"]),
        }),
      ),
    );
  });

  it.effect("skips connections whose credential can no longer be used", () => {
    const fake = Testing.provider({ zones: ["example.com"] });
    return Effect.gen(function* () {
      const connection = yield* connect("fake");
      const storage = yield* Storage.Service;
      yield* storage.authorizations
        .revoke(connection.authorizationId, Effect.fail(new Error("provider down")))
        .pipe(Effect.ignore);
      const discovery = yield* Connect.discover("app.example.com");
      assert.strictEqual(discovery._tag, "NotFound");
    }).pipe(
      withPrincipal,
      Effect.provide(DomainKit.layerMemory({ providers: [fake], resolver: Testing.resolver([]) })),
    );
  });
});
