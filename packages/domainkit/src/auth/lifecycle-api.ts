/** Public surface for the cohesive managed-DNS persistence capability. */
export { AggregateSchema, Error, Service } from "./lifecycle-repository.ts";
export * as Authorization from "./authorization.ts";
export { StoredConnection } from "./connection.ts";
export type { StoredCredential } from "./connection.ts";
export type {
  Aggregate,
  AttachmentResult,
  ConnectInput,
  DetachResult,
  DisconnectResult,
  Interface,
} from "./lifecycle-repository.ts";
