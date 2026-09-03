import { Capsule, Migration, Pg, Registry, Schema } from "capsuledb";
import { Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql";

// #region declare
/** A library owns its tables in the host's database. Declare once; CapsuleDB renders per engine. */
const tokens = Schema.table("acme_tokens", {
  columns: {
    id: Schema.text(),
    owner_id: Schema.text(),
    consumed_at: Schema.timestamp({ nullable: true }),
    created_at: Schema.timestamp({ default: { sql: "CURRENT_TIMESTAMP" } }),
  },
  primaryKey: ["id"],
  indexes: [{ columns: ["owner_id"] }],
});

class Tokens extends Context.Service<
  Tokens,
  { readonly consume: (id: string) => Effect.Effect<boolean> }
>()("acme/Tokens") {}

export const capsule = Capsule.make({
  id: "acme.tokens",
  tables: [tokens],
  migrations: [
    Migration.make({
      id: 1,
      name: "create-tokens",
      risk: "additive",
      steps: [Migration.createTable(tokens)],
    }),
  ],
  layer: Layer.effect(Tokens)(
    Effect.map(SqlClient.SqlClient, (sql) => ({
      consume: (id: string) =>
        sql`UPDATE acme_tokens SET consumed_at = now() WHERE id = ${id} AND consumed_at IS NULL`.pipe(
          Effect.map((rows) => rows.length > 0),
          Effect.orDie,
        ),
    })),
  ),
});
// #endregion declare

// #region install
/** One layer prepares every capsule's migrations and provides every capsule service. */
export const CapsulesLive = Registry.layer({ provider: Pg.profile, capsules: [capsule] });
// #endregion install

// #region emit
/**
 * Or emit the SQL into your own migrations folder and assert at boot:
 *
 *   capsuledb emit --module ./capsule.ts --export capsule --dialect postgres --out ./drizzle
 */
export const CapsulesAsserted = Registry.layer({
  provider: Pg.profile,
  capsules: [capsule],
  mode: "assert",
});
// #endregion emit
