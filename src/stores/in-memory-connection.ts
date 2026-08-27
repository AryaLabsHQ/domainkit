import { Effect, Layer } from "effect";

import type * as Connection from "../auth/connection.ts";
import * as ConnectionStore from "./connection.ts";

export function make(): ConnectionStore.Interface {
  const connections = new Map<string, Connection.Connection>();
  return {
    get: Effect.fn("InMemoryConnectionStore.get")((connectionId) =>
      Effect.sync(() => connections.get(connectionId) ?? null),
    ),
    put: Effect.fn("InMemoryConnectionStore.put")((connection) =>
      Effect.sync(() => void connections.set(connection.id, connection)),
    ),
  };
}

export const layer = (): Layer.Layer<ConnectionStore.Service> =>
  Layer.succeed(ConnectionStore.Service, make());

export const toAsync = (
  store: ConnectionStore.Interface = make(),
): ConnectionStore.AsyncInterface => ConnectionStore.toAsync(store);
