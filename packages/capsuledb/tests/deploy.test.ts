import { Pg, Registry } from "capsuledb";
import { Principal, Storage } from "domainkit";
import { Effect, Layer, Option } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Statement from "effect/unstable/sql/Statement";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";

import { PgStorage } from "../src/index.ts";
import { type Postgres, start } from "./postgres.ts";

let postgres: Postgres | undefined;

beforeAll(async () => {
  postgres = await start();
}, 180_000);

afterAll(async () => {
  await postgres?.stop();
});

const principal = Principal.make({ ownerId: "org-deploy", actorId: "actor" });

/** Each case owns its table and ledger prefixes, so an empty database is one nobody prepared. */
const options = (name: string) => ({ prefix: `${name}_dk`, registryPrefix: `${name}_cdb` });

const client = () => {
  if (postgres === undefined) throw new Error("the Postgres container was not started");
  return postgres.layer;
};

/** Run an effect on the shared client, handing it a reader for the statements sent so far. */
const counted = <A, E>(
  use: (statements: () => number) => Effect.Effect<A, E, SqlClient.SqlClient>,
) => {
  let statements = 0;
  return Effect.runPromise(
    use(() => statements).pipe(
      Effect.provide(client()),
      Effect.provideService(Statement.CurrentTransformer, (statement) =>
        Effect.sync(() => {
          statements += 1;
          return statement;
        }),
      ),
    ),
  );
};

const firstRead = Effect.gen(function* () {
  const storage = yield* Storage.Service;
  return yield* storage.readiness.get("app.example.com");
}).pipe(Effect.provideService(Principal.Service, principal));

describe("PgStorage at deploy time", () => {
  it("manifests exactly what a boot prepare records", async () => {
    const shape = options("fingerprint");
    const manifest = await Effect.runPromise(PgStorage.manifest(shape));
    const ready = await Effect.runPromise(
      Effect.gen(function* () {
        yield* Layer.build(PgStorage.layer(shape));
        // What a deploy stack does: ship the manifest as JSON and read it back.
        return yield* Registry.assert({
          provider: Pg.profile,
          manifest: JSON.parse(JSON.stringify(manifest)),
          prefix: shape.registryPrefix,
        });
      }).pipe(Effect.scoped, Effect.provide(client())),
    );
    assert.strictEqual(ready.fingerprint, manifest.fingerprint);
    // The manifest follows the prefix, so a stack cannot prepare one layout and the host assert another.
    const other = await Effect.runPromise(PgStorage.manifest());
    assert.notStrictEqual(other.fingerprint, manifest.fingerprint);
  }, 180_000);

  it("builds a first-use layer with no statement and checks once on first use", async () => {
    const shape = options("prepared");
    // The counter has to see a boot prepare, or a zero below would prove nothing.
    const prepared = await counted((statements) =>
      Layer.build(PgStorage.layer(shape)).pipe(
        Effect.map(() => statements()),
        Effect.scoped,
      ),
    );
    assert.ok(prepared > 0);

    const sent = await counted((statements) =>
      Effect.gen(function* () {
        const context = yield* Layer.build(
          PgStorage.layer({ ...shape, mode: "assert", readiness: "first-use" }),
        );
        const built = statements();
        const read = firstRead.pipe(Effect.provide(context));
        const first = yield* read;
        const afterFirst = statements();
        yield* read;
        const afterSecond = statements();
        yield* read;
        const afterThird = statements();
        assert.ok(Option.isNone(first));
        return {
          built,
          first: afterFirst - built,
          second: afterSecond - afterFirst,
          third: afterThird - afterSecond,
        };
      }).pipe(Effect.scoped),
    );
    assert.strictEqual(sent.built, 0);
    // The first query carries the one registry check; later queries send only their own statement.
    assert.ok(sent.first > sent.second, `first ${sent.first} should exceed second ${sent.second}`);
    assert.strictEqual(sent.third, sent.second);
  }, 180_000);

  it("fails first use against an empty database, then succeeds once it is prepared", async () => {
    const shape = options("empty");
    const asserted = PgStorage.layer({ ...shape, mode: "assert", readiness: "first-use" });
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const context = yield* Layer.build(asserted);
        const use = firstRead.pipe(Effect.provide(context));
        const before = yield* Effect.exit(use);
        assert.strictEqual(before._tag, "Failure");
        // The deploy step runs after the function booted; the next use retries the check.
        yield* Layer.build(PgStorage.layer(shape));
        return yield* use;
      }).pipe(Effect.scoped, Effect.provide(client())),
    );
    assert.ok(Option.isNone(outcome));
  }, 180_000);
});
