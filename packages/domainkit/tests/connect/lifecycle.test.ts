import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Layer, Redacted } from "effect";
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
        { id: "fake", name: "Fake fake", methods: ["token"] },
      ]);
      const storage = yield* Storage.Storage;
      const credential = yield* storage.authorizations.credential(
        started.connection.authorizationId,
      );
      assert.ok(!credential.ciphertext.includes("secret"));
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
