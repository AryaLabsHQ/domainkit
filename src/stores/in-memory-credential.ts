import { Effect, Layer } from "effect";

import type * as Connection from "../auth/connection.ts";
import * as CredentialStore from "./credential.ts";

export function make(): CredentialStore.Interface {
  const credentials = new Map<string, Connection.StoredCredential>();
  return {
    delete: Effect.fn("InMemoryCredentialStore.delete")((authorizationId) =>
      Effect.sync(() => void credentials.delete(authorizationId)),
    ),
    get: Effect.fn("InMemoryCredentialStore.get")((authorizationId) =>
      Effect.sync(() => credentials.get(authorizationId) ?? null),
    ),
    put: Effect.fn("InMemoryCredentialStore.put")((authorizationId, credential) =>
      Effect.sync(() => void credentials.set(authorizationId, credential)),
    ),
  };
}

export const layer = (): Layer.Layer<CredentialStore.Service> =>
  Layer.succeed(CredentialStore.Service, make());

export const toAsync = (
  store: CredentialStore.Interface = make(),
): CredentialStore.AsyncInterface => CredentialStore.toAsync(store);
