import { assert, describe, expect, it } from "@effect/vitest";

import {
  Connection,
  DomainName,
  OAuth,
  ProviderAuth,
  ProviderAuthorization,
  Secret,
} from "../../src/index.ts";
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
    revocation_endpoint: "https://auth.example/revoke",
    token_endpoint: "https://auth.example/token",
  },
  capabilities: ["dns:read", "dns:write"],
  clientAuth: "none",
  scopes: ["dns:read", "dns:write"],
};

describe("OAuth Promise facade", () => {
  it("uses PKCE and one-time state while redacting credentials", async () => {
    const state = InMemoryOAuthStateStore.make();
    const connections = InMemoryConnectionStore.make();
    const credentials = InMemoryCredentialStore.make();
    const authorizations = InMemoryProviderAuthorizationStore.make();
    const begin = await OAuth.begin({
      client: { clientId: "client-id" },
      grant: { _tag: "domains", domains: [DomainName.parse("example.com")] },
      method,
      ownerId: "organization-1",
      redirectUri: "https://app.example/oauth/callback",
      stateStore: InMemoryOAuthStateStore.toAsync(state),
      subjectId: "user-1",
    });
    assert.strictEqual(begin.authorizationUrl.searchParams.get("code_challenge_method"), "S256");
    const oauthState = begin.authorizationUrl.searchParams.get("state");
    if (oauthState === null) throw new Error("OAuth state was not generated");

    let requestBody = "";
    const fetch = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
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
    callbackUrl.search = new URLSearchParams({
      code: "authorization-code",
      state: oauthState,
    }).toString();
    const result = await OAuth.complete({
      authorizationStore: InMemoryProviderAuthorizationStore.toAsync(authorizations),
      callbackUrl,
      client: { clientId: "client-id" },
      connectionStore: InMemoryConnectionStore.toAsync(connections),
      credentialStore: InMemoryCredentialStore.toAsync(credentials),
      fetch,
      providerId: "example-provider",
      resolveSubject: async (_tokens, accessToken) => {
        assert.strictEqual(accessToken.expose(), "access-token-value");
        return { accountId: "account-1", expiresAt: new Date(Date.now() + 60_000) };
      },
      stateStore: InMemoryOAuthStateStore.toAsync(state),
    });
    const { authorization, connection } = result;

    assert.match(requestBody, /code_verifier=/);
    assert.match(requestBody, /code=authorization-code/);
    assert.notMatch(JSON.stringify(connection), /token-value/);
    assert.strictEqual(
      JSON.stringify(
        await InMemoryCredentialStore.toAsync(credentials).get(authorization.id),
      ).includes("token-value"),
      false,
    );
    assert.strictEqual(
      Connection.assertGrant(connection, authorization, {
        capability: "dns:read",
        domain: "example.com",
        providerId: "example-provider",
      }),
      "example.com",
    );
    assert.throws(() =>
      Connection.assertGrant(connection, authorization, {
        capability: "dns:read",
        domain: "other.example.com",
        providerId: "example-provider",
      }),
    );

    await expect(
      OAuth.complete({
        authorizationStore: InMemoryProviderAuthorizationStore.toAsync(authorizations),
        callbackUrl,
        client: { clientId: "client-id" },
        connectionStore: InMemoryConnectionStore.toAsync(connections),
        credentialStore: InMemoryCredentialStore.toAsync(credentials),
        fetch,
        providerId: "example-provider",
        resolveSubject: async () => ({ accountId: "account-1", expiresAt: null }),
        stateStore: InMemoryOAuthStateStore.toAsync(state),
      }),
    ).rejects.toMatchObject({ _tag: "AuthorizationError" });
  });

  it("refreshes and revokes stored credentials", async () => {
    const credentials = InMemoryCredentialStore.make();
    const asyncCredentials = InMemoryCredentialStore.toAsync(credentials);
    const authorization: ProviderAuthorization.ProviderAuthorization = {
      accountId: "account-1",
      capabilities: ["dns:read", "dns:write"],
      createdAt: new Date("2026-08-27T00:00:00.000Z"),
      expiresAt: null,
      id: "authorization-1",
      kind: "oauth2",
      providerId: "example-provider",
      scopes: ["dns:write"],
      subjectId: "user-1",
    };
    await asyncCredentials.put(authorization.id, {
      accessToken: Secret.make("old-access"),
      refreshToken: Secret.make("old-refresh"),
      tokenType: "bearer",
    });
    const fetch = async (input: RequestInfo | URL): Promise<Response> =>
      String(input).endsWith("/token")
        ? Response.json({
            access_token: "new-access",
            refresh_token: "new-refresh",
            token_type: "Bearer",
          })
        : new Response(null, { status: 200 });

    await OAuth.refresh({
      client: { clientId: "client-id" },
      authorization,
      credentialStore: asyncCredentials,
      fetch,
      method,
    });
    assert.strictEqual(
      (await asyncCredentials.get(authorization.id))?.accessToken.expose(),
      "new-access",
    );

    await OAuth.revoke({
      client: { clientId: "client-id" },
      authorization,
      credentialStore: asyncCredentials,
      fetch,
      method,
    });
    assert.strictEqual(await asyncCredentials.get(authorization.id), null);
  });

  it("rejects invalid expiration metadata returned by subject resolution", async () => {
    const state = InMemoryOAuthStateStore.make();
    const begin = await OAuth.begin({
      client: { clientId: "client-id" },
      grant: { _tag: "account" },
      method,
      ownerId: "organization-1",
      redirectUri: "https://app.example/oauth/callback",
      stateStore: InMemoryOAuthStateStore.toAsync(state),
      subjectId: "user-1",
    });
    const oauthState = begin.authorizationUrl.searchParams.get("state");
    if (oauthState === null) throw new Error("OAuth state was not generated");
    const callbackUrl = new URL("https://app.example/oauth/callback");
    callbackUrl.search = new URLSearchParams({ code: "code", state: oauthState }).toString();

    await expect(
      OAuth.complete({
        authorizationStore: InMemoryProviderAuthorizationStore.toAsync(),
        callbackUrl,
        client: { clientId: "client-id" },
        connectionStore: InMemoryConnectionStore.toAsync(),
        credentialStore: InMemoryCredentialStore.toAsync(),
        fetch: async () => Response.json({ access_token: "token", token_type: "Bearer" }),
        providerId: "example-provider",
        resolveSubject: async () => ({
          accountId: "account-1",
          expiresAt: new Date(Number.NaN),
        }),
        stateStore: InMemoryOAuthStateStore.toAsync(state),
      }),
    ).rejects.toMatchObject({ _tag: "InvalidInputError" });
  });

  it("never serializes secret contents", () => {
    assert.strictEqual(JSON.stringify(Secret.make("never-visible")), '"[REDACTED]"');
  });
});
