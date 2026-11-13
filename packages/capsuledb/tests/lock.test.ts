import { Principal, Storage } from "domainkit";
import { DateTime, Effect, Layer } from "effect";
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
        capabilities: ["dns:read"],
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

/** Advisory locks the pool's one session still holds. */
const advisoryLocks = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly locks: number }>`
    SELECT count(*)::int AS locks FROM pg_locks
    WHERE locktype = 'advisory' AND pid = pg_backend_pid()
  `;
  return rows[0]?.locks;
});

const credential = (ciphertext: string) =>
  Effect.map(
    DateTime.now,
    (now) => new Storage.Credential({ ciphertext, expiresAt: null, rotatedAt: now }),
  );

describe("withLock on a one-connection pool", () => {
  it(
    "runs the guarded refresh's reads and writes on the locked connection",
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
              yield* storage.authorizations.rotate(id, yield* credential("sealed-new"));
              return (yield* storage.authorizations.credential(id)).ciphertext;
            }),
          );
          assert.strictEqual(refreshed, "sealed-new");
          assert.strictEqual(
            (yield* storage.authorizations.credential(id)).ciphertext,
            "sealed-new",
          );
          assert.strictEqual(yield* advisoryLocks, 0);
        }),
      ),
    60_000,
  );

  it(
    "commits transactions inside the lock, top-level and nested, on the locked connection",
    () =>
      run(
        "org-one-connection-tx",
        Effect.gen(function* () {
          const storage = yield* Storage.Service;
          const sql = yield* SqlClient.SqlClient;
          const id = "auth-one-connection-tx";
          yield* seed("org-one-connection-tx", id);

          yield* storage.withLock(
            `refresh:${id}`,
            Effect.gen(function* () {
              // `promoteCapabilities` opens its own transaction over a `FOR UPDATE` row, which
              // begins at the top level here because the lock holds no transaction open.
              yield* storage.authorizations.promoteCapabilities(id, ["dns:write"]);
              yield* sql.withTransaction(
                Effect.gen(function* () {
                  yield* storage.authorizations.rotate(id, yield* credential("sealed-new"));
                  // A nested transaction is a savepoint: its failure rolls back only its own
                  // write, and the outer transaction still commits.
                  const nested = yield* Effect.flip(
                    sql.withTransaction(
                      Effect.gen(function* () {
                        yield* storage.authorizations.rotate(
                          id,
                          yield* credential("sealed-nested"),
                        );
                        return yield* Effect.fail("nested rejected" as const);
                      }),
                    ),
                  );
                  assert.strictEqual(nested, "nested rejected");
                  yield* storage.authorizations.promoteCapabilities(id, ["dns:read"]);
                }),
              );
            }),
          );

          assert.deepStrictEqual((yield* storage.authorizations.get(id)).capabilities, [
            "dns:read",
            "dns:write",
          ]);
          assert.strictEqual(
            (yield* storage.authorizations.credential(id)).ciphertext,
            "sealed-new",
          );
          assert.strictEqual(yield* advisoryLocks, 0);
        }),
      ),
    60_000,
  );

  it(
    "rolls back a failed transaction inside the lock and releases the lock",
    () =>
      run(
        "org-one-connection-fail",
        Effect.gen(function* () {
          const storage = yield* Storage.Service;
          const sql = yield* SqlClient.SqlClient;
          const id = "auth-one-connection-fail";
          yield* seed("org-one-connection-fail", id);

          const error = yield* Effect.flip(
            storage.withLock(
              `refresh:${id}`,
              sql.withTransaction(
                Effect.gen(function* () {
                  yield* storage.authorizations.rotate(id, yield* credential("sealed-discarded"));
                  assert.strictEqual(
                    (yield* storage.authorizations.credential(id)).ciphertext,
                    "sealed-discarded",
                  );
                  return yield* Effect.fail("provider rejected the refresh" as const);
                }),
              ),
            ),
          );
          assert.strictEqual(error, "provider rejected the refresh");
          assert.strictEqual(
            (yield* storage.authorizations.credential(id)).ciphertext,
            "sealed-old",
          );
          // A session may take an advisory lock it already holds, so relocking proves nothing on
          // one connection; the lock table does.
          assert.strictEqual(yield* advisoryLocks, 0);
        }),
      ),
    60_000,
  );
});
