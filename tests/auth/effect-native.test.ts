import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import {
  AuthorizationLifecycle,
  Connection,
  Digest,
  DomainName,
  ProviderAuthorization,
  Secret,
} from "../../src/effect.ts";
import {
  InMemoryAuthorizationLifecycle,
  InMemoryConnectionContinuations,
} from "../../src/testing.ts";

const authentication = (providerAccountId = "account-1"): Connection.Authentication => ({
  capabilityEvidence: [
    {
      capability: "dns:read",
      evidence: ProviderAuthorization.Evidence.Introspected({
        observedAt: new Date("2026-08-29T00:00:00.000Z"),
      }),
    },
    {
      capability: "dns:write",
      evidence: ProviderAuthorization.Evidence.Introspected({
        observedAt: new Date("2026-08-29T00:00:00.000Z"),
      }),
    },
  ],
  credential: {
    accessToken: Secret.make("access-token"),
    refreshToken: null,
    tokenType: "bearer",
  },
  expiresAt: null,
  providerAccountId,
  providerContext: { value: { accountType: "team" }, version: "example.v1" },
  scopes: ["dns:write"],
});

describe("Effect-native connections", () => {
  it.effect("commits one complete aggregate for a token connection", () => {
    const repository = InMemoryAuthorizationLifecycle.make();
    return Effect.gen(function* () {
      const result = yield* Connection.start({
        authorizedById: "user-1",
        grant: { _tag: "account" },
        method: Connection.Method.Token({
          authenticate: () => Effect.succeed(authentication()),
          providerId: "example",
          requiredCapabilities: ["dns:read", "dns:write"],
          token: Secret.make("access-token"),
        }),
        ownerId: "organization-1",
      });
      assert.strictEqual(result._tag, "Connected");
      if (result._tag !== "Connected") return;
      const stored = yield* repository.get(result.aggregate.authorization.id);
      assert.strictEqual(stored?.bindings.length, 1);
      assert.strictEqual(stored?.authorization.providerAccountId, "account-1");
      assert.strictEqual(stored?.credential.accessToken.expose(), "access-token");
    }).pipe(
      Effect.provide(
        Layer.merge(
          Layer.succeed(AuthorizationLifecycle.Service, repository),
          Digest.webCryptoLayer,
        ),
      ),
    );
  });

  it.effect("extends an existing owner grant when another domain uses the same account", () => {
    const repository = InMemoryAuthorizationLifecycle.make();
    const connect = (domain: "domlens.dev" | "samva.arya.sh") =>
      Connection.start({
        authorizedById: "user-1",
        grant: { _tag: "domains", domains: [DomainName.parse(domain)] },
        method: Connection.Method.Token({
          authenticate: () => Effect.succeed(authentication()),
          providerId: "example",
          requiredCapabilities: ["dns:read", "dns:write"],
          token: Secret.make("access-token"),
        }),
        ownerId: "organization-1",
      });

    return Effect.gen(function* () {
      const first = yield* connect("domlens.dev");
      const second = yield* connect("samva.arya.sh");
      assert.strictEqual(first._tag, "Connected");
      assert.strictEqual(second._tag, "Connected");
      if (first._tag !== "Connected" || second._tag !== "Connected") return;
      assert.strictEqual(second.aggregate.bindings.length, 1);
      assert.strictEqual(second.aggregate.bindings[0]?.id, first.aggregate.bindings[0]?.id);
      assert.deepStrictEqual(second.aggregate.bindings[0]?.grant, {
        _tag: "domains",
        domains: [DomainName.parse("domlens.dev"), DomainName.parse("samva.arya.sh")],
      });
    }).pipe(
      Effect.provide(
        Layer.merge(
          Layer.succeed(AuthorizationLifecycle.Service, repository),
          Digest.webCryptoLayer,
        ),
      ),
    );
  });

  it.effect("redirects and completes an interactive connection through the same repository", () => {
    const repository = InMemoryAuthorizationLifecycle.make();
    const continuations = InMemoryConnectionContinuations.make();
    const flow: Connection.InteractiveFlow = {
      complete: () => Effect.succeed(authentication()),
      method: "oauth2",
      providerId: "example",
      requiredCapabilities: ["dns:read", "dns:write"],
      start: () =>
        Effect.succeed({
          authorizationUrl: new URL("https://provider.example/connect"),
          payload: Secret.make('{"verifier":"opaque"}'),
        }),
    };
    const layer = Layer.merge(
      Layer.succeed(AuthorizationLifecycle.Service, repository),
      Digest.webCryptoLayer,
    );
    return Effect.gen(function* () {
      const started = yield* Connection.start({
        authorizedById: "user-1",
        grant: { _tag: "account" },
        method: Connection.Method.Interactive({
          continuations,
          flow,
        }),
        ownerId: "organization-1",
      });
      assert.strictEqual(started._tag, "Redirect");
      if (started._tag !== "Redirect") return;
      const completions = yield* Effect.all(
        ["first", "second"].map((code) =>
          Connection.complete({
            callbackUrl: new URL(`https://app.example/callback?code=${code}`),
            continuationId: started.continuationId,
            continuations,
            flow,
          }).pipe(Effect.result),
        ),
        { concurrency: "unbounded" },
      );
      const successes = completions.filter((completion) => completion._tag === "Success");
      const failures = completions.filter((completion) => completion._tag === "Failure");
      assert.strictEqual(successes.length, 1);
      assert.strictEqual(failures.length, 1);
      assert.strictEqual(successes[0]?.success.authorization.method, "oauth2");
      assert.strictEqual(successes[0]?.success.bindings.length, 1);
      assert.strictEqual(failures[0]?.failure._tag, "ConnectionError");
    }).pipe(Effect.provide(layer));
  });
});
