/**
 * DomainKit's `Storage` on PostgreSQL, as one declarative CapsuleDB capsule.
 *
 * Hosts install `PgStorage.layer()` under `DomainKit.layer` and supply their own `SqlClient`. The
 * `capsule` value is the same declaration `capsuledb emit` reads to write SQL for a host-owned
 * migration pipeline.
 */
import packageJson from "../package.json" with { type: "json" };

export const VERSION = packageJson.version;

export * as PgStorage from "./PgStorage.ts";
export { capsule } from "./capsule.ts";
