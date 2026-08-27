import { Context, Effect, Layer } from "effect";

import type { Connection } from "../auth/connection.ts";
import { type Error, fromCause } from "./error.ts";

export interface Interface {
  readonly get: (connectionId: string) => Effect.Effect<Connection | null, Error>;
  readonly put: (connection: Connection) => Effect.Effect<void, Error>;
}

export class Service extends Context.Service<Service, Interface>()("@domainkit/ConnectionStore") {}

export interface AsyncInterface {
  readonly get: (connectionId: string) => Promise<Connection | null>;
  readonly put: (connection: Connection) => Promise<void>;
}

export const toAsync = (store: Interface): AsyncInterface => ({
  get: (connectionId) => Effect.runPromise(store.get(connectionId)),
  put: (connection) => Effect.runPromise(store.put(connection)),
});

export const layerFromAsync = (store: AsyncInterface): Layer.Layer<Service> =>
  Layer.succeed(Service, {
    get: Effect.fn("ConnectionStore.get")((connectionId) =>
      Effect.tryPromise({
        try: () => store.get(connectionId),
        catch: (cause) => fromCause("connection.get", cause),
      }),
    ),
    put: Effect.fn("ConnectionStore.put")((connection) =>
      Effect.tryPromise({
        try: () => store.put(connection),
        catch: (cause) => fromCause("connection.put", cause),
      }),
    ),
  });
