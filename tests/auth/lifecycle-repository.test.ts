import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import {
  AuthorizationLifecycle,
  Connection,
  Digest,
  ProviderAuthorization,
  Secret,
} from "../../src/effect.ts";
import { InMemoryAuthorizationLifecycle } from "../../src/testing.ts";

const authentication = (token: string): Connection.Authentication => ({
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
  credential: { accessToken: Secret.make(token), refreshToken: null, tokenType: "bearer" },
  expiresAt: null,
  providerAccountId: "account-1",
  providerContext: { value: {}, version: "cloudflare.v1" },
  scopes: ["dns:write"],
});

const connect = (ownerId: string, token: string) =>
  Connection.start({
    authorizedById: `admin:${ownerId}`,
    grant: { _tag: "account" },
    method: Connection.Method.Token({
      authenticate: () => Effect.succeed(authentication(token)),
      providerId: "cloudflare",
      requiredCapabilities: ["dns:read", "dns:write"],
      token: Secret.make(token),
    }),
    ownerId,
  });

describe("authorization lifecycle repository", () => {
  it.effect("shares an authorization and revokes only after its final binding", () => {
    const repository = InMemoryAuthorizationLifecycle.make();
    return Effect.gen(function* () {
      const first = yield* connect("organization-1", "token-1");
      const second = yield* connect("organization-2", "token-2");
      if (first._tag !== "Connected" || second._tag !== "Connected") return;
      assert.strictEqual(first.aggregate.authorization.id, second.aggregate.authorization.id);
      assert.strictEqual(second.aggregate.bindings.length, 2);
      let revocations = 0;
      const firstBinding = first.aggregate.bindings[0];
      if (firstBinding === undefined) return yield* Effect.die("first binding is missing");
      const firstDetach = yield* repository.detach({
        connectionId: firstBinding.id,
        revoke: () => Effect.sync(() => void revocations++),
      });
      assert.strictEqual(firstDetach.remainingBindings, 1);
      assert.strictEqual(revocations, 0);
      const remaining = yield* repository.get(second.aggregate.authorization.id);
      const finalBinding = remaining?.bindings[0];
      if (finalBinding === undefined) return yield* Effect.die("final binding is missing");
      const finalDetach = yield* repository.detach({
        connectionId: finalBinding.id,
        revoke: () => Effect.sync(() => void revocations++),
      });
      assert.strictEqual(finalDetach.revokedAuthorization, true);
      assert.strictEqual(revocations, 1);
      assert.strictEqual(yield* repository.get(second.aggregate.authorization.id), null);
    }).pipe(
      Effect.provide(
        Layer.merge(
          Layer.succeed(AuthorizationLifecycle.Service, repository),
          Digest.webCryptoLayer,
        ),
      ),
    );
  });

  it.effect("retains a fail-closed revocation and resumes it through recovery", () => {
    const repository = InMemoryAuthorizationLifecycle.make();
    return Effect.gen(function* () {
      const result = yield* connect("organization-1", "token");
      if (result._tag !== "Connected") return;
      const binding = result.aggregate.bindings[0];
      if (binding === undefined) return yield* Effect.die("connection binding is missing");
      yield* repository
        .detach({
          connectionId: binding.id,
          revoke: () => Effect.fail("provider unavailable" as const),
        })
        .pipe(Effect.flip);
      const pending = yield* repository.get(result.aggregate.authorization.id);
      assert.strictEqual(pending?.authorization.revocation._tag, "Pending");
      assert.strictEqual(pending?.bindings.length, 1);
      let retried = false;
      yield* repository.recover({
        authorizationId: result.aggregate.authorization.id,
        revoke: () => Effect.sync(() => void (retried = true)),
      });
      assert.strictEqual(retried, true);
      assert.strictEqual(yield* repository.get(result.aggregate.authorization.id), null);
    }).pipe(
      Effect.provide(
        Layer.merge(
          Layer.succeed(AuthorizationLifecycle.Service, repository),
          Digest.webCryptoLayer,
        ),
      ),
    );
  });

  it.effect("does not expose partial state when an aggregate commit fails", () => {
    let failed = false;
    const repository = InMemoryAuthorizationLifecycle.make({
      beforeCommit: (operation) =>
        operation === "connect" && !failed
          ? Effect.sync(() => void (failed = true)).pipe(
              Effect.andThen(
                Effect.fail(
                  new AuthorizationLifecycle.Error({
                    category: "storage",
                    message: "injected commit failure",
                    operation,
                    retry: "safe",
                  }),
                ),
              ),
            )
          : Effect.void,
    });
    return Effect.gen(function* () {
      yield* connect("organization-1", "token").pipe(Effect.flip);
      assert.strictEqual(yield* repository.findByProviderAccount("cloudflare", "account-1"), null);
      const retry = yield* connect("organization-1", "token");
      assert.strictEqual(retry._tag, "Connected");
    }).pipe(
      Effect.provide(
        Layer.merge(
          Layer.succeed(AuthorizationLifecycle.Service, repository),
          Digest.webCryptoLayer,
        ),
      ),
    );
  });
});
