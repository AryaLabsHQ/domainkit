import { Effect } from "effect";

import * as Connection from "./connection.ts";
import * as Lifecycle from "./lifecycle-repository.ts";
import * as ProviderAuthorization from "./authorization.ts";

/** Attach one exact provider target to one organization domain. */
export const attach = Effect.fn("ManagedDnsConnections.attach")(function* (input: {
  readonly attachment: Connection.DomainAttachment;
  readonly connectionId: string;
  readonly ownerId: string;
}) {
  const service = yield* Lifecycle.Service;
  return yield* service.attach(input);
});

/** Remove one domain attachment while retaining the organization connection. */
export const detach = Effect.fn("ManagedDnsConnections.detach")(function* (input: {
  readonly attachmentId: string;
  readonly ownerId: string;
}) {
  const service = yield* Lifecycle.Service;
  return yield* service.detach(input);
});

/** Disconnect one organization connection, revoking the shared authorization only when final. */
export function disconnect<E>(input: {
  readonly connectionId: string;
  readonly ownerId: string;
  readonly revokeAuthorization: (
    authorization: ProviderAuthorization.ProviderAuthorization,
  ) => Effect.Effect<void, E>;
}): Effect.Effect<Lifecycle.DisconnectResult, Lifecycle.Error | E, Lifecycle.Service> {
  return Effect.gen(function* () {
    const service = yield* Lifecycle.Service;
    return yield* service.disconnect({
      connectionId: input.connectionId,
      ownerId: input.ownerId,
      revoke: input.revokeAuthorization,
    });
  });
}
