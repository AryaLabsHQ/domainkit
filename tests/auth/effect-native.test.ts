import { Effect, Fiber, Layer } from "effect";
import { describe, expect, it } from "vitest";

import {
  beginOAuth,
  completeOAuth,
  connectToken,
  refreshOAuth,
  webCryptoLayer,
} from "../../src/effect.ts";
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

  it("propagates Effect interruption into OAuth transport", async () => {
    const credentials = new InMemoryCredentialStore();
    const connection = {
      accountId: "account-1",
      capabilities: ["dns:read", "dns:write"] as const,
      createdAt: "2026-08-27T00:00:00.000Z",
      expiresAt: null,
      grant: { _tag: "account" } as const,
      id: "connection-1",
      kind: "oauth2" as const,
      providerId: "example-provider",
      scopes: ["dns:write"],
      subjectId: "user-1",
    };
    await Effect.runPromise(
      credentials.put(connection.id, {
        accessToken: Secret.from("access-token"),
        refreshToken: Secret.from("refresh-token"),
        tokenType: "bearer",
      }),
    );
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let aborted = false;
    const fiber = Effect.runFork(
      refreshOAuth({
        client: { clientId: "client-id" },
        connection,
        fetch: async (_input, init) => {
          started();
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(init.signal?.reason);
              },
              { once: true },
            );
          });
        },
        method,
      }).pipe(Effect.provide(credentials.layer)),
    );
    await requestStarted;
    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(aborted).toBe(true);
  });
});
