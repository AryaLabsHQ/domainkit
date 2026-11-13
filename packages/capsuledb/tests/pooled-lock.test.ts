import { PgClient } from "@effect/sql-pg";
import { DomainKit, Principal, Storage } from "domainkit";
import { DateTime, Deferred, Effect, Fiber, Layer, Option, Redacted } from "effect";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as SqlClient from "effect/sql/SqlClient";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";

import { PgStorage } from "../src/index.ts";
import { type Pooled, startPooled } from "./pooler.ts";

let pooled: Pooled | undefined;

const client = (url: string) =>
  PgClient.layer({ url: Redacted.make(url), maxConnections: 1, prepare: false }).pipe(
    Layer.provide(Reactivity.layer),
  );

const urls = () => {
  if (pooled === undefined) throw new Error("the pooled Postgres was not started");
  return pooled;
};

beforeAll(async () => {
  pooled = await startPooled();
  // Prepare the schema over the direct port, as a deploy does.
  await Effect.runPromise(
    Effect.asVoid(Storage.Service).pipe(
      Effect.provide(PgStorage.layer().pipe(Layer.provide(client(urls().directUrl)))),
    ),
  );
}, 180_000);

afterAll(async () => {
  await pooled?.stop();
});

/** One host invocation: its own one-connection pool on the pooled URL, as a Lambda runs it. */
const host = <A, E>(
  effect: Effect.Effect<A, E, Storage.Service | Principal.Service | SqlClient.SqlClient>,
) =>
  effect.pipe(
    Effect.provideService(Principal.Service, Principal.make({ ownerId: "org", actorId: "actor" })),
    Effect.provide(
      PgStorage.layer({ mode: "assert" }).pipe(Layer.provideMerge(client(urls().pooledUrl))),
    ),
  );

const guarded = (key: string, hold: Effect.Effect<void>) =>
  host(
    Effect.gen(function* () {
      const storage = yield* Storage.Service;
      const sql = yield* SqlClient.SqlClient;
      return yield* storage.withLock(
        key,
        Effect.gen(function* () {
          yield* sql`SELECT 1`;
          yield* hold; // the provider call
          yield* sql`SELECT 1`;
          return "ran" as const;
        }),
      );
    }),
  ).pipe(Effect.catchIf(DomainKit.isError, (error) => Effect.succeed(error.reason._tag)));

const authorize = (id: string) =>
  Effect.gen(function* () {
    const storage = yield* Storage.Service;
    const now = yield* DateTime.now;
    yield* storage.authorizations.upsert({
      authorization: new Storage.Authorization({
        id,
        ownerId: "org",
        provider: "fake",
        method: "oauth",
        capabilities: ["dns:read"],
        context: { account: "fake" },
        label: null,
        revocation: "active",
        createdBy: "actor",
        createdAt: now,
      }),
      credential: new Storage.Credential({ ciphertext: "sealed", expiresAt: null, rotatedAt: now }),
    });
  });

const stored = (id: string) =>
  Effect.gen(function* () {
    const storage = yield* Storage.Service;
    return yield* storage.authorizations.get(id).pipe(
      Effect.map(Option.some),
      Effect.catchIf(DomainKit.isError, () => Effect.succeed(Option.none())),
    );
  });

const continuation = (id: string, expiresIn: { readonly minutes: number }) =>
  Effect.map(
    DateTime.now,
    (now) =>
      new Storage.Continuation({
        id,
        ownerId: "org",
        actorId: "actor",
        provider: "fake",
        payload: { codeVerifier: "v" },
        returnTo: null,
        expiresAt: DateTime.add(now, expiresIn),
      }),
  );

/** Advisory locks any server session holds, read past the pooler. */
const heldLocks = Effect.suspend(() =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly locks: number }>`
    SELECT count(*)::int AS locks FROM pg_locks WHERE locktype = 'advisory'
  `;
    return rows[0]?.locks;
  }).pipe(Effect.provide(client(urls().directUrl))),
);

