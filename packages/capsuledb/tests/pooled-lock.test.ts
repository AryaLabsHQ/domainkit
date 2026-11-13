import { PgClient } from "@effect/sql-pg";
import { DomainKit, Principal, Storage } from "domainkit";
import { Deferred, Effect, Fiber, Layer, Redacted } from "effect";
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
});
