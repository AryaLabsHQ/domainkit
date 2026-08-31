import { Context, Effect, Schema } from "effect";

import * as ProviderAuthorization from "./authorization.ts";
import * as Connection from "./connection.ts";

/** Private aggregate owned by the managed-DNS persistence capability. */
export interface Aggregate {
  readonly authorization: ProviderAuthorization.ProviderAuthorization;
  readonly connections: ReadonlyArray<Connection.StoredConnection>;
  readonly attachments: ReadonlyArray<Connection.DomainAttachment>;
  readonly credential: Connection.StoredCredential;
}

/** Serializable durable state. Credential material is deliberately sealed separately. */
export const AggregateSchema = Schema.Struct({
  authorization: ProviderAuthorization.Schema,
  connections: Schema.Array(Connection.StoredConnection),
  attachments: Schema.Array(Connection.DomainAttachment),
});

export interface ConnectInput {
  readonly authorization: ProviderAuthorization.ProviderAuthorization;
  readonly connection: Connection.StoredConnection;
  readonly credential: Connection.StoredCredential;
  /** The authorization id observed before building a reuse update, if any. */
  readonly expectedAuthorizationId?: string;
  /** The owner connection id observed before building a reuse update, if any. */
  readonly expectedConnectionId?: string;
}

export interface AttachmentResult {
  readonly attachment: Connection.DomainAttachment;
  readonly connection: Connection.ProviderConnection;
}

export interface DetachResult {
  readonly attachment: Connection.DomainAttachment;
  readonly connection: Connection.ProviderConnection;
  readonly remainingAttachments: number;
}

export interface DisconnectResult {
  readonly connection: Connection.ProviderConnection;
  readonly remainingConnections: number;
  readonly revokedAuthorization: boolean;
}

export class Error extends Schema.TaggedError<Error>()("ManagedDnsLifecycleError", {
  category: Schema.Literal("storage"),
  message: Schema.String,
  operation: Schema.String,
  retry: Schema.Literals(["never", "after-user-action", "safe", "unknown"]),
}) {}

/**
 * Persistence capability for the managed-DNS model.
 *
 * Implementations own the atomic aggregate containing one provider credential authorization,
 * organization connections, and exact domain attachments. Provider authorization is deliberately
 * an implementation detail of the capability; public callers operate on the projections returned
 * by the connection and attachment methods.
 */
export interface Interface {
  readonly attach: (input: {
    readonly attachment: Connection.DomainAttachment;
    readonly connectionId: string;
    readonly ownerId: string;
  }) => Effect.Effect<AttachmentResult, Error>;
  readonly connect: (input: ConnectInput) => Effect.Effect<Aggregate, Error>;
  readonly detach: (input: {
    readonly attachmentId: string;
    readonly ownerId: string;
  }) => Effect.Effect<DetachResult, Error>;
  readonly disconnect: <E>(input: {
    readonly connectionId: string;
    readonly ownerId: string;
    readonly revoke: (
      authorization: ProviderAuthorization.ProviderAuthorization,
    ) => Effect.Effect<void, E>;
  }) => Effect.Effect<DisconnectResult, Error | E>;
  readonly findConnection: (
    ownerId: string,
    authorizationId: string,
  ) => Effect.Effect<Connection.StoredConnection | null, Error>;
  readonly get: (authorizationId: string) => Effect.Effect<Aggregate | null, Error>;
  readonly getAttachment: (
    attachmentId: string,
  ) => Effect.Effect<Connection.DomainAttachment | null, Error>;
  readonly getByConnectionId: (connectionId: string) => Effect.Effect<Aggregate | null, Error>;
  readonly listAttachments: (
    connectionId: string,
    ownerId: string,
  ) => Effect.Effect<ReadonlyArray<Connection.DomainAttachment>, Error>;
  readonly promoteEvidence: (
    authorizationId: string,
    evidence: ReadonlyArray<ProviderAuthorization.CapabilityEvidence>,
  ) => Effect.Effect<Aggregate, Error>;
  readonly recover: <E>(input: {
    readonly authorizationId: string;
    readonly revoke: (
      authorization: ProviderAuthorization.ProviderAuthorization,
    ) => Effect.Effect<void, E>;
  }) => Effect.Effect<DisconnectResult, Error | E>;
  readonly rotate: (
    authorizationId: string,
    credential: Connection.StoredCredential,
  ) => Effect.Effect<Aggregate, Error>;
}

export class Service extends Context.Service<Service, Interface>()(
  "@domainkit/ManagedDnsConnections",
) {}
