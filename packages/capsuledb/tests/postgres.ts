import { PgClient } from "@effect/sql-pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Effect, Redacted } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";

export const withPostgres = <A, E>(
  effect: (client: PgClient.PgClient) => Effect.Effect<A, E, SqlClient.SqlClient>,
  maxConnections = 4,
): Effect.Effect<A, E | SqlError> =>
  Effect.acquireUseRelease(
    Effect.promise(() =>
      new PostgreSqlContainer("postgres:16-alpine")
        .withDatabase("domainkit")
        .withUsername("domainkit")
        .withPassword("domainkit")
        .start(),
    ),
    (container: StartedPostgreSqlContainer) =>
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* PgClient.make({
            maxConnections,
            url: Redacted.make(container.getConnectionUri()),
          }).pipe(Effect.provide(Reactivity.layer));
          return yield* effect(client).pipe(
            Effect.provide(PgClient.layerFrom(Effect.succeed(client))),
          );
        }),
      ),
    (container: StartedPostgreSqlContainer) => Effect.promise(() => container.stop()),
  );
