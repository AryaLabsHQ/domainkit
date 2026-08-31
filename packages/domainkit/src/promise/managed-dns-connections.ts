import { Effect, Layer } from "effect";

import type * as ProviderAuthorization from "../auth/authorization.ts";
import type * as Connection from "../auth/connection.ts";
import * as Lifecycle from "../auth/lifecycle-repository.ts";

export interface AsyncInterface {
  readonly attach: (input: {
    readonly attachment: Connection.DomainAttachment;
    readonly connectionId: string;
    readonly ownerId: string;
  }) => Promise<Lifecycle.AttachmentResult>;
  readonly connect: (input: Lifecycle.ConnectInput) => Promise<Lifecycle.Aggregate>;
  readonly detach: (input: {
    readonly attachmentId: string;
    readonly ownerId: string;
  }) => Promise<Lifecycle.DetachResult>;
  readonly disconnect: (input: {
    readonly connectionId: string;
    readonly ownerId: string;
    readonly revoke: (authorization: ProviderAuthorization.ProviderAuthorization) => Promise<void>;
  }) => Promise<Lifecycle.DisconnectResult>;
  readonly findConnection: (
    ownerId: string,
    authorizationId: string,
  ) => Promise<Connection.StoredConnection | null>;
  readonly get: (authorizationId: string) => Promise<Lifecycle.Aggregate | null>;
  readonly getAttachment: (attachmentId: string) => Promise<Connection.DomainAttachment | null>;
  readonly getByConnectionId: (connectionId: string) => Promise<Lifecycle.Aggregate | null>;
  readonly listAttachments: (
    connectionId: string,
    ownerId: string,
  ) => Promise<ReadonlyArray<Connection.DomainAttachment>>;
  readonly promoteEvidence: (
    authorizationId: string,
    evidence: ReadonlyArray<ProviderAuthorization.CapabilityEvidence>,
  ) => Promise<Lifecycle.Aggregate>;
  readonly recover: (input: {
    readonly authorizationId: string;
    readonly revoke: (authorization: ProviderAuthorization.ProviderAuthorization) => Promise<void>;
  }) => Promise<Lifecycle.DisconnectResult>;
  readonly rotate: (
    authorizationId: string,
    credential: Connection.StoredCredential,
    expiresAt: Date | null,
  ) => Promise<Lifecycle.Aggregate>;
}

const failure = (operation: string, cause: unknown): Lifecycle.Error =>
  cause instanceof Lifecycle.Error
    ? cause
    : new Lifecycle.Error({
        category: "storage",
        message: cause instanceof globalThis.Error ? cause.message : String(cause),
        operation,
        retry: "safe",
      });

export const layerFromAsync = (repository: AsyncInterface): Layer.Layer<Lifecycle.Service> =>
  Layer.succeed(Lifecycle.Service, {
    attach: (input) =>
      Effect.tryPromise({
        try: () => repository.attach(input),
        catch: (cause) => failure("ManagedDnsConnections.attach", cause),
      }),
    connect: (input) =>
      Effect.tryPromise({
        try: () => repository.connect(input),
        catch: (cause) => failure("ManagedDnsConnections.connect", cause),
      }),
    detach: (input) =>
      Effect.tryPromise({
        try: () => repository.detach(input),
        catch: (cause) => failure("ManagedDnsConnections.detach", cause),
      }),
    disconnect: ({ connectionId, ownerId, revoke }) =>
      Effect.tryPromise({
        try: () =>
          repository.disconnect({
            connectionId,
            ownerId,
            revoke: (authorization) => Effect.runPromise(revoke(authorization)),
          }),
        catch: (cause) => failure("ManagedDnsConnections.disconnect", cause),
      }),
    findConnection: (ownerId, authorizationId) =>
      Effect.tryPromise({
        try: () => repository.findConnection(ownerId, authorizationId),
        catch: (cause) => failure("ManagedDnsConnections.findConnection", cause),
      }),
    get: (authorizationId) =>
      Effect.tryPromise({
        try: () => repository.get(authorizationId),
        catch: (cause) => failure("ManagedDnsConnections.get", cause),
      }),
    getAttachment: (attachmentId) =>
      Effect.tryPromise({
        try: () => repository.getAttachment(attachmentId),
        catch: (cause) => failure("ManagedDnsConnections.getAttachment", cause),
      }),
    getByConnectionId: (connectionId) =>
      Effect.tryPromise({
        try: () => repository.getByConnectionId(connectionId),
        catch: (cause) => failure("ManagedDnsConnections.getByConnectionId", cause),
      }),
    listAttachments: (connectionId, ownerId) =>
      Effect.tryPromise({
        try: () => repository.listAttachments(connectionId, ownerId),
        catch: (cause) => failure("ManagedDnsConnections.listAttachments", cause),
      }),
    promoteEvidence: (authorizationId, evidence) =>
      Effect.tryPromise({
        try: () => repository.promoteEvidence(authorizationId, evidence),
        catch: (cause) => failure("ManagedDnsConnections.promoteEvidence", cause),
      }),
    recover: ({ authorizationId, revoke }) =>
      Effect.tryPromise({
        try: () =>
          repository.recover({
            authorizationId,
            revoke: (authorization) => Effect.runPromise(revoke(authorization)),
          }),
        catch: (cause) => failure("ManagedDnsConnections.recover", cause),
      }),
    rotate: (authorizationId, credential, expiresAt) =>
      Effect.tryPromise({
        try: () => repository.rotate(authorizationId, credential, expiresAt),
        catch: (cause) => failure("ManagedDnsConnections.rotate", cause),
      }),
  });

export const toAsync = (service: Lifecycle.Interface): AsyncInterface => ({
  attach: (input) => Effect.runPromise(service.attach(input)),
  connect: (input) => Effect.runPromise(service.connect(input)),
  detach: (input) => Effect.runPromise(service.detach(input)),
  disconnect: ({ connectionId, ownerId, revoke }) =>
    Effect.runPromise(
      service.disconnect({
        connectionId,
        ownerId,
        revoke: (authorization) => Effect.promise(() => revoke(authorization)),
      }),
    ),
  findConnection: (ownerId, authorizationId) =>
    Effect.runPromise(service.findConnection(ownerId, authorizationId)),
  get: (authorizationId) => Effect.runPromise(service.get(authorizationId)),
  getAttachment: (attachmentId) => Effect.runPromise(service.getAttachment(attachmentId)),
  getByConnectionId: (connectionId) => Effect.runPromise(service.getByConnectionId(connectionId)),
  listAttachments: (connectionId, ownerId) =>
    Effect.runPromise(service.listAttachments(connectionId, ownerId)),
  promoteEvidence: (authorizationId, evidence) =>
    Effect.runPromise(service.promoteEvidence(authorizationId, evidence)),
  recover: ({ authorizationId, revoke }) =>
    Effect.runPromise(
      service.recover({
        authorizationId,
        revoke: (authorization) => Effect.promise(() => revoke(authorization)),
      }),
    ),
  rotate: (authorizationId, credential, expiresAt) =>
    Effect.runPromise(service.rotate(authorizationId, credential, expiresAt)),
});

export const from = (repository: AsyncInterface): AsyncInterface => repository;

export { Error } from "../auth/lifecycle-repository.ts";
export type {
  AttachmentResult,
  DetachResult,
  DisconnectResult,
} from "../auth/lifecycle-repository.ts";
