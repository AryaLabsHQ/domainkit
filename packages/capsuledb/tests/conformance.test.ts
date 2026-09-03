import { Storage } from "domainkit";
import { Testing } from "domainkit/testing";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { afterAll, beforeAll, describe, it } from "@effect/vitest";

import { PgStorage } from "../src/index.ts";
import { type Postgres, start } from "./postgres.ts";

let postgres: Postgres | undefined;
let scope: Scope.Closeable | undefined;
let service: Storage.Service | undefined;

/**
 * The service the suite prepared, deferred so cases can register before the container exists.
 *
 * Every case shares one prepared database, which is what a deployment looks like; the suite's
 * cases already use disjoint identifiers.
 */
const layer = Layer.effect(Storage.Storage)(
  Effect.suspend(() =>
    service === undefined
      ? Effect.die(new Error("the Postgres container was not started"))
      : Effect.succeed(service),
  ),
);

beforeAll(async () => {
  postgres = await start();
  scope = Effect.runSync(Scope.make());
  const context = await Effect.runPromise(
    Scope.provide(Layer.build(PgStorage.layer().pipe(Layer.provide(postgres.layer))), scope),
  );
  service = Context.get(context, Storage.Storage);
}, 180_000);

afterAll(async () => {
  if (scope !== undefined) await Effect.runPromise(Scope.close(scope, Exit.succeed(undefined)));
  await postgres?.stop();
});

describe("Storage conformance on PostgreSQL", () => {
  Testing.conformance.storage(layer, { it: (name, run) => void it(name, run) });
});
