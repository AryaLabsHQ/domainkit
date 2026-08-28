import { Effect, Schema as S } from "effect";

import * as ConnectionStore from "../stores/connection.ts";
import * as CredentialStore from "../stores/credential.ts";
import * as ProviderAuthorizationStore from "../stores/authorization.ts";
import type * as Storage from "../stores/error.ts";
import * as Connection from "./connection.ts";
import type * as ProviderAuthorization from "./authorization.ts";

export class Error extends S.TaggedError<Error>()("ConnectionLifecycleError", {
  message: S.String,
}) {}

export interface DetachResult {
  readonly connection: Connection.Connection;
  readonly remainingBindings: number;
  readonly revokedAuthorization: boolean;
}

/** Replace the grant on an owner binding after the host has obtained explicit consent. */
export const updateGrant = Effect.fn("ConnectionLifecycle.updateGrant")(function* (input: {
  readonly connection: Connection.Connection;
  readonly grant: Connection.Grant;
}) {
  const connectionStore = yield* ConnectionStore.Service;
  const connection = yield* Connection.validate({ ...input.connection, grant: input.grant });
  yield* connectionStore.put(connection);
  return connection;
});

/**
 * Detach one owner binding. The final binding invokes provider revocation before deleting local
 * credential and authorization state. The callback keeps provider-specific revocation outside the
 * portable authorization model.
 */
export function detach<E, R>(input: {
  readonly connectionId: string;
  readonly revokeAuthorization: (
    authorization: ProviderAuthorization.ProviderAuthorization,
  ) => Effect.Effect<void, E, R>;
}): Effect.Effect<DetachResult, Error | Storage.Error | E, R | Requirements> {
  return Effect.gen(function* () {
    const authorizationStore = yield* ProviderAuthorizationStore.Service;
    const connectionStore = yield* ConnectionStore.Service;
    const credentialStore = yield* CredentialStore.Service;
    const connection = yield* connectionStore.get(input.connectionId);
    if (connection === null) {
      return yield* new Error({ message: "Connection binding does not exist" });
    }
    const bindings = yield* connectionStore.listByAuthorizationId(connection.authorizationId);
    const remainingBindings = bindings.filter(({ id }) => id !== connection.id);
    if (remainingBindings.length > 0) {
      yield* connectionStore.delete(connection.id);
      return {
        connection,
        remainingBindings: remainingBindings.length,
        revokedAuthorization: false,
      };
    }

    const authorization = yield* authorizationStore.get(connection.authorizationId);
    if (authorization === null) {
      // A prior attempt may have revoked and removed the authorization before its final binding
      // delete failed. Both local deletes are idempotent, so finish that interrupted cleanup.
      yield* credentialStore.delete(connection.authorizationId);
      yield* connectionStore.delete(connection.id);
      return { connection, remainingBindings: 0, revokedAuthorization: true };
    }
    yield* input.revokeAuthorization(authorization);
    yield* credentialStore.delete(authorization.id);
    yield* authorizationStore.delete(authorization.id);
    yield* connectionStore.delete(connection.id);
    return { connection, remainingBindings: 0, revokedAuthorization: true };
  });
}

export type Requirements =
  | ConnectionStore.Service
  | CredentialStore.Service
  | ProviderAuthorizationStore.Service;
