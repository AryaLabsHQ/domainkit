import { Context, Effect, Layer } from "effect";

import type { StoredCredential } from "../auth/connection.ts";
import { type Error, fromCause } from "./error.ts";

export interface Interface {
  readonly delete: (authorizationId: string) => Effect.Effect<void, Error>;
  readonly get: (authorizationId: string) => Effect.Effect<StoredCredential | null, Error>;
  readonly put: (
    authorizationId: string,
    credential: StoredCredential,
  ) => Effect.Effect<void, Error>;
}

export class Service extends Context.Service<Service, Interface>()("@domainkit/CredentialStore") {}

export interface AsyncInterface {
  readonly delete: (authorizationId: string) => Promise<void>;
  readonly get: (authorizationId: string) => Promise<StoredCredential | null>;
  readonly put: (authorizationId: string, credential: StoredCredential) => Promise<void>;
}

export const toAsync = (store: Interface): AsyncInterface => ({
  delete: (authorizationId) => Effect.runPromise(store.delete(authorizationId)),
  get: (authorizationId) => Effect.runPromise(store.get(authorizationId)),
  put: (authorizationId, credential) => Effect.runPromise(store.put(authorizationId, credential)),
});

export const layerFromAsync = (store: AsyncInterface): Layer.Layer<Service> =>
  Layer.succeed(Service, {
    delete: Effect.fn("CredentialStore.delete")((authorizationId) =>
      Effect.tryPromise({
        try: () => store.delete(authorizationId),
        catch: (cause) => fromCause("credential.delete", cause),
      }),
    ),
    get: Effect.fn("CredentialStore.get")((authorizationId) =>
      Effect.tryPromise({
        try: () => store.get(authorizationId),
        catch: (cause) => fromCause("credential.get", cause),
      }),
    ),
    put: Effect.fn("CredentialStore.put")((authorizationId, credential) =>
      Effect.tryPromise({
        try: () => store.put(authorizationId, credential),
        catch: (cause) => fromCause("credential.put", cause),
      }),
    ),
  });
