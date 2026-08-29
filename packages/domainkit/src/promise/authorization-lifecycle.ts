import { Effect, Layer } from "effect";

import type * as ProviderAuthorization from "../auth/authorization.ts";
import type * as Connection from "../auth/connection.ts";
import * as Lifecycle from "../auth/lifecycle-repository.ts";

export interface Repository {
  readonly bind: (
    authorizationId: string,
    binding: Connection.Connection,
  ) => Promise<Lifecycle.Aggregate>;
  readonly connect: (aggregate: Lifecycle.Aggregate) => Promise<Lifecycle.Aggregate>;
  readonly detach: (input: {
    readonly connectionId: string;
    readonly revoke: (aggregate: Lifecycle.Aggregate) => Promise<void>;
  }) => Promise<Lifecycle.DetachResult>;
  readonly findByProviderAccount: (
    providerId: string,
    providerAccountId: string,
  ) => Promise<Lifecycle.Aggregate | null>;
  readonly get: (authorizationId: string) => Promise<Lifecycle.Aggregate | null>;
  readonly getByConnectionId: (connectionId: string) => Promise<Lifecycle.Aggregate | null>;
  readonly modifyBinding: <A>(
    connectionId: string,
    modify: (binding: Connection.Connection) => {
      readonly binding: Connection.Connection;
      readonly value: A;
    },
  ) => Promise<Lifecycle.BindingModification<A>>;
  readonly promoteEvidence: (
    authorizationId: string,
    evidence: ReadonlyArray<ProviderAuthorization.CapabilityEvidence>,
  ) => Promise<Lifecycle.Aggregate>;
  readonly recover: (input: {
    readonly authorizationId: string;
    readonly revoke: (aggregate: Lifecycle.Aggregate) => Promise<void>;
  }) => Promise<Lifecycle.DetachResult>;
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

export const layerFrom = (repository: Repository): Layer.Layer<Lifecycle.Service> =>
  Layer.succeed(Lifecycle.Service, {
    bind: Effect.fn("AuthorizationLifecycleRepository.bind")((authorizationId, binding) =>
      Effect.tryPromise({
        try: () => repository.bind(authorizationId, binding),
        catch: (cause) => failure("AuthorizationLifecycleRepository.bind", cause),
      }),
    ),
    connect: Effect.fn("AuthorizationLifecycleRepository.connect")((aggregate) =>
      Effect.tryPromise({
        try: () => repository.connect(aggregate),
        catch: (cause) => failure("AuthorizationLifecycleRepository.connect", cause),
      }),
    ),
    detach: ({ connectionId, revoke }) =>
      Effect.tryPromise({
        try: () =>
          repository.detach({
            connectionId,
            revoke: (aggregate) => Effect.runPromise(revoke(aggregate)),
          }),
        catch: (cause) => failure("AuthorizationLifecycleRepository.detach", cause),
      }),
    findByProviderAccount: Effect.fn("AuthorizationLifecycleRepository.findByProviderAccount")(
      (providerId, providerAccountId) =>
        Effect.tryPromise({
          try: () => repository.findByProviderAccount(providerId, providerAccountId),
          catch: (cause) =>
            failure("AuthorizationLifecycleRepository.findByProviderAccount", cause),
        }),
    ),
    get: Effect.fn("AuthorizationLifecycleRepository.get")((authorizationId) =>
      Effect.tryPromise({
        try: () => repository.get(authorizationId),
        catch: (cause) => failure("AuthorizationLifecycleRepository.get", cause),
      }),
    ),
    getByConnectionId: Effect.fn("AuthorizationLifecycleRepository.getByConnectionId")(
      (connectionId) =>
        Effect.tryPromise({
          try: () => repository.getByConnectionId(connectionId),
          catch: (cause) => failure("AuthorizationLifecycleRepository.getByConnectionId", cause),
        }),
    ),
    modifyBinding: (connectionId, modify) =>
      Effect.tryPromise({
        try: () => repository.modifyBinding(connectionId, modify),
        catch: (cause) => failure("AuthorizationLifecycleRepository.modifyBinding", cause),
      }),
    promoteEvidence: Effect.fn("AuthorizationLifecycleRepository.promoteEvidence")(
      (authorizationId, evidence) =>
        Effect.tryPromise({
          try: () => repository.promoteEvidence(authorizationId, evidence),
          catch: (cause) => failure("AuthorizationLifecycleRepository.promoteEvidence", cause),
        }),
    ),
    recover: ({ authorizationId, revoke }) =>
      Effect.tryPromise({
        try: () =>
          repository.recover({
            authorizationId,
            revoke: (aggregate) => Effect.runPromise(revoke(aggregate)),
          }),
        catch: (cause) => failure("AuthorizationLifecycleRepository.recover", cause),
      }),
    rotate: Effect.fn("AuthorizationLifecycleRepository.rotate")(
      (authorizationId, credential, expiresAt) =>
        Effect.tryPromise({
          try: () => repository.rotate(authorizationId, credential, expiresAt),
          catch: (cause) => failure("AuthorizationLifecycleRepository.rotate", cause),
        }),
    ),
  });

export const toAsync = (repository: Lifecycle.Interface): Repository => ({
  bind: (authorizationId, binding) => Effect.runPromise(repository.bind(authorizationId, binding)),
  connect: (aggregate) => Effect.runPromise(repository.connect(aggregate)),
  detach: ({ connectionId, revoke }) =>
    Effect.runPromise(
      repository.detach({
        connectionId,
        revoke: (aggregate) => Effect.tryPromise(() => revoke(aggregate)),
      }),
    ),
  findByProviderAccount: (providerId, providerAccountId) =>
    Effect.runPromise(repository.findByProviderAccount(providerId, providerAccountId)),
  get: (authorizationId) => Effect.runPromise(repository.get(authorizationId)),
  getByConnectionId: (connectionId) =>
    Effect.runPromise(repository.getByConnectionId(connectionId)),
  modifyBinding: (connectionId, modify) =>
    Effect.runPromise(repository.modifyBinding(connectionId, modify)),
  promoteEvidence: (authorizationId, evidence) =>
    Effect.runPromise(repository.promoteEvidence(authorizationId, evidence)),
  recover: ({ authorizationId, revoke }) =>
    Effect.runPromise(
      repository.recover({
        authorizationId,
        revoke: (aggregate) => Effect.tryPromise(() => revoke(aggregate)),
      }),
    ),
  rotate: (authorizationId, credential, expiresAt) =>
    Effect.runPromise(repository.rotate(authorizationId, credential, expiresAt)),
});

export const from = (repository: Repository): Repository => repository;

export { Error } from "../auth/lifecycle-repository.ts";
export type { Aggregate, BindingModification, DetachResult } from "../auth/lifecycle-repository.ts";
