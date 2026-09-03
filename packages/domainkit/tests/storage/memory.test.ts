import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect } from "effect";

import { DomainKitError, Principal, Storage } from "../../src/index.ts";

const principal = Principal.make({ ownerId: "org_1", actorId: "user_1" });

describe("Storage.layerMemoryWith", () => {
  it.effect("leaves state untouched when beforeCommit fails", () =>
    Effect.gen(function* () {
      const storage = yield* Storage.Storage;
      const now = yield* DateTime.now;
      const failure = yield* storage.authorizations
        .upsert({
          authorization: new Storage.Authorization({
            id: "auth-1",
            ownerId: principal.ownerId,
            provider: "fake",
            method: "token",
            capabilities: [],
            context: null,
            revocation: "active",
            createdBy: principal.actorId,
            createdAt: now,
          }),
          credential: new Storage.Credential({ ciphertext: "x", expiresAt: null, rotatedAt: now }),
        })
        .pipe(Effect.flip);
      assert.strictEqual(failure.reason._tag, "StorageFailed");
      const missing = yield* storage.authorizations.get("auth-1").pipe(Effect.flip);
      assert.strictEqual(missing.reason._tag, "NotFound");
    }).pipe(
      Effect.provideService(Principal.Principal, principal),
      Effect.provide(
        Storage.layerMemoryWith({
          beforeCommit: (operation) =>
            DomainKitError.fail(
              new DomainKitError.StorageFailed({ operation, message: "injected commit failure" }),
            ),
        }),
      ),
    ),
  );

  it("requires a Principal for every method at the type level", () => {
    const program = Effect.flatMap(Storage.Storage, (storage) => storage.connections.list());
    // @ts-expect-error Principal is a required service, never a default.
    const runnable: Effect.Effect<unknown, unknown, Storage.Storage> = program;
    assert.ok(runnable !== undefined);
  });
});
