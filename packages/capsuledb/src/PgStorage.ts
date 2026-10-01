/**
 * The layer a host installs: DomainKit's `Storage` on the host's own PostgreSQL client.
 *
 * `layer()` runs the capsule through CapsuleDB's registry, which creates the ledger, applies
 * pending migrations, and only then provides `Storage`. A host that owns its migration pipeline
 * applies `capsuledb emit` output instead and boots with `mode: "assert"`, which touches no schema
 * and fails unless the database already matches the capsule.
 *
 * A serverless host prepares at deploy time instead: `manifest()` yields the manifest of exactly the
 * capsule `layer()` installs, a deploy stack hands it to `capsuledb/alchemy`, and the function boots
 * with `mode: "assert"` and `readiness: "first-use"`, which builds without a statement and checks the
 * database once, on the first Storage query.
 *
 * The layer requires only `SqlClient`: credentials arrive sealed, so Storage never needs `Custody`.
 */
import { Pg, type Manifest, type Registry as RegistryTypes, Registry } from "capsuledb";
import type { Storage } from "domainkit";
import type * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import type * as SqlClient from "effect/sql/SqlClient";

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
  /**
   * When the registry is checked. `boot` (default) prepares or asserts while the layer builds.
   * `first-use` builds with no statement and runs one cached check before the first Storage query,
   * so a cold start that never touches Storage does no registry work; a failed check surfaces as a
   * `SqlError` on that query and is retried on the next. Pair it with `mode: "assert"` on a host
   * whose database was prepared at deploy time.
   */
  readonly readiness?: "boot" | "first-use";
}

/** The capsule and registry prefix `layer` and `manifest` both derive from one set of options. */
const selection = (options: Options) => ({
  provider: Pg.profile,
  capsules: [
    options.prefix === undefined || options.prefix === DEFAULT_PREFIX
      ? capsule
      : make(options.prefix),
  ],
  ...(options.registryPrefix === undefined ? {} : { prefix: options.registryPrefix }),
});

export const layer = (
  options: Options = {},
): Layer.Layer<Storage.Service, RegistryTypes.RegistryRuntimeError, SqlClient.SqlClient> =>
  Registry.layer({
    ...selection(options),
    ...(options.mode === undefined ? {} : { mode: options.mode }),
    ...(options.readiness === undefined ? {} : { readiness: options.readiness }),
  });

/**
 * The CapsuleDB manifest for exactly what `layer(options)` installs, computed without touching a
 * database. A deploy stack passes it to `CapsuleDB.Registry` from `capsuledb/alchemy`, so the
 * schema it prepares is the schema the runtime asserts. Only `prefix` and `registryPrefix` affect
 * it; `mode` and `readiness` are runtime choices.
 */
export const manifest = (
  options: Pick<Options, "prefix" | "registryPrefix"> = {},
): Effect.Effect<Manifest.Manifest, RegistryTypes.RegistryError> =>
  Registry.manifest(selection(options));
