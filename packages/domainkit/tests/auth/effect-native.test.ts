import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { Connection, Digest, ManagedDnsConnections, Secret } from "../../src/index.ts";
import * as ProviderAuthorization from "../../src/auth/authorization.ts";
import {
  InMemoryConnectionContinuations,
  InMemoryManagedDnsConnections,
} from "../../src/testing.ts";

const authentication = (token = "token"): Connection.Authentication => ({
  capabilityEvidence: [
    {
      capability: "dns:read",
      evidence: ProviderAuthorization.Evidence.Introspected({ observedAt: new Date() }),
    },
    {
      capability: "dns:write",
      evidence: ProviderAuthorization.Evidence.Introspected({ observedAt: new Date() }),
    },
  ],
  credential: {
    accessToken: Secret.make(token),
    refreshToken: null,
    tokenType: "bearer",
  },
  expiresAt: null,
  providerAccountId: "account-1",
  providerContext: { value: {}, version: "example.v1" },
  scopes: ["dns:write"],
});

describe("Effect-native managed DNS connections", () => {
  it.effect("returns a public connection while retaining lifecycle state privately", () => {
    const repository = InMemoryManagedDnsConnections.make();
    const layer = Layer.merge(
      Layer.succeed(ManagedDnsConnections.Service, repository),
      Digest.webCryptoLayer,
    );
    return Effect.gen(function* () {
      const result = yield* Connection.start({
        authorizedById: "user-1",
        method: Connection.Method.Token({
          authenticate: () => Effect.succeed(authentication()),
          providerId: "example",
          requiredCapabilities: ["dns:read", "dns:write"],
          token: Secret.make("token"),
        }),
        ownerId: "organization-1",
      });
      assert.strictEqual(result._tag, "Connected");
      if (result._tag !== "Connected") return;
      assert.deepStrictEqual(Object.keys(result.connection).sort(), [
        "createdAt",
        "id",
        "method",
        "ownerId",
        "providerId",
        "status",
      ]);
      const aggregate = yield* repository.getByConnectionId(result.connection.id);
      assert.strictEqual(aggregate?.connections.length, 1);
      assert.strictEqual(aggregate?.attachments.length, 0);
      assert.strictEqual(aggregate?.credential.accessToken.expose(), "token");
    }).pipe(Effect.provide(layer));
  });

  it.effect("completes an interactive connection once and rejects continuation replay", () => {
    const repository = InMemoryManagedDnsConnections.make();
    const continuations = InMemoryConnectionContinuations.make();
    const flow: Connection.InteractiveFlow = {
      complete: () => Effect.succeed(authentication("oauth-token")),
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
      Layer.succeed(ManagedDnsConnections.Service, repository),
      Digest.webCryptoLayer,
    );
    return Effect.gen(function* () {
      const started = yield* Connection.start({
        authorizedById: "user-1",
        method: Connection.Method.Interactive({ continuations, flow }),
        ownerId: "organization-1",
      });
      assert.strictEqual(started._tag, "Redirect");
      if (started._tag !== "Redirect") return;
      const completed = yield* Connection.complete({
        callbackUrl: new URL("https://app.example/callback?code=one"),
        continuationId: started.continuationId,
        continuations,
        flow,
      });
      assert.strictEqual(completed.method, "oauth2");
      assert.strictEqual(completed.ownerId, "organization-1");
      const replay = yield* Connection.complete({
        callbackUrl: new URL("https://app.example/callback?code=two"),
        continuationId: started.continuationId,
        continuations,
        flow,
      }).pipe(Effect.result);
      assert.strictEqual(replay._tag, "Failure");
    }).pipe(Effect.provide(layer));
  });
});
