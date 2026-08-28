import { Context, Effect, Layer } from "effect";

import type { ProviderAuthorization } from "../auth/authorization.ts";
import { type Error, fromCause } from "./error.ts";

export interface Interface {
  readonly delete: (authorizationId: string) => Effect.Effect<void, Error>;
  readonly findByProviderAccount: (
    providerId: string,
    accountId: string,
  ) => Effect.Effect<ProviderAuthorization | null, Error>;
  readonly get: (authorizationId: string) => Effect.Effect<ProviderAuthorization | null, Error>;
  readonly put: (authorization: ProviderAuthorization) => Effect.Effect<void, Error>;
}

export class Service extends Context.Service<Service, Interface>()(
  "@domainkit/ProviderAuthorizationStore",
) {}

export interface AsyncInterface {
  readonly delete: (authorizationId: string) => Promise<void>;
  readonly findByProviderAccount: (
    providerId: string,
    accountId: string,
  ) => Promise<ProviderAuthorization | null>;
  readonly get: (authorizationId: string) => Promise<ProviderAuthorization | null>;
  readonly put: (authorization: ProviderAuthorization) => Promise<void>;
}

export const toAsync = (store: Interface): AsyncInterface => ({
  delete: (authorizationId) => Effect.runPromise(store.delete(authorizationId)),
  findByProviderAccount: (providerId, accountId) =>
    Effect.runPromise(store.findByProviderAccount(providerId, accountId)),
  get: (authorizationId) => Effect.runPromise(store.get(authorizationId)),
  put: (authorization) => Effect.runPromise(store.put(authorization)),
});

export const layerFromAsync = (store: AsyncInterface): Layer.Layer<Service> =>
  Layer.succeed(Service, {
    delete: Effect.fn("ProviderAuthorizationStore.delete")((authorizationId) =>
      Effect.tryPromise({
        try: () => store.delete(authorizationId),
        catch: (cause) => fromCause("providerAuthorization.delete", cause),
      }),
    ),
    findByProviderAccount: Effect.fn("ProviderAuthorizationStore.findByProviderAccount")(
      (providerId, accountId) =>
        Effect.tryPromise({
          try: () => store.findByProviderAccount(providerId, accountId),
          catch: (cause) => fromCause("providerAuthorization.findByProviderAccount", cause),
        }),
    ),
    get: Effect.fn("ProviderAuthorizationStore.get")((authorizationId) =>
      Effect.tryPromise({
        try: () => store.get(authorizationId),
        catch: (cause) => fromCause("providerAuthorization.get", cause),
      }),
    ),
    put: Effect.fn("ProviderAuthorizationStore.put")((authorization) =>
      Effect.tryPromise({
        try: () => store.put(authorization),
        catch: (cause) => fromCause("providerAuthorization.put", cause),
      }),
    ),
  });
