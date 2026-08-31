import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type * as oauth from "oauth4webapi";

import { Digest, DomainName, Secret } from "../../../src/index.ts";
import * as Cloudflare from "../../../src/providers/cloudflare/index.ts";
import { page, recordedFetch, single, zone } from "./fixtures.ts";

describe("Cloudflare authentication", () => {
  it("builds OAuth methods from Cloudflare-assigned scopes", () => {
    const method = Cloudflare.Auth.oauthMethod({
      capabilities: ["dns:read"],
      clientAuth: "none",
      scopes: ["zone:read", "dns_records:edit"],
    });
    assert.strictEqual(method.authorizationServer.issuer, "https://dash.cloudflare.com");
    assert.strictEqual(
      method.authorizationServer.authorization_endpoint,
      "https://dash.cloudflare.com/oauth2/auth",
    );
    assert.deepStrictEqual(method.scopes, ["zone:read", "dns_records:edit"]);
    assert.deepStrictEqual(method.capabilities, ["dns:read"]);
    assert.strictEqual(method.clientAuth, "none");
  });

  it.effect("refreshes Cloudflare credentials and preserves an unrotated refresh token", () => {
    const requests: Array<URLSearchParams> = [];
    const fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requests.push(new URLSearchParams(String(init?.body ?? "")));
      return Response.json({
        access_token: "new-access-token",
        expires_in: 3_600,
        token_type: "bearer",
      });
    };
    return Effect.gen(function* () {
      const credential = yield* Cloudflare.Auth.refreshCredential({
        client: { clientId: "client-1" },
        clientAuth: "none",
        credential: {
          accessToken: Secret.make("old-access-token"),
          expiresAt: new Date("2020-01-01T00:00:00.000Z"),
          refreshToken: Secret.make("refresh-token"),
          tokenType: "bearer",
        },
        fetch,
      });
      assert.strictEqual(credential.accessToken.expose(), "new-access-token");
      assert.strictEqual(credential.refreshToken?.expose(), "refresh-token");
      assert.ok(credential.expiresAt instanceof Date);
      assert.strictEqual(requests[0]?.get("grant_type"), "refresh_token");
      assert.strictEqual(requests[0]?.get("refresh_token"), "refresh-token");
    });
  });

  it.effect("adopts a rotated Cloudflare refresh token", () =>
    Effect.gen(function* () {
      const credential = yield* Cloudflare.Auth.refreshCredential({
        client: { clientId: "client-1" },
        clientAuth: "none",
        credential: {
          accessToken: Secret.make("old-access-token"),
          expiresAt: null,
          refreshToken: Secret.make("old-refresh-token"),
          tokenType: "bearer",
        },
        fetch: async () =>
          Response.json({
            access_token: "new-access-token",
            refresh_token: "new-refresh-token",
            token_type: "bearer",
          }),
      });
      assert.strictEqual(credential.refreshToken?.expose(), "new-refresh-token");
      assert.strictEqual(credential.expiresAt, null);
    }),
  );

  it.effect("classifies terminal Cloudflare refresh failures as reconnect-required", () =>
    Effect.gen(function* () {
      const failure = yield* Cloudflare.Auth.refreshCredential({
        client: { clientId: "client-1" },
        clientAuth: "none",
        credential: {
          accessToken: Secret.make("old-access-token"),
          expiresAt: new Date("2020-01-01T00:00:00.000Z"),
          refreshToken: Secret.make("revoked-refresh-token"),
          tokenType: "bearer",
        },
        fetch: async () =>
          Response.json(
            { error: "invalid_grant", error_description: "Refresh token revoked" },
            { status: 400 },
          ),
      }).pipe(Effect.flip);
      assert.strictEqual(failure._tag, "ConnectionError");
      if (failure._tag === "ConnectionError") {
        assert.strictEqual(failure.retry, "after-user-action");
      }
    }),
  );

  it.effect("keeps transient Cloudflare refresh failures retryable by the host", () =>
    Effect.gen(function* () {
      const failure = yield* Cloudflare.Auth.refreshCredential({
        client: { clientId: "client-1" },
        clientAuth: "none",
        credential: {
          accessToken: Secret.make("old-access-token"),
          expiresAt: new Date("2020-01-01T00:00:00.000Z"),
          refreshToken: Secret.make("refresh-token"),
          tokenType: "bearer",
        },
        fetch: async () => {
          throw new Error("network unavailable");
        },
      }).pipe(Effect.flip);
      assert.strictEqual(failure._tag, "ProviderError");
      if (failure._tag === "ProviderError") assert.strictEqual(failure.reason, "transport");
    }),
  );

  it.effect("validates an active token and probes selected-account zone access", () => {
    const recording = recordedFetch([
      {
        body: single({
          expires_on: "2030-01-01T00:00:00Z",
          id: "token-id",
          status: "active",
        }),
      },
      { body: page([zone]) },
    ]);
    const client = Cloudflare.make({
      accountId: "account-1",
      capabilities: ["dns:read"],
      fetch: recording.fetch,
      token: Secret.make("token"),
    });
    return Effect.gen(function* () {
      const validation = yield* client.validateToken();
      assert.strictEqual(validation.accountId, "account-1");
      assert.deepStrictEqual(validation.capabilities, ["dns:read"]);
      assert.strictEqual(validation.expiresAt?.toISOString(), "2030-01-01T00:00:00.000Z");
      assert.ok(recording.requests[0]?.url.endsWith("/user/tokens/verify"));
      assert.ok(recording.requests[1]?.url.includes("account.id=account-1"));
    });
  });

  it.effect("rejects disabled tokens and invalid expiry timestamps", () =>
    Effect.gen(function* () {
      for (const result of [
        { id: "token-id", status: "disabled" },
        { expires_on: "not-a-date", id: "token-id", status: "active" },
      ]) {
        const responses = [
          { body: single(result) },
          ...(result.status === "active" ? [{ body: page([zone]) }] : []),
        ];
        const client = Cloudflare.make({
          accountId: "account-1",
          capabilities: ["dns:read"],
          fetch: recordedFetch(responses).fetch,
          token: Secret.make("token"),
        });
        const failure = yield* client.validateToken().pipe(Effect.flip);
        assert.strictEqual(
          failure.reason,
          result.status === "active" ? "response" : "authentication",
        );
      }
    }),
  );

  it.effect("resolves OAuth subjects through selected-account zone access", () => {
    const recording = recordedFetch([{ body: page([zone]) }]);
    const resolve = Cloudflare.Auth.subjectResolver({
      accountId: "account-1",
      capabilities: ["dns:read", "dns:write"],
      fetch: recording.fetch,
    });
    const tokens = {
      access_token: "oauth-access-token",
      expires_in: 900,
      token_type: "bearer",
    } as oauth.TokenEndpointResponse;
    return Effect.gen(function* () {
      const subject = yield* resolve(tokens, Secret.make("oauth-access-token"));
      assert.strictEqual(subject.accountId, "account-1");
      assert.ok(subject.expiresAt instanceof Date);
      assert.ok(recording.requests[0]?.url.includes("/zones?"));
      assert.ok(!recording.requests[0]?.url.includes("/tokens/verify"));
    });
  });

  it.effect("discovers an OAuth subject from the nearest accessible parent zone", () => {
    const parentZone = { ...zone, name: "domlens.dev" };
    const recording = recordedFetch([
      { body: page([]) },
      { body: page([]) },
      { body: page([parentZone]) },
    ]);
    const resolve = Cloudflare.Auth.subjectResolver({
      capabilities: ["dns:read", "dns:write"],
      domain: DomainName.parse("mail.dk-live.domlens.dev"),
      fetch: recording.fetch,
    });
    const tokens = {
      access_token: "oauth-access-token",
      expires_in: 900,
      token_type: "bearer",
    } as oauth.TokenEndpointResponse;
    return Effect.gen(function* () {
      const subject = yield* resolve(tokens, Secret.make("oauth-access-token"));
      assert.strictEqual(subject.accountId, "account-1");
      assert.deepStrictEqual(
        recording.requests.map(({ url }) => new URL(url).searchParams.get("name")),
        ["mail.dk-live.domlens.dev", "dk-live.domlens.dev", "domlens.dev"],
      );
      assert.ok(recording.requests.every(({ url }) => !url.includes("account.id=")));
    });
  });

  it.effect("validates a token against its discovered parent-zone account", () => {
    const recording = recordedFetch([
      {
        body: single({
          expires_on: "2030-01-01T00:00:00Z",
          id: "token-id",
          status: "active",
        }),
      },
      { body: page([]) },
      { body: page([zone]) },
    ]);
    const validate = Cloudflare.Auth.tokenValidator({
      capabilities: ["dns:read", "dns:write"],
      domain: DomainName.parse("customer.example.com"),
      fetch: recording.fetch,
    });
    return Effect.gen(function* () {
      const validation = yield* validate(Secret.make("api-token"));
      assert.strictEqual(validation.accountId, "account-1");
      assert.ok(recording.requests[0]?.url.endsWith("/user/tokens/verify"));
      assert.deepStrictEqual(
        recording.requests.slice(1).map(({ url }) => new URL(url).searchParams.get("name")),
        ["customer.example.com", "example.com"],
      );
    });
  });

  it.effect("adapts token validation into canonical connection authentication", () => {
    const recording = recordedFetch([
      {
        body: single({
          expires_on: "2030-01-01T00:00:00Z",
          id: "token-id",
          status: "active",
        }),
      },
      { body: page([zone]) },
    ]);
    const method = Cloudflare.Auth.tokenConnectionMethod({
      accountId: "account-1",
      capabilities: ["dns:read", "dns:write"],
      fetch: recording.fetch,
      token: Secret.make("api-token"),
      tokenKind: "account",
    });
    return Effect.gen(function* () {
      if (method._tag !== "Token") return yield* Effect.die("expected token method");
      const authentication = yield* method.authenticate(method.token);
      assert.strictEqual(authentication.providerAccountId, "account-1");
      assert.deepStrictEqual(authentication.providerContext, {
        value: { accountId: "account-1", tokenKind: "account" },
        version: "cloudflare.v1",
      });
      assert.ok(
        authentication.capabilityEvidence.every(
          ({ evidence }) =>
            Cloudflare.Auth.contextCodec.version === "cloudflare.v1" &&
            evidence._tag === "Introspected",
        ),
      );
    });
  });

  it.effect("implements OAuth through the common interactive flow", () => {
    const requests: Array<{ readonly body: string; readonly url: string }> = [];
    const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requests.push({ body: String(init?.body ?? ""), url: String(input) });
      return String(input).endsWith("/oauth2/token")
        ? Response.json({
            access_token: "oauth-access-token",
            scope: "zone:read dns_records:edit",
            token_type: "Bearer",
          })
        : Response.json(page([zone]));
    };
    const flow = Cloudflare.Auth.oauthFlow({
      capabilities: ["dns:read", "dns:write"],
      client: { clientId: "client-1" },
      clientAuth: "none",
      domain: DomainName.parse("example.com"),
      fetch,
      redirectUri: "https://app.example/cloudflare/callback",
      scopes: ["zone:read", "dns_records:edit"],
    });
    return Effect.gen(function* () {
      const started = yield* flow.start("continuation-1");
      assert.strictEqual(started.authorizationUrl.searchParams.get("state"), "continuation-1");
      assert.strictEqual(
        started.authorizationUrl.searchParams.get("code_challenge_method"),
        "S256",
      );
      assert.strictEqual(JSON.stringify(started.payload), '"[REDACTED]"');
      const authentication = yield* flow.complete(
        started.payload,
        new URL(
          "https://app.example/cloudflare/callback?code=authorization-code&state=continuation-1",
        ),
      );
      assert.strictEqual(authentication.providerAccountId, "account-1");
      assert.match(requests[0]?.body ?? "", /code_verifier=/);
      assert.match(requests[0]?.body ?? "", /code=authorization-code/);
      assert.ok(requests[1]?.url.includes("/zones?"));
    }).pipe(Effect.provide(Digest.webCryptoLayer));
  });

  it.effect("discovers an account before verifying an account-owned token", () => {
    const recording = recordedFetch([
      { body: page([zone]) },
      {
        body: single({
          expires_on: "2030-01-01T00:00:00Z",
          id: "account-token-id",
          status: "active",
        }),
      },
    ]);
    const validate = Cloudflare.Auth.tokenValidator({
      capabilities: ["dns:read", "dns:write"],
      domain: DomainName.parse("example.com"),
      fetch: recording.fetch,
      tokenKind: "account",
    });
    return Effect.gen(function* () {
      const validation = yield* validate(Secret.make("account-api-token"));
      assert.strictEqual(validation.accountId, "account-1");
      assert.ok(recording.requests[0]?.url.includes("/zones?"));
      assert.ok(recording.requests[1]?.url.endsWith("/accounts/account-1/tokens/verify"));
    });
  });

  it.effect("fails account discovery when no zone is visible or one name is ambiguous", () =>
    Effect.gen(function* () {
      const missing = Cloudflare.Auth.subjectResolver({
        capabilities: ["dns:read"],
        domain: DomainName.parse("missing.example.com"),
        fetch: recordedFetch([{ body: page([]) }, { body: page([]) }]).fetch,
      });
      const tokens = {
        access_token: "oauth-access-token",
        token_type: "bearer",
      } as oauth.TokenEndpointResponse;
      const notFound = yield* missing(tokens, Secret.make("oauth-access-token")).pipe(Effect.flip);
      assert.strictEqual(notFound.reason, "not_found");

      const ambiguous = Cloudflare.Auth.subjectResolver({
        capabilities: ["dns:read"],
        domain: DomainName.parse("example.com"),
        fetch: recordedFetch([
          { body: page([zone, { ...zone, account: { id: "account-2", name: "Other" } }]) },
        ]).fetch,
      });
      const conflict = yield* ambiguous(tokens, Secret.make("oauth-access-token")).pipe(
        Effect.flip,
      );
      assert.strictEqual(conflict.reason, "conflict");
    }),
  );
});
