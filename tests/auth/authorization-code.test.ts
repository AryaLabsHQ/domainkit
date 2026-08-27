import { describe, expect, it } from "vitest";

import {
  assertConnectionGrant,
  beginOAuth,
  completeOAuth,
  parseDomainName,
  refreshOAuth,
  revokeOAuth,
  Secret,
  type Connection,
  type OAuthMethod,
} from "../../src/index.ts";
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
    revocation_endpoint: "https://auth.example/revoke",
    token_endpoint: "https://auth.example/token",
  },
  capabilities: ["dns:read", "dns:write"],
  clientAuth: "none",
  scopes: ["dns:read", "dns:write"],
};

describe("OAuth authorization code flow", () => {
  it("uses PKCE/state, consumes continuation once, and redacts credentials", async () => {
    const stateStore = new InMemoryOAuthStateStore();
    const connectionStore = new InMemoryConnectionStore();
    const credentialStore = new InMemoryCredentialStore();
    const begin = await beginOAuth({
      client: { clientId: "client-id" },
      grant: { _tag: "domains", domains: [parseDomainName("example.com")] },
      method,
      now: () => new Date("2026-08-27T00:00:00.000Z"),
      redirectUri: "https://app.example/oauth/callback",
      stateStore: stateStore.promise,
      subjectId: "user-1",
    });
    expect(begin.authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    const state = begin.authorizationUrl.searchParams.get("state")!;

    let requestBody = "";
    const fetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requestBody = String(init?.body);
      return Response.json({
        access_token: "access-token-value",
        expires_in: 3600,
        refresh_token: "refresh-token-value",
        scope: "dns:read dns:write",
        token_type: "Bearer",
      });
    };
    const callbackUrl = new URL("https://app.example/oauth/callback");
    callbackUrl.search = new URLSearchParams({ code: "authorization-code", state }).toString();
    const connection = await completeOAuth({
      callbackUrl,
      client: { clientId: "client-id" },
      connectionStore: connectionStore.promise,
      credentialStore: credentialStore.promise,
      fetch,
      now: () => new Date("2026-08-27T00:01:00.000Z"),
      providerId: "example-provider",
      resolveSubject: async (_tokens, accessToken) => {
        expect(accessToken.expose()).toBe("access-token-value");
        return { accountId: "account-1", expiresAt: "2026-08-27T01:01:00.000Z" };
      },
      stateStore: stateStore.promise,
    });

    expect(requestBody).toContain("code_verifier=");
    expect(requestBody).toContain("code=authorization-code");
    expect(JSON.stringify(connection)).not.toContain("token-value");
    expect(JSON.stringify(await credentialStore.promise.get(connection.id))).toContain(
      "[REDACTED]",
    );
    expect(JSON.stringify(await credentialStore.promise.get(connection.id))).not.toContain(
      "token-value",
    );
    expect(
      assertConnectionGrant(connection, {
        accountId: "account-1",
        capability: "dns:read",
        domain: "example.com",
        now: new Date("2026-08-27T00:02:00.000Z"),
        providerId: "example-provider",
      }),
    ).toBe("example.com");
    expect(() =>
      assertConnectionGrant(connection, {
        accountId: "account-1",
        capability: "dns:read",
        domain: "other.example.com",
        now: new Date("2026-08-27T00:02:00.000Z"),
        providerId: "example-provider",
      }),
    ).toThrow();

    await expect(
      completeOAuth({
        callbackUrl,
        client: { clientId: "client-id" },
        connectionStore: connectionStore.promise,
        credentialStore: credentialStore.promise,
        fetch,
        providerId: "example-provider",
        resolveSubject: async () => ({ accountId: "account-1", expiresAt: null }),
        stateStore: stateStore.promise,
      }),
    ).rejects.toMatchObject({ _tag: "AuthorizationError" });
  });

  it("expires continuations and never serializes secret values", async () => {
    const stateStore = new InMemoryOAuthStateStore();
    const begin = await beginOAuth({
      client: { clientId: "client-id", clientSecret: Secret.from("client-secret") },
      grant: { _tag: "account" },
      method: { ...method, clientAuth: "client_secret_basic" },
      now: () => new Date("2026-08-27T00:00:00.000Z"),
      redirectUri: "https://app.example/oauth/callback",
      stateStore: stateStore.promise,
      subjectId: "user-1",
      ttlMs: 1,
    });
    const callbackUrl = new URL("https://app.example/oauth/callback");
    callbackUrl.searchParams.set("code", "code");
    callbackUrl.searchParams.set("state", begin.authorizationUrl.searchParams.get("state")!);
    await expect(
      completeOAuth({
        callbackUrl,
        client: { clientId: "client-id", clientSecret: Secret.from("client-secret") },
        connectionStore: new InMemoryConnectionStore().promise,
        credentialStore: new InMemoryCredentialStore().promise,
        now: () => new Date("2026-08-27T00:00:01.000Z"),
        providerId: "example-provider",
        resolveSubject: async () => ({ accountId: "account-1", expiresAt: null }),
        stateStore: stateStore.promise,
      }),
    ).rejects.toMatchObject({ _tag: "AuthorizationError" });
    expect(JSON.stringify(Secret.from("never-visible"))).toBe('"[REDACTED]"');
  });

  it("refreshes and revokes only when provider capabilities and credentials allow it", async () => {
    const credentialStore = new InMemoryCredentialStore();
    const connection: Connection = {
      accountId: "account-1",
      capabilities: ["dns:read", "dns:write"],
      createdAt: "2026-08-27T00:00:00.000Z",
      expiresAt: null,
      grant: { _tag: "account" },
      id: "connection-1",
      kind: "oauth2",
      providerId: "example-provider",
      scopes: ["dns:write"],
      subjectId: "user-1",
    };
    await credentialStore.promise.put(connection.id, {
      accessToken: Secret.from("old-access"),
      refreshToken: Secret.from("old-refresh"),
      tokenType: "bearer",
    });
    const fetch = async (input: RequestInfo | URL): Promise<Response> => {
      if (String(input).endsWith("/token")) {
        return Response.json({
          access_token: "new-access",
          refresh_token: "new-refresh",
          token_type: "Bearer",
        });
      }
      return new Response(null, { status: 200 });
    };

    await refreshOAuth({
      client: { clientId: "client-id" },
      connection,
      credentialStore: credentialStore.promise,
      fetch,
      method,
    });
    expect((await credentialStore.promise.get(connection.id))?.accessToken.expose()).toBe(
      "new-access",
    );
    await revokeOAuth({
      client: { clientId: "client-id" },
      connection,
      credentialStore: credentialStore.promise,
      fetch,
      method,
    });
    expect(await credentialStore.promise.get(connection.id)).toBeNull();

    await expect(
      revokeOAuth({
        client: { clientId: "client-id" },
        connection,
        credentialStore: credentialStore.promise,
        method: {
          ...method,
          authorizationServer: {
            authorization_endpoint: method.authorizationServer.authorization_endpoint,
            issuer: method.authorizationServer.issuer,
            token_endpoint: method.authorizationServer.token_endpoint,
          },
        },
      }),
    ).rejects.toMatchObject({ _tag: "AuthorizationError" });
  });
});
