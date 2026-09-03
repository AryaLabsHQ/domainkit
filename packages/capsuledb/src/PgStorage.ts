/**
 * The layer a host installs: DomainKit's `Storage` on the host's own PostgreSQL client.
 *
 * `layer()` runs the capsule through CapsuleDB's registry, which creates the ledger, applies
 * pending migrations, and only then provides `Storage`. A host that owns its migration pipeline
 * applies `capsuledb emit` output instead and boots with `mode: "assert"`, which touches no schema
 * and fails unless the database already matches the capsule.
 *
 * The layer requires only `SqlClient`: credentials arrive sealed, so Storage never needs `Custody`.
 */
import { Pg, type Registry as RegistryTypes, Registry } from "capsuledb";
import type { Storage } from "domainkit";
import type * as Layer from "effect/Layer";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import { capsule, DEFAULT_PREFIX, make } from "./capsule.ts";

export interface Options {
  /** Table prefix. Default `domainkit`. Part of the physical layout; immutable after first deploy. */
  readonly prefix?: string;
  /** `prepare` (default) migrates at boot; `assert` expects the host applied `capsuledb emit` output. */
  readonly mode?: "prepare" | "assert";
  /**
   * Prefix for CapsuleDB's own ledger tables; default `capsuledb`. Set it only to match a prefix a
   * host already uses for other capsules, and pass the same value to `capsuledb emit --prefix`.
   */
  readonly registryPrefix?: string;
}

export const layer = (
  options: Options = {},
): Layer.Layer<Storage.Storage, RegistryTypes.RegistryRuntimeError, SqlClient.SqlClient> =>
  Registry.layer({
    provider: Pg.profile,
    capsules: [
      options.prefix === undefined || options.prefix === DEFAULT_PREFIX
        ? capsule
        : make(options.prefix),
    ],
    ...(options.mode === undefined ? {} : { mode: options.mode }),
    ...(options.registryPrefix === undefined ? {} : { prefix: options.registryPrefix }),
  });
