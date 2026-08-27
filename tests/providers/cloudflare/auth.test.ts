import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type * as oauth from "oauth4webapi";

import { Secret } from "../../../src/effect.ts";
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
});
