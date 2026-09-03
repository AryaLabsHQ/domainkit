import { PgClient } from "@effect/sql-pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Effect, Exit, type Layer, Redacted, Scope } from "effect";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

export interface Postgres {
  readonly container: StartedPostgreSqlContainer;
  readonly url: string;
  readonly client: PgClient.PgClient;
  /** The host-supplied client every capsule layer sits on. */
  readonly layer: Layer.Layer<PgClient.PgClient | SqlClient.SqlClient>;
  readonly stop: () => Promise<void>;
}

/**
 * One container and one pool for a whole suite.
 *
 * The pool outlives every case, so its scope is held open here rather than inside an effect; the
 * conformance cases share it the way a deployed host shares one client.
 */
export const start = async (maxConnections = 8): Promise<Postgres> => {
  const container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("domainkit")
    .withUsername("domainkit")
    .withPassword("domainkit")
    .start();
  const scope = Effect.runSync(Scope.make());
  const url = container.getConnectionUri();
  const client = await Effect.runPromise(
    PgClient.make({ maxConnections, url: Redacted.make(url) }).pipe(
      Effect.provide(Reactivity.layer),
      Scope.provide(scope),
    ),
  );
  return {
    container,
    url,
    client,
    layer: PgClient.layerFrom(Effect.succeed(client)),
    stop: async () => {
      await Effect.runPromise(Scope.close(scope, Exit.succeed(undefined)));
      await container.stop();
    },
  };
};
