import { Context, Effect, Layer } from "effect";

import type { Connection } from "../auth/connection.ts";
import { type Error, fromCause } from "./error.ts";

export interface Interface {
  readonly delete: (connectionId: string) => Effect.Effect<void, Error>;
  readonly find: (
    ownerId: string,
    authorizationId: string,
  ) => Effect.Effect<Connection | null, Error>;
  readonly get: (connectionId: string) => Effect.Effect<Connection | null, Error>;
  readonly listByAuthorizationId: (
    authorizationId: string,
  ) => Effect.Effect<ReadonlyArray<Connection>, Error>;
  readonly put: (connection: Connection) => Effect.Effect<void, Error>;
}

export class Service extends Context.Service<Service, Interface>()("@domainkit/ConnectionStore") {}

export interface AsyncInterface {
  readonly delete: (connectionId: string) => Promise<void>;
  readonly find: (ownerId: string, authorizationId: string) => Promise<Connection | null>;
  readonly get: (connectionId: string) => Promise<Connection | null>;
  readonly listByAuthorizationId: (authorizationId: string) => Promise<ReadonlyArray<Connection>>;
  readonly put: (connection: Connection) => Promise<void>;
}

export const toAsync = (store: Interface): AsyncInterface => ({
  delete: (connectionId) => Effect.runPromise(store.delete(connectionId)),
  find: (ownerId, authorizationId) => Effect.runPromise(store.find(ownerId, authorizationId)),
  get: (connectionId) => Effect.runPromise(store.get(connectionId)),
  listByAuthorizationId: (authorizationId) =>
    Effect.runPromise(store.listByAuthorizationId(authorizationId)),
  put: (connection) => Effect.runPromise(store.put(connection)),
});

export const layerFromAsync = (store: AsyncInterface): Layer.Layer<Service> =>
  Layer.succeed(Service, {
    delete: Effect.fn("ConnectionStore.delete")((connectionId) =>
      Effect.tryPromise({
        try: () => store.delete(connectionId),
        catch: (cause) => fromCause("connection.delete", cause),
      }),
    ),
    find: Effect.fn("ConnectionStore.find")((ownerId, authorizationId) =>
      Effect.tryPromise({
        try: () => store.find(ownerId, authorizationId),
        catch: (cause) => fromCause("connection.find", cause),
      }),
    ),
    get: Effect.fn("ConnectionStore.get")((connectionId) =>
      Effect.tryPromise({
        try: () => store.get(connectionId),
        catch: (cause) => fromCause("connection.get", cause),
      }),
    ),
    listByAuthorizationId: Effect.fn("ConnectionStore.listByAuthorizationId")((authorizationId) =>
      Effect.tryPromise({
        try: () => store.listByAuthorizationId(authorizationId),
        catch: (cause) => fromCause("connection.listByAuthorizationId", cause),
      }),
    ),
    put: Effect.fn("ConnectionStore.put")((connection) =>
      Effect.tryPromise({
        try: () => store.put(connection),
        catch: (cause) => fromCause("connection.put", cause),
      }),
    ),
  });
