import { Effect, Layer } from "effect";

import type * as Connection from "../auth/connection.ts";
import * as CredentialStore from "./credential.ts";

export function make(): CredentialStore.Interface {
  const credentials = new Map<string, Connection.StoredCredential>();
  return {
    delete: Effect.fn("InMemoryCredentialStore.delete")((connectionId) =>
      Effect.sync(() => void credentials.delete(connectionId)),
    ),
    get: Effect.fn("InMemoryCredentialStore.get")((connectionId) =>
      Effect.sync(() => credentials.get(connectionId) ?? null),
    ),
    put: Effect.fn("InMemoryCredentialStore.put")((connectionId, credential) =>
      Effect.sync(() => void credentials.set(connectionId, credential)),
    ),
  };
}

export const layer = (): Layer.Layer<CredentialStore.Service> =>
  Layer.succeed(CredentialStore.Service, make());

export const toAsync = (
  store: CredentialStore.Interface = make(),
): CredentialStore.AsyncInterface => CredentialStore.toAsync(store);
