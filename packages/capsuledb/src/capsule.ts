/**
 * DomainKit's CapsuleDB capsule: six tables and one `Storage.Service` implementation.
 *
 * The capsule is a plain value, so a host imports it, points `capsuledb emit` at it, or hands it
 * to `Registry.layer` without running an Effect first.
 */
import { Capsule, Migration } from "capsuledb";
import { Storage } from "domainkit";
import { Layer } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import { make as makeService } from "./internal/storage.ts";
import { DEFAULT_PREFIX, list, make as makeTables } from "./internal/tables.ts";

export { DEFAULT_PREFIX };

/**
 * Build the capsule for a table prefix.
 *
 * The prefix is part of the physical layout: it changes the rendered DDL and therefore the
 * migration checksums, so a deployed registry must keep the prefix it was created with.
 */
export const make = (
  prefix: string = DEFAULT_PREFIX,
): Capsule.Capsule<Storage.Service, never, SqlClient.SqlClient> => {
  const tables = makeTables(prefix);
  return Capsule.make({
    id: "domainkit.storage",
    tables: list(tables),
    migrations: [
      Migration.make({
        id: 1,
        name: "create-storage",
        risk: "additive",
        steps: list(tables).map(Migration.createTable),
      }),
    ],
    layer: Layer.effect(Storage.Service)(makeService(tables)),
  });
};

/** The capsule under the default `domainkit` prefix. `capsuledb emit --export capsule` reads this. */
export const capsule: Capsule.Capsule<Storage.Service, never, SqlClient.SqlClient> = make();
