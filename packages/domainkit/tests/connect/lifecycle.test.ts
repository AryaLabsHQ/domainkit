import { assert, describe, it } from "@effect/vitest";
import { DateTime, Deferred, Effect, Fiber, Layer, Redacted } from "effect";
import { TestClock } from "effect/testing";

import {
  Connect,
  Custody,
  DomainKitError,
  Principal,
  type Provider,
  Providers,
  Storage,
} from "../../src/index.ts";
import { Testing } from "../../src/entry/testing.ts";

const layerFor = (...definitions: ReadonlyArray<Testing.FakeProvider>) =>
  Connect.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Storage.layerMemory,
        Custody.layer({ key: Redacted.make(Custody.generateKey()) }),
        Providers.layer(definitions),
        Testing.resolver(),
      ),
    ),
  );

const withPrincipal = Effect.provideService(Principal.Principal, Testing.principal);

describe("Connect", () => {
  it.effect("connects with a token, attaches the domain, and reports it through inspect", () => {
    const fake = Testing.provider({ zones: ["example.com"] });
    return Effect.gen(function* () {
      const started = yield* Connect.start({
        provider: "fake",
        method: Connect.Method.token("secret"),
        domain: "App.Example.com",
      });
      assert.strictEqual(started._tag, "Connected");
      if (started._tag !== "Connected") return;
      assert.strictEqual(started.attachment?.domain, "app.example.com");
      assert.strictEqual(started.attachment?.zone, "example.com");
      const snapshot = yield* Connect.inspect("app.example.com");
      assert.strictEqual(snapshot.connection?.id, started.connection.id);
      assert.strictEqual(snapshot.authorization?.method, "token");
      assert.deepStrictEqual(snapshot.authorization?.capabilities, ["dns:read", "dns:write"]);
      assert.deepStrictEqual(snapshot.reusable, []);
      assert.deepStrictEqual(snapshot.providers, [
        {
          id: "fake",
          name: "Fake fake",
          methods: [
            {
              kind: "token",
              label: "Token (fake)",
              docsUrl: null,
              fields: [{ name: "token", required: true, secret: true }],
            },
          ],
        },
      ]);
      const storage = yield* Storage.Storage;
      const credential = yield* storage.authorizations.credential(
        started.connection.authorizationId,
      );
      assert.ok(!credential.ciphertext.includes("secret"));
      const authorization = yield* storage.authorizations.get(started.connection.authorizationId);
      assert.deepStrictEqual(authorization.context, {
        version: "fake.v1",
        value: { account: "fake" },
      });
      assert.strictEqual(
        (yield* Connect.session(started.attachment?.id ?? "")).target.zone,
        "example.com",
      );
      assert.deepStrictEqual(started.attachment?.target, {
        zone: "example.com",
        label: "example.com",
        nameservers: ["ns1.example.com", "ns2.example.com"],
        context: { version: "fake.v1", value: { zone: "example.com" } },
      });
      const { session, target } = yield* Connect.session(started.attachment?.id ?? "");
      assert.strictEqual(target.zone, "example.com");
      assert.deepStrictEqual(yield* session.dns(target).list("example.com"), []);
    }).pipe(withPrincipal, Effect.provide(layerFor(fake)));
  });

  it.effect(
    "needs a selection when two zones could serve the domain, then attaches the choice",
    () => {
      const fake = Testing.provider({ zones: ["example.com", "app.example.com"] });
      return Effect.gen(function* () {
        const started = yield* Connect.start({
          provider: "fake",
          method: Connect.Method.token("secret"),
        });
        assert.strictEqual(started._tag, "Connected");
        if (started._tag !== "Connected") return;
        const resolved = yield* Connect.attach({
          connectionId: started.connection.id,
          domain: "x.app.example.com",
        });
        assert.ok(!("_tag" in resolved) || resolved._tag !== "SelectionRequired");
        const other = Testing.provider({ id: "dup", zones: ["example.com"] });
        void other;
        const missing = yield* Connect.attach({
          connectionId: started.connection.id,
          domain: "example.net",
        }).pipe(Effect.flip);
        assert.strictEqual(missing.reason._tag, "NotFound");
        const again = yield* Connect.attach({
          connectionId: started.connection.id,
          domain: "x.app.example.com",
        });
        assert.ok(!("_tag" in again) || again._tag !== "SelectionRequired");
        const reusable = yield* Connect.inspect("other.example.com");
        assert.strictEqual(reusable.attachment, null);
        assert.strictEqual(reusable.reusable.length, 1);
      }).pipe(withPrincipal, Effect.provide(layerFor(fake)));
    },
  );

  it.effect(
    "runs the OAuth flow through one stored continuation and refreshes single-flighted",
    () => {
      const fake = Testing.provider({ zones: ["example.com"], oauth: true });
      return Effect.gen(function* () {
        const redirect = yield* Connect.start({
          provider: "fake",
          method: Connect.Method.oauth({ returnTo: "/settings" }),
          domain: "app.example.com",
          callbackUrl: "https://app.example/cb",
        });
        assert.strictEqual(redirect._tag, "Redirect");
        if (redirect._tag !== "Redirect") return;
        const callback = new URL(redirect.authorizationUrl);
        assert.strictEqual(callback.searchParams.get("state"), redirect.continuationId);
        const connected = yield* Connect.complete({
          continuationId: redirect.continuationId,
          callbackUrl: redirect.authorizationUrl,
        });
        assert.strictEqual(connected._tag, "Connected");
        if (connected._tag !== "Connected") return;
        assert.strictEqual(connected.attachment?.domain, "app.example.com");
        const replay = yield* Connect.complete({
          continuationId: redirect.continuationId,
          callbackUrl: redirect.authorizationUrl,
        }).pipe(Effect.flip);
        assert.strictEqual(replay.reason._tag, "NotFound");
        assert.strictEqual(yield* Connect.refresh(connected.connection.id), "current");
        yield* TestClock.adjust("55 minutes");
        const [first, second] = yield* Effect.all(
          [Connect.refresh(connected.connection.id), Connect.refresh(connected.connection.id)],
          { concurrency: "unbounded" },
        );
        assert.deepStrictEqual([first, second].sort(), ["current", "refreshed"]);
        assert.strictEqual(fake.issued().length, 2);
        const storage = yield* Storage.Storage;
        const credential = yield* storage.authorizations.credential(
          connected.connection.authorizationId,
        );
        const now = yield* DateTime.now;
        assert.ok(
          credential.expiresAt !== null &&
            DateTime.toEpochMillis(credential.expiresAt) >
              DateTime.toEpochMillis(now) + 50 * 60_000,
        );
        yield* Connect.disconnect(connected.connection.id);
        assert.strictEqual(fake.revoked(), 1);
        const gone = yield* Connect.inspect("app.example.com");
        assert.strictEqual(gone.attachment, null);
        assert.strictEqual(gone.connection, null);
      }).pipe(withPrincipal, Effect.provide(layerFor(fake)));
    },
  );

  it.effect("never orphans a refreshed credential behind a revocation", () => {
    const fake = Testing.provider({ zones: ["example.com"], oauth: true });
    const oauth = fake.auth.oauth ?? assert.fail("oauth expected");
    let gate: Deferred.Deferred<void> | null = null;
    const gated: Testing.FakeProvider = {
      ...fake,
      auth: {
        ...fake.auth,
        oauth: {
          ...oauth,
          refresh: (credential) =>
            (gate === null ? Effect.void : Deferred.await(gate)).pipe(
              Effect.andThen(oauth.refresh(credential)),
            ),
        },
      },
    };
    return Effect.gen(function* () {
      const redirect = yield* Connect.start({
        provider: "fake",
        method: Connect.Method.oauth(),
        callbackUrl: "https://app.example/cb",
      });
      if (redirect._tag !== "Redirect") return assert.fail("expected a redirect");
      const connected = yield* Connect.complete({
        continuationId: redirect.continuationId,
        callbackUrl: redirect.authorizationUrl,
      });
      if (connected._tag !== "Connected") return assert.fail("expected a connection");
      const storage = yield* Storage.Storage;
      yield* TestClock.adjust("55 minutes");

      // Revocation completes while the provider is issuing the refreshed credential.
      gate = yield* Deferred.make<void>();
      const refreshing = yield* Effect.forkChild(
        Connect.refresh(connected.connection.id).pipe(Effect.result),
      );
      yield* Effect.yieldNow;
      yield* Connect.disconnect(connected.connection.id);
      yield* Deferred.succeed(gate, undefined);
      const outcome = yield* Fiber.join(refreshing);
      assert.strictEqual(outcome._tag, "Failure");
      if (outcome._tag === "Failure") assert.strictEqual(outcome.failure.reason._tag, "NotFound");
      assert.strictEqual(fake.issued().length, 2);
      assert.strictEqual(fake.revoked(), 2);

      // A revocation that is already pending is seen under the lock and skips the refresher.
      gate = null;
      const again = yield* Connect.start({
        provider: "fake",
        method: Connect.Method.oauth(),
        callbackUrl: "https://app.example/cb",
      });
      if (again._tag !== "Redirect") return assert.fail("expected a redirect");
      const second = yield* Connect.complete({
        continuationId: again.continuationId,
        callbackUrl: again.authorizationUrl,
      });
      if (second._tag !== "Connected") return assert.fail("expected a connection");
      yield* TestClock.adjust("55 minutes");
      yield* storage.authorizations
        .revoke(second.connection.authorizationId, Effect.fail(new Error("provider down")))
        .pipe(Effect.ignore);
      const issuedBefore = fake.issued().length;
      assert.strictEqual(yield* Connect.refresh(second.connection.id), "reconnect");
      assert.strictEqual(fake.issued().length, issuedBefore);
    }).pipe(withPrincipal, Effect.provide(layerFor(gated)));
  });

  it.effect(
    "re-validates that the attached zone is still reachable before handing out a session",
    () => {
      const fake = Testing.provider({ zones: ["example.com"] });
      let zones: ReadonlyArray<string> | null = null;
      const shrinking: Testing.FakeProvider = {
        ...fake,
        session: (credential) => {
          const session = fake.session(credential);
          return {
            ...session,
            listTargets: () =>
              zones === null
                ? session.listTargets()
                : Effect.map(session.listTargets(), (targets) =>
                    targets.filter((target) => zones?.includes(target.zone) === true),
                  ),
          };
        },
      };
      return Effect.gen(function* () {
        const started = yield* Connect.start({
          provider: "fake",
          method: Connect.Method.token("t"),
          domain: "app.example.com",
        });
        if (started._tag !== "Connected" || started.attachment === null)
          return assert.fail("expected an attachment");
        const live = yield* Connect.session(started.attachment.id);
        assert.strictEqual(live.target.zone, "example.com");
        zones = [];
        const gone = yield* Connect.session(started.attachment.id).pipe(Effect.flip);
        assert.strictEqual(gone.reason._tag, "NotFound");
        if (gone.reason._tag === "NotFound") assert.strictEqual(gone.reason.entity, "zone");
      }).pipe(withPrincipal, Effect.provide(layerFor(shrinking)));
    },
  );

  it.effect("rejects mismatched or expired callbacks", () => {
    const fake = Testing.provider({ zones: ["example.com"], oauth: true });
    return Effect.gen(function* () {
      const redirect = yield* Connect.start({
        provider: "fake",
        method: Connect.Method.oauth(),
        callbackUrl: "https://app.example/cb",
      });
      if (redirect._tag !== "Redirect") return assert.fail("expected a redirect");
      const mismatch = yield* Connect.complete({
        continuationId: redirect.continuationId,
        callbackUrl: "https://app.example/cb?state=other&code=fake-code",
      }).pipe(Effect.flip);
      assert.strictEqual(mismatch.reason._tag, "Unauthenticated");
      const denied = yield* Connect.complete({
        continuationId: redirect.continuationId,
        callbackUrl: `https://app.example/cb?state=${redirect.continuationId}&error=access_denied`,
      }).pipe(Effect.flip);
      assert.strictEqual(denied.reason._tag, "Unauthenticated");
      const stillPending = yield* Connect.complete({
        continuationId: redirect.continuationId,
        callbackUrl: redirect.authorizationUrl,
      });
      assert.strictEqual(stillPending._tag, "Connected");
      const late = yield* Connect.start({
        provider: "fake",
        method: Connect.Method.oauth(),
        callbackUrl: "https://app.example/cb",
      });
      if (late._tag !== "Redirect") return assert.fail("expected a redirect");
      yield* TestClock.adjust("16 minutes");
      const expired = yield* Connect.complete({
        continuationId: late.continuationId,
        callbackUrl: late.authorizationUrl,
      }).pipe(Effect.flip);
      assert.strictEqual(expired.reason._tag, "Expired");
      const noCallback = yield* Connect.start({
        provider: "fake",
        method: Connect.Method.oauth(),
      }).pipe(Effect.flip);
      assert.strictEqual(noCallback.reason._tag, "InvalidInput");
    }).pipe(withPrincipal, Effect.provide(layerFor(fake)));
  });

  it.effect("returns the persisted connection when the continuation expires mid-exchange", () => {
    const fake = Testing.provider({ zones: ["example.com"], oauth: true });
    const oauth = fake.auth.oauth ?? assert.fail("oauth expected");
    const slow: Testing.FakeProvider = {
      ...fake,
      auth: {
        ...fake.auth,
        oauth: {
          ...oauth,
          complete: (input) =>
            TestClock.adjust("16 minutes").pipe(Effect.andThen(oauth.complete(input))),
        },
      },
    };
    return Effect.gen(function* () {
      const redirect = yield* Connect.start({
        provider: "fake",
        method: Connect.Method.oauth(),
        domain: "app.example.com",
        callbackUrl: "https://app.example/cb",
      });
      if (redirect._tag !== "Redirect") return assert.fail("expected a redirect");
      const connected = yield* Connect.complete({
        continuationId: redirect.continuationId,
        callbackUrl: redirect.authorizationUrl,
      });
      assert.strictEqual(connected._tag, "Connected");
      const snapshot = yield* Connect.inspect("app.example.com");
      assert.strictEqual(snapshot.authorization?.method, "oauth");
      const replay = yield* Connect.complete({
        continuationId: redirect.continuationId,
        callbackUrl: redirect.authorizationUrl,
      }).pipe(Effect.flip);
      assert.ok(replay.reason._tag === "Expired" || replay.reason._tag === "NotFound");
    }).pipe(withPrincipal, Effect.provide(layerFor(slow)));
  });

  it.effect("keeps the continuation when persistence fails after the exchange", () => {
    const fake = Testing.provider({ zones: ["example.com"], oauth: true });
    let commits = 0;
    const storage = Storage.layerMemoryWith({
      beforeCommit: (operation) => {
        if (operation !== "authorizations.upsert") return Effect.void;
        commits += 1;
        return commits === 1
          ? DomainKitError.fail(
              new DomainKitError.StorageFailed({ operation, message: "storage outage" }),
            )
          : Effect.void;
      },
    });
    const layer = Connect.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          storage,
          Custody.layer({ key: Redacted.make(Custody.generateKey()) }),
          Providers.layer([fake]),
          Testing.resolver(),
        ),
      ),
    );
    return Effect.gen(function* () {
      const redirect = yield* Connect.start({
        provider: "fake",
        method: Connect.Method.oauth(),
        domain: "app.example.com",
        callbackUrl: "https://app.example/cb",
      });
      if (redirect._tag !== "Redirect") return assert.fail("expected a redirect");
      const outage = yield* Connect.complete({
        continuationId: redirect.continuationId,
        callbackUrl: redirect.authorizationUrl,
      }).pipe(Effect.flip);
      assert.strictEqual(outage.reason._tag, "StorageFailed");
      const [first, second] = yield* Effect.all(
        [
          Connect.complete({
            continuationId: redirect.continuationId,
            callbackUrl: redirect.authorizationUrl,
          }).pipe(Effect.result),
          Connect.complete({
            continuationId: redirect.continuationId,
            callbackUrl: redirect.authorizationUrl,
          }).pipe(Effect.result),
        ],
        { concurrency: "unbounded" },
      );
      const outcomes = [first, second].map((result) =>
        result._tag === "Success" ? result.success._tag : result.failure.reason._tag,
      );
      assert.ok(outcomes.includes("Connected"), JSON.stringify(outcomes));
      assert.ok(
        outcomes.includes("Busy") || outcomes.includes("NotFound"),
        JSON.stringify(outcomes),
      );
      const snapshot = yield* Connect.inspect("app.example.com");
      assert.strictEqual(snapshot.authorization?.method, "oauth");
    }).pipe(withPrincipal, Effect.provide(layer));
  });

  it.effect("recovers a revocation that failed between prepare and complete", () => {
    let attempts = 0;
    const fake = Testing.provider({ zones: ["example.com"], oauth: true });
    const flaky: Testing.FakeProvider = {
      ...fake,
      auth: {
        ...fake.auth,
        oauth: {
          ...(fake.auth.oauth ?? assert.fail("oauth expected")),
          revoke: () =>
            Effect.suspend(() => {
              attempts += 1;
              return attempts === 1
                ? DomainKitError.fail(
                    new DomainKitError.ProviderUnavailable({
                      provider: "fake",
                      message: "provider down",
                    }),
                  )
                : Effect.void;
            }),
        },
      },
    };
    return Effect.gen(function* () {
      const redirect = yield* Connect.start({
        provider: "fake",
        method: Connect.Method.oauth(),
        callbackUrl: "https://app.example/cb",
      });
      if (redirect._tag !== "Redirect") return assert.fail("expected a redirect");
      const connected = yield* Connect.complete({
        continuationId: redirect.continuationId,
        callbackUrl: redirect.authorizationUrl,
      });
      if (connected._tag !== "Connected") return assert.fail("expected a connection");
      const failure = yield* Connect.disconnect(connected.connection.id).pipe(Effect.flip);
      assert.strictEqual(failure.reason._tag, "ProviderUnavailable");
      const storage = yield* Storage.Storage;
      const pending = yield* storage.authorizations.get(connected.connection.authorizationId);
      assert.strictEqual(pending.revocation, "pending");
      const next = yield* Connect.start({ provider: "fake", method: Connect.Method.token("t") });
      assert.strictEqual(next._tag, "Connected");
      const gone = yield* storage.authorizations
        .get(connected.connection.authorizationId)
        .pipe(Effect.flip);
      assert.strictEqual(gone.reason._tag, "NotFound");
      assert.strictEqual(attempts, 2);
    }).pipe(withPrincipal, Effect.provide(layerFor(flaky)));
  });

  it.effect("fails Forbidden when a token lacks the required capabilities", () => {
    const fake = Testing.provider({ zones: ["example.com"] });
    const readOnly: Testing.FakeProvider = {
      ...fake,
      session: (credential: Provider.Credential) => ({
        ...fake.session(credential),
        capabilities: () => Effect.succeed(["dns:read"]),
      }),
    };
    return Effect.gen(function* () {
      const failure = yield* Connect.start({
        provider: "fake",
        method: Connect.Method.token("t"),
      }).pipe(Effect.flip);
      assert.strictEqual(failure.reason._tag, "Forbidden");
      const empty = yield* Connect.start({
        provider: "fake",
        method: Connect.Method.token(""),
      }).pipe(Effect.flip);
      assert.strictEqual(empty.reason._tag, "Unauthenticated");
      const unknown = yield* Connect.start({
        provider: "nope",
        method: Connect.Method.token("t"),
      }).pipe(Effect.flip);
      assert.strictEqual(unknown.reason._tag, "NotFound");
    }).pipe(withPrincipal, Effect.provide(layerFor(readOnly)));
  });
});
