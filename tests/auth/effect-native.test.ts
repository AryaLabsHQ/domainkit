import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { beginOAuth, completeOAuth, connectToken, webCryptoLayer } from "../../src/effect.ts";
import { parseDomainName, Secret, type OAuthMethod } from "../../src/index.ts";
import {
  InMemoryConnectionStore,
  InMemoryCredentialStore,
  InMemoryOAuthStateStore,
} from "../../src/testing.ts";

const method: OAuthMethod = {
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
  it("runs token validation and persistence through services", async () => {
    const connections = new InMemoryConnectionStore();
    const credentials = new InMemoryCredentialStore();
    const layer = Layer.mergeAll(connections.layer, credentials.layer, webCryptoLayer);
    const connection = await Effect.runPromise(
      connectToken({
        grant: { _tag: "account" },
        providerId: "example-provider",
        subjectId: "user-1",
        token: Secret.from("token"),
        validate: () =>
          Effect.succeed({
            accountId: "account-1",
            capabilities: ["dns:read", "dns:write"],
            expiresAt: null,
            scopes: ["dns:write"],
          }),
      }).pipe(Effect.provide(layer)),
    );

    expect((await Effect.runPromise(credentials.get(connection.id)))?.accessToken.expose()).toBe(
      "token",
    );
  });

  it("runs PKCE, exchange, and persistence through Effect Layers", async () => {
    const oauthState = new InMemoryOAuthStateStore();
    const connections = new InMemoryConnectionStore();
    const credentials = new InMemoryCredentialStore();
    const layer = Layer.mergeAll(
      oauthState.layer,
      connections.layer,
      credentials.layer,
      webCryptoLayer,
    );
    const begin = await Effect.runPromise(
      beginOAuth({
        client: { clientId: "client-id" },
        grant: { _tag: "domains", domains: [parseDomainName("example.com")] },
        method,
        redirectUri: "https://app.example/oauth/callback",
        subjectId: "user-1",
      }).pipe(Effect.provide(layer)),
    );
    const callbackUrl = new URL("https://app.example/oauth/callback");
    callbackUrl.search = new URLSearchParams({
      code: "authorization-code",
      state: begin.authorizationUrl.searchParams.get("state")!,
    }).toString();
    const connection = await Effect.runPromise(
      completeOAuth({
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
      }).pipe(Effect.provide(layer)),
    );

    expect(connection.kind).toBe("oauth2");
    expect((await Effect.runPromise(credentials.get(connection.id)))?.accessToken.expose()).toBe(
      "access-token",
    );
  });
});
