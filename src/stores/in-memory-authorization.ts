import { Effect, Layer } from "effect";

import type * as ProviderAuthorization from "../auth/authorization.ts";
import * as ProviderAuthorizationStore from "./authorization.ts";

const accountKey = (providerId: string, accountId: string): string => `${providerId}\0${accountId}`;

export function make(): ProviderAuthorizationStore.Interface {
  const authorizations = new Map<string, ProviderAuthorization.ProviderAuthorization>();
  const accounts = new Map<string, string>();
  return {
    delete: Effect.fn("InMemoryProviderAuthorizationStore.delete")((authorizationId) =>
      Effect.sync(() => {
        const authorization = authorizations.get(authorizationId);
        if (authorization !== undefined) {
          accounts.delete(accountKey(authorization.providerId, authorization.accountId));
          authorizations.delete(authorizationId);
        }
      }),
    ),
    findByProviderAccount: Effect.fn("InMemoryProviderAuthorizationStore.findByProviderAccount")(
      (providerId, accountId) =>
        Effect.sync(() => {
          const id = accounts.get(accountKey(providerId, accountId));
          return id === undefined ? null : (authorizations.get(id) ?? null);
        }),
    ),
    get: Effect.fn("InMemoryProviderAuthorizationStore.get")((authorizationId) =>
      Effect.sync(() => authorizations.get(authorizationId) ?? null),
    ),
    put: Effect.fn("InMemoryProviderAuthorizationStore.put")((authorization) =>
      Effect.sync(() => {
        authorizations.set(authorization.id, authorization);
        accounts.set(
          accountKey(authorization.providerId, authorization.accountId),
          authorization.id,
        );
      }),
    ),
  };
}

export const layer = (): Layer.Layer<ProviderAuthorizationStore.Service> =>
  Layer.succeed(ProviderAuthorizationStore.Service, make());

export const toAsync = (
  store: ProviderAuthorizationStore.Interface = make(),
): ProviderAuthorizationStore.AsyncInterface => ProviderAuthorizationStore.toAsync(store);
