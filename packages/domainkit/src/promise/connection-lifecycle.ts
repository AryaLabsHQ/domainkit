import { Effect, Layer } from "effect";

import type * as Connection from "../auth/connection.ts";
import type * as ProviderAuthorization from "../auth/authorization.ts";
import * as Lifecycle from "../auth/connection-lifecycle.ts";
import * as ConnectionStore from "../stores/connection.ts";
import * as CredentialStore from "../stores/credential.ts";
import * as ProviderAuthorizationStore from "../stores/authorization.ts";

export function updateGrant(input: {
  readonly connection: Parameters<typeof Lifecycle.updateGrant>[0]["connection"];
  readonly connectionStore: ConnectionStore.AsyncInterface;
  readonly grant: Parameters<typeof Lifecycle.updateGrant>[0]["grant"];
}): Promise<Connection.Connection> {
  return Effect.runPromise(
    Lifecycle.updateGrant({ connection: input.connection, grant: input.grant }).pipe(
      Effect.provide(ConnectionStore.layerFromAsync(input.connectionStore)),
    ),
  );
}

export function detach(input: {
  readonly authorizationStore: ProviderAuthorizationStore.AsyncInterface;
  readonly connectionId: string;
  readonly connectionStore: ConnectionStore.AsyncInterface;
  readonly credentialStore: CredentialStore.AsyncInterface;
  readonly revokeAuthorization: (
    authorization: ProviderAuthorization.ProviderAuthorization,
  ) => Promise<void>;
}): Promise<Lifecycle.DetachResult> {
  return Effect.runPromise(
    Lifecycle.detach({
      connectionId: input.connectionId,
      revokeAuthorization: (authorization) =>
        Effect.tryPromise({
          try: () => input.revokeAuthorization(authorization),
          catch: (cause) =>
            new Lifecycle.Error({
              message: cause instanceof globalThis.Error ? cause.message : String(cause),
            }),
        }),
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          ProviderAuthorizationStore.layerFromAsync(input.authorizationStore),
          ConnectionStore.layerFromAsync(input.connectionStore),
          CredentialStore.layerFromAsync(input.credentialStore),
        ),
      ),
    ),
  );
}

export { Error } from "../auth/connection-lifecycle.ts";
export type { DetachResult } from "../auth/connection-lifecycle.ts";
