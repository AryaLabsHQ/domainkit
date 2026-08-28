import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";

import {
  ConnectionStore,
  CredentialStore,
  Digest,
  DomainName,
  OAuth,
  OAuthStateStore,
  ProviderAuth,
  ProviderAuthorizationStore,
  Secret,
  TokenConnection,
} from "../../src/effect.ts";
import {
  InMemoryConnectionStore,
  InMemoryCredentialStore,
  InMemoryOAuthStateStore,
  InMemoryProviderAuthorizationStore,
} from "../../src/testing.ts";

const method: ProviderAuth.OAuthMethod = {
  _tag: "oauth2",
  authorizationServer: {
    authorization_endpoint: "https://auth.example/authorize",
    issuer: "https://auth.example",
    token_endpoint: "https://auth.example/token",
  },
  capabilities: ["dns:read", "dns:write"],
  clientAuth: "none",
  scopes: ["dns:read", "dns:write"],
};

describe("Effect-native authorization", () => {
  it.effect("runs token validation and persistence through services", () => {
    const connections = InMemoryConnectionStore.make();
    const credentials = InMemoryCredentialStore.make();
    const authorizations = InMemoryProviderAuthorizationStore.make();
    const layer = Layer.mergeAll(
      Layer.succeed(ConnectionStore.Service, connections),
      Layer.succeed(CredentialStore.Service, credentials),
      Layer.succeed(ProviderAuthorizationStore.Service, authorizations),
      Digest.webCryptoLayer,
    );
    return Effect.gen(function* () {
      const result = yield* TokenConnection.connect({
        grant: { _tag: "account" },
        ownerId: "organization-1",
        providerId: "example-provider",
        subjectId: "user-1",
        token: Secret.make("token"),
        validate: () =>
          Effect.succeed({
            accountId: "account-1",
            capabilities: ["dns:read", "dns:write"],
            expiresAt: null,
            scopes: ["dns:write"],
          }),
      });
      assert.strictEqual(
        (yield* credentials.get(result.authorization.id))?.accessToken.expose(),
        "token",
      );
      assert.ok(result.connection.createdAt instanceof Date);
    }).pipe(Effect.provide(layer));
  });

  it.effect("runs PKCE, exchange, and persistence through Layers", () => {
    const oauthState = InMemoryOAuthStateStore.make();
    const connections = InMemoryConnectionStore.make();
    const credentials = InMemoryCredentialStore.make();
    const authorizations = InMemoryProviderAuthorizationStore.make();
    const layer = Layer.mergeAll(
      Layer.succeed(OAuthStateStore.Service, oauthState),
      Layer.succeed(ConnectionStore.Service, connections),
      Layer.succeed(CredentialStore.Service, credentials),
      Layer.succeed(ProviderAuthorizationStore.Service, authorizations),
      Digest.webCryptoLayer,
    );
    return Effect.gen(function* () {
      const started = yield* OAuth.begin({
        client: { clientId: "client-id" },
        grant: { _tag: "domains", domains: [DomainName.parse("example.com")] },
        method,
        ownerId: "organization-1",
        redirectUri: "https://app.example/oauth/callback",
        subjectId: "user-1",
      });
      const state = started.authorizationUrl.searchParams.get("state");
      if (state === null) return yield* Effect.die("OAuth state was not generated");
      const callbackUrl = new URL("https://app.example/oauth/callback");
      callbackUrl.search = new URLSearchParams({
        code: "authorization-code",
        state,
      }).toString();
      const result = yield* OAuth.complete({
        callbackUrl,
        client: { clientId: "client-id" },
        fetch: async () =>
          Response.json({
            access_token: "access-token",
            refresh_token: "refresh-token",
            token_type: "Bearer",
          }),
        providerId: "example-provider",
        resolveSubject: () => Effect.succeed({ accountId: "account-1", expiresAt: null }),
      });
      assert.strictEqual(result.authorization.kind, "oauth2");
      assert.strictEqual(
        (yield* credentials.get(result.authorization.id))?.accessToken.expose(),
        "access-token",
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("expires OAuth continuations with TestClock", () => {
    const layer = Layer.mergeAll(
      InMemoryOAuthStateStore.layer(),
      InMemoryConnectionStore.layer(),
      InMemoryCredentialStore.layer(),
      InMemoryProviderAuthorizationStore.layer(),
      Digest.webCryptoLayer,
    );
    return Effect.gen(function* () {
      const started = yield* OAuth.begin({
        client: { clientId: "client-id" },
        grant: { _tag: "account" },
        method,
        ownerId: "organization-1",
        redirectUri: "https://app.example/oauth/callback",
        subjectId: "user-1",
        ttlMs: 1,
      });
      yield* TestClock.adjust("2 millis");
      const state = started.authorizationUrl.searchParams.get("state");
      if (state === null) return yield* Effect.die("OAuth state was not generated");
      const callbackUrl = new URL("https://app.example/oauth/callback");
      callbackUrl.search = new URLSearchParams({ code: "code", state }).toString();
      const failure = yield* OAuth.complete({
        callbackUrl,
        client: { clientId: "client-id" },
        providerId: "example-provider",
        resolveSubject: () => Effect.succeed({ accountId: "account-1", expiresAt: null }),
      }).pipe(Effect.flip);
      assert.strictEqual(failure._tag, "AuthorizationError");
    }).pipe(Effect.provide(layer));
  });
});
