import { Context, Effect, Layer } from "effect";

import type { StoredCredential } from "../auth/connection.ts";
import { type Error, fromCause } from "./error.ts";

export interface Interface {
  readonly delete: (connectionId: string) => Effect.Effect<void, Error>;
  readonly get: (connectionId: string) => Effect.Effect<StoredCredential | null, Error>;
  readonly put: (connectionId: string, credential: StoredCredential) => Effect.Effect<void, Error>;
}

export class Service extends Context.Service<Service, Interface>()("@domainkit/CredentialStore") {}

export interface AsyncInterface {
  readonly delete: (connectionId: string) => Promise<void>;
  readonly get: (connectionId: string) => Promise<StoredCredential | null>;
  readonly put: (connectionId: string, credential: StoredCredential) => Promise<void>;
}

export const toAsync = (store: Interface): AsyncInterface => ({
  delete: (connectionId) => Effect.runPromise(store.delete(connectionId)),
  get: (connectionId) => Effect.runPromise(store.get(connectionId)),
  put: (connectionId, credential) => Effect.runPromise(store.put(connectionId, credential)),
});

export const layerFromAsync = (store: AsyncInterface): Layer.Layer<Service> =>
  Layer.succeed(Service, {
    delete: Effect.fn("CredentialStore.delete")((connectionId) =>
      Effect.tryPromise({
        try: () => store.delete(connectionId),
        catch: (cause) => fromCause("credential.delete", cause),
      }),
    ),
    get: Effect.fn("CredentialStore.get")((connectionId) =>
      Effect.tryPromise({
        try: () => store.get(connectionId),
        catch: (cause) => fromCause("credential.get", cause),
      }),
    ),
    put: Effect.fn("CredentialStore.put")((connectionId, credential) =>
      Effect.tryPromise({
        try: () => store.put(connectionId, credential),
        catch: (cause) => fromCause("credential.put", cause),
      }),
    ),
  });
