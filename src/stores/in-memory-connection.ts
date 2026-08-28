import { Effect, Layer } from "effect";

import type * as Connection from "../auth/connection.ts";
import * as ConnectionStore from "./connection.ts";

export function make(): ConnectionStore.Interface {
  const connections = new Map<string, Connection.Connection>();
  return {
    delete: Effect.fn("InMemoryConnectionStore.delete")((connectionId) =>
      Effect.sync(() => void connections.delete(connectionId)),
    ),
    find: Effect.fn("InMemoryConnectionStore.find")((ownerId, authorizationId) =>
      Effect.sync(
        () =>
          [...connections.values()].find(
            (connection) =>
              connection.ownerId === ownerId && connection.authorizationId === authorizationId,
          ) ?? null,
      ),
    ),
    get: Effect.fn("InMemoryConnectionStore.get")((connectionId) =>
      Effect.sync(() => connections.get(connectionId) ?? null),
    ),
    listByAuthorizationId: Effect.fn("InMemoryConnectionStore.listByAuthorizationId")(
      (authorizationId) =>
        Effect.sync(() =>
          [...connections.values()].filter(
            (connection) => connection.authorizationId === authorizationId,
          ),
        ),
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