describe("withLock through PgBouncer in transaction mode", () => {
  it.live(
    "leaves no lock behind when invocations overlap",
    () =>
      Effect.gen(function* () {
        const keys = Array.from({ length: 12 }, (_, index) => `refresh:auth-${index}`);
        const overlapping = yield* Effect.all(
          keys.map((key, index) => guarded(key, Effect.sleep(`${50 + index * 20} millis`))),
          { concurrency: "unbounded" },
        );
        assert.deepStrictEqual(
          overlapping,
          keys.map(() => "ran"),
        );
        assert.strictEqual(yield* heldLocks, 0);

        const later = yield* Effect.all(
          keys.map((key) => guarded(key, Effect.void)),
          { concurrency: 1 },
        );
        assert.deepStrictEqual(
          later,
          keys.map(() => "ran"),
        );
      }),
    60_000,
  );

  it.live(
    "fails Busy while another invocation holds the key, and frees it afterwards",
    () =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const holder = yield* Effect.forkChild(
          guarded(
            "refresh:auth-held",
            Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release)),
          ),
        );
        yield* Deferred.await(entered);
        assert.strictEqual(yield* guarded("refresh:auth-held", Effect.void), "Busy");
        yield* Deferred.succeed(release, undefined);
        assert.strictEqual(yield* Fiber.join(holder), "ran");
        assert.strictEqual(yield* guarded("refresh:auth-held", Effect.void), "ran");
        assert.strictEqual(yield* heldLocks, 0);
      }),
    60_000,
  );

  it.live(
    "rolls back the guarded effect's writes when it fails",
    () =>
      Effect.gen(function* () {
        const failed = yield* host(
          Effect.gen(function* () {
            const storage = yield* Storage.Service;
            return yield* Effect.flip(
              storage.withLock(
                "refresh:auth-rollback",
                Effect.andThen(
                  authorize("auth-rollback"),
                  Effect.fail("provider refused" as const),
                ),
              ),
            );
          }),
        );
        assert.strictEqual(failed, "provider refused");
        assert.isTrue(Option.isNone(yield* host(stored("auth-rollback"))));
      }),
    60_000,
  );

  it.live(
    "keeps earlier writes when the guarded effect recovers from a failed statement",
    () =>
      Effect.gen(function* () {
        yield* host(
          Effect.gen(function* () {
            const storage = yield* Storage.Service;
            yield* storage.continuations.put(yield* continuation("cont-blocked", { minutes: 15 }));
          }),
        );
        // Another session holds the continuation row, so the guarded effect's delete times out.
        const locked = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const blocker = yield* Effect.forkChild(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql.withTransaction(
              Effect.gen(function* () {
                yield* sql`SELECT id FROM domainkit_continuations WHERE id = 'cont-blocked' FOR UPDATE`;
                yield* Deferred.succeed(locked, undefined);
                yield* Deferred.await(release);
              }),
            );
          }).pipe(Effect.provide(client(urls().directUrl))),
        );
        yield* Deferred.await(locked);

        const consumed = yield* host(
          Effect.gen(function* () {
            const storage = yield* Storage.Service;
            const sql = yield* SqlClient.SqlClient;
            return yield* storage.withLock(
              "continuation:cont-blocked",
              Effect.gen(function* () {
                yield* authorize("auth-recovered");
                yield* sql`SET LOCAL lock_timeout = '200ms'`;
                // `completeOutcome` ignores a failed consume once the connection is saved.
                return yield* storage.continuations.consume("cont-blocked").pipe(
                  Effect.as("consumed" as const),
                  Effect.catchIf(DomainKit.isError, (error) => Effect.succeed(error.reason._tag)),
                );
              }),
            );
          }),
        );
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(blocker);

        assert.strictEqual(consumed, "StorageFailed");
        assert.isTrue(Option.isSome(yield* host(stored("auth-recovered"))));
      }),
    60_000,
  );

  it.live(
    "keeps a write whose call fails with a DomainKit error, as outside a transaction",
    () =>
      Effect.gen(function* () {
        const reason = yield* host(
          Effect.gen(function* () {
            const storage = yield* Storage.Service;
            yield* storage.continuations.put(yield* continuation("cont-expired", { minutes: -1 }));
            return yield* storage.withLock(
              "continuation:cont-expired",
              storage.continuations.consume("cont-expired").pipe(
                Effect.as("consumed"),
                Effect.catchIf(DomainKit.isError, (error) => Effect.succeed(error.reason._tag)),
              ),
            );
          }),
        );
        assert.strictEqual(reason, "Expired");
        // The delete is the claim, expired or not, so the row is gone.
        const again = yield* host(
          Effect.gen(function* () {
            const storage = yield* Storage.Service;
            return yield* storage.continuations.consume("cont-expired").pipe(
              Effect.as("consumed"),
              Effect.catchIf(DomainKit.isError, (error) => Effect.succeed(error.reason._tag)),
            );
          }),
        );
        assert.strictEqual(again, "NotFound");
      }),
    60_000,
  );
});
