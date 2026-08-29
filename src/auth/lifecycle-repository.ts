import { Context, Effect, Schema } from "effect";

import type * as ProviderAuthorization from "./authorization.ts";
import type * as Connection from "./connection.ts";

export interface Aggregate {
  readonly authorization: ProviderAuthorization.ProviderAuthorization;
  readonly bindings: ReadonlyArray<Connection.Connection>;
  readonly credential: Connection.StoredCredential;
}

export interface DetachResult {
  readonly authorizationId: string;
  readonly remainingBindings: number;
  readonly revokedAuthorization: boolean;
}

export class Error extends Schema.TaggedError<Error>()("LifecycleRepositoryError", {
  category: Schema.Literal("storage"),
  message: Schema.String,
  operation: Schema.String,
  retry: Schema.Literals(["never", "after-user-action", "safe", "unknown"]),
}) {}

export interface Interface {
  readonly bind: (
    authorizationId: string,
    binding: Connection.Connection,
  ) => Effect.Effect<Aggregate, Error>;
  readonly connect: (aggregate: Aggregate) => Effect.Effect<Aggregate, Error>;
  readonly detach: <E>(input: {
    readonly connectionId: string;
    readonly revoke: (aggregate: Aggregate) => Effect.Effect<void, E>;
  }) => Effect.Effect<DetachResult, Error | E>;
  readonly findByProviderAccount: (
    providerId: string,
    providerAccountId: string,
  ) => Effect.Effect<Aggregate | null, Error>;
  readonly get: (authorizationId: string) => Effect.Effect<Aggregate | null, Error>;
  readonly getByConnectionId: (connectionId: string) => Effect.Effect<Aggregate | null, Error>;
  readonly promoteEvidence: (
    authorizationId: string,
    evidence: ReadonlyArray<ProviderAuthorization.CapabilityEvidence>,
  ) => Effect.Effect<Aggregate, Error>;
  readonly recover: <E>(input: {
    readonly authorizationId: string;
    readonly revoke: (aggregate: Aggregate) => Effect.Effect<void, E>;
  }) => Effect.Effect<DetachResult, Error | E>;
  readonly rotate: (
    authorizationId: string,
    credential: Connection.StoredCredential,
    expiresAt: Date | null,
  ) => Effect.Effect<Aggregate, Error>;
}

export class Service extends Context.Service<Service, Interface>()(
  "@domainkit/AuthorizationLifecycleRepository",
) {}
