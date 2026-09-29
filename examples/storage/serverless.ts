import { Effect, type Redacted } from "effect";
import { PgStorage } from "@domainkit/capsuledb";
import * as CapsuleDB from "capsuledb/alchemy";

// #region prepare
/**
 * Deploy time: prepare the database with the manifest of exactly the capsule the runtime asserts.
 * Return the fingerprint so the stack can hand it to the function as a version-scoped environment
 * value, which publishes the new code only after the migration it depends on.
 */
export const prepareAtDeploy = (url: Redacted.Redacted<string>) =>
  Effect.gen(function* () {
    const manifest = yield* PgStorage.manifest();
    const registry = yield* CapsuleDB.Registry("domainkit-storage", {
      url,
      provider: "Postgres",
      manifest,
    });
    return registry.fingerprint;
  });

/** Register next to the stack's other providers. */
export const deployProviders = CapsuleDB.providers;
// #endregion prepare

// #region prefixed
/**
 * A host that renames the tables passes the same options to `manifest` and to `layer`, so the stack
 * prepares the layout the function asserts. `registryPrefix` reaches the resource as `prefix`.
 */
export const prepareRenamed = (url: Redacted.Redacted<string>) =>
  Effect.gen(function* () {
    const manifest = yield* PgStorage.manifest({
      prefix: "acme_dns",
      registryPrefix: "acme_capsules",
    });
    return yield* CapsuleDB.Registry("domainkit-storage", {
      url,
      provider: "Postgres",
      manifest,
      prefix: "acme_capsules",
    });
  });
// #endregion prefixed

// #region runtime
/**
 * Run time: the layer builds without a statement, and the first Storage query checks the database
 * once. A cold start that never reaches Storage does no registry work. A failed check surfaces as a
 * `SqlError` on that query and is retried on the next.
 */
export const StorageAtRuntime = PgStorage.layer({ mode: "assert", readiness: "first-use" });
// #endregion runtime
