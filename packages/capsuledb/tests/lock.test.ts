import { Principal, Storage } from "domainkit";
import { DateTime, Effect, Exit, Layer } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";

import { PgStorage } from "../src/index.ts";
import { type Postgres, start } from "./postgres.ts";

let postgres: Postgres | undefined;

// One connection is the pool a single-request host such as a Lambda runs with. The lock holds
// that connection for the whole guarded effect, so every storage call inside has to run on it.
beforeAll(async () => {
  postgres = await start(1);
}, 180_000);

afterAll(async () => {
  await postgres?.stop();
});

const run = <A, E>(
  ownerId: string,
  effect: Effect.Effect<A, E, Storage.Service | Principal.Service | SqlClient.SqlClient>,
) => {
  const client = postgres?.layer;
  if (client === undefined) throw new Error("the Postgres container was not started");
  return Effect.runPromise(
    effect.pipe(
      // Waiting on a second connection never resolves on its own, so bound it to fail the case.
      Effect.timeout("10 seconds"),
      Effect.provideService(Principal.Service, Principal.make({ ownerId, actorId: "actor" })),
      Effect.provide(PgStorage.layer().pipe(Layer.provideMerge(client))),
    ),
  );
};

const seed = (ownerId: string, id: string) =>
  Effect.gen(function* () {
    const storage = yield* Storage.Service;
    const now = yield* DateTime.now;
    yield* storage.authorizations.upsert({
      authorization: new Storage.Authorization({
        id,
        ownerId,
        provider: "fake",
        method: "oauth",
        capabilities: ["dns:read", "dns:write"],
        context: { account: "fake" },
        label: "Fake account",
        revocation: "active",
        createdBy: "actor",
        createdAt: now,
      }),
      credential: new Storage.Credential({
        ciphertext: "sealed-old",
        expiresAt: now,
        rotatedAt: now,
      }),
    });
  });

describe("withLock on a one-connection pool", () => {
  it(
    "runs the guarded refresh's reads and transactional rotate on the locked connection",
    () =>
      run(
        "org-one-connection",
        Effect.gen(function* () {
          const storage = yield* Storage.Service;
          const id = "auth-one-connection";
          yield* seed("org-one-connection", id);

          const refreshed = yield* storage.withLock(
            `refresh:${id}`,
            Effect.gen(function* () {
              yield* storage.authorizations.get(id);
              const latest = yield* storage.authorizations.credential(id);
              assert.strictEqual(latest.ciphertext, "sealed-old");
              yield* storage.authorizations.rotate(
                id,
                new Storage.Credential({
                  ciphertext: "sealed-new",
                  expiresAt: null,
                  rotatedAt: yield* DateTime.now,
                }),
              );
              return (yield* storage.authorizations.credential(id)).ciphertext;
            }),
          );
          assert.strictEqual(refreshed, "sealed-new");

          // The rotate committed, and the connection went back to the pool without the lock.
          assert.strictEqual(
            (yield* storage.authorizations.credential(id)).ciphertext,
            "sealed-new",
          );
          const sql = yield* SqlClient.SqlClient;
          const held = yield* sql<{ readonly locks: number }>`
            SELECT count(*)::int AS locks FROM pg_locks
            WHERE locktype = 'advisory' AND pid = pg_backend_pid()
          `;
          assert.strictEqual(held[0]?.locks, 0);
        }),
      ),
    60_000,
  );

  it(
    "rolls back a failed transaction inside the lock and still releases it",
    () =>
      run(
        "org-one-connection-fail",
        Effect.gen(function* () {
          const storage = yield* Storage.Service;
          const sql = yield* SqlClient.SqlClient;
          const id = "auth-one-connection-fail";
          yield* seed("org-one-connection-fail", id);

          const exit = yield* Effect.exit(
            storage.withLock(
              `refresh:${id}`,
              sql.withTransaction(
                Effect.gen(function* () {
                  yield* storage.authorizations.rotate(
                    id,
                    new Storage.Credential({
                      ciphertext: "sealed-discarded",
                      expiresAt: null,
                      rotatedAt: yield* DateTime.now,
                    }),
                  );
                  return yield* Effect.fail("provider rejected the refresh" as const);
                }),
              ),
            ),
          );
          assert.isTrue(Exit.isFailure(exit));
          assert.strictEqual(
            (yield* storage.authorizations.credential(id)).ciphertext,
            "sealed-old",
          );
          // The same key locks again, so the failed attempt released its session lock.
          yield* storage.withLock(`refresh:${id}`, Effect.void);
        }),
      ),
    60_000,
  );
});
