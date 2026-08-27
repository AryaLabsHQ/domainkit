import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { Secret } from "../../../src/effect.ts";
import * as Vercel from "../../../src/providers/vercel/index.ts";
import { recordedFetch } from "./fixtures.ts";

const capabilities = ["dns:read", "dns:write"] as const;

describe("Vercel authorization", () => {
  it("describes token and provider-specific integration methods", () => {
    assert.deepStrictEqual(Vercel.Auth.tokenMethod(capabilities), {
      _tag: "token",
      capabilities,
      instructionsUrl: "https://vercel.com/account/settings/tokens",
    });
    assert.deepStrictEqual(Vercel.Auth.integrationMethod({ capabilities, slug: "domainkit" }), {
      _tag: "integration",
      capabilities,
      installUrl: "https://vercel.com/integrations/domainkit/new",
      tokenEndpoint: "https://api.vercel.com/v2/oauth/access_token",
    });
  });

  it.effect("exchanges a one-time integration code and retains team context", () => {
    const secret = Secret.make("integration-secret");
    const code = Secret.make("one-time-code");
    const recording = recordedFetch([
      {
        body: {
          access_token: "access-token",
          installation_id: "icfg-1",
          team_id: "team-1",
          token_type: "Bearer",
          user_id: "user-1",
        },
        expect: { method: "POST", pathname: "/v2/oauth/access_token" },
      },
    ]);
    return Effect.gen(function* () {
      const credential = yield* Vercel.Auth.exchangeCode({
        clientId: "client-1",
        clientSecret: secret,
        code,
        fetch: recording.fetch,
        redirectUri: "https://app.example/callback",
      });
      assert.strictEqual(credential.accessToken.expose(), "access-token");
      assert.deepStrictEqual(credential.context, { _tag: "team", teamId: "team-1" });
      assert.strictEqual(credential.installationId, "icfg-1");
      assert.strictEqual(credential.userId, "user-1");
      const body = new URLSearchParams(String(recording.requests[0]?.init?.body));
      assert.strictEqual(body.get("client_id"), "client-1");
      assert.strictEqual(body.get("client_secret"), secret.expose());
      assert.strictEqual(body.get("code"), code.expose());
      assert.strictEqual(
        new Headers(recording.requests[0]?.init?.headers).get("content-type"),
        "application/x-www-form-urlencoded",
      );
    });
  });

  it.effect("retains personal installation context and redacts exchange failures", () => {
    const personal = recordedFetch([
      { body: { access_token: "access-token", team_id: null, user_id: "user-1" } },
    ]);
    const denied = recordedFetch([
      {
        body: { error: { code: "invalid_grant", message: "Code is invalid" } },
        init: { status: 400 },
      },
    ]);
    const options = {
      clientId: "client-1",
      clientSecret: Secret.make("private-secret"),
      code: Secret.make("private-code"),
      redirectUri: "https://app.example/callback",
    } as const;
    return Effect.gen(function* () {
      assert.deepStrictEqual(
        (yield* Vercel.Auth.exchangeCode({ ...options, fetch: personal.fetch })).context,
        { _tag: "personal" },
      );
      const failure = yield* Vercel.Auth.exchangeCode({ ...options, fetch: denied.fetch }).pipe(
        Effect.flip,
      );
      assert.strictEqual(failure.code, "invalid_grant");
      assert.ok(!JSON.stringify(failure).includes(options.clientSecret.expose()));
      assert.ok(!JSON.stringify(failure).includes(options.code.expose()));
    });
  });
});
