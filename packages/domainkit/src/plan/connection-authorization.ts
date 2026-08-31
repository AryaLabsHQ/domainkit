import { Crypto, Effect } from "effect";

import * as Connection from "../auth/connection.ts";
import * as ProviderAuthorization from "../auth/authorization.ts";
import * as Lifecycle from "../auth/lifecycle-repository.ts";
import { Error as InvalidInputError } from "../invalid-input.ts";
import { CryptoError } from "./canonical-json.ts";
import * as Provisioning from "./plan.ts";
import type * as DnsPlan from "./types.ts";

export const authorize = Effect.fn("ConnectionAuthorization.authorize")(function* (input: {
  readonly allowPartial?: boolean;
  readonly authorization: ProviderAuthorization.ProviderAuthorization;
  readonly connection: Connection.ProviderConnection | Connection.StoredConnection;
  readonly domain: string;
  readonly attachment: Connection.DomainAttachment;
  readonly operationIds?: ReadonlyArray<string>;
  readonly plan: DnsPlan.DnsPlan;
}) {
  const lifecycle = yield* Lifecycle.Service;
  const aggregate = yield* lifecycle.getByConnectionId(input.connection.id);
  const storedConnection = aggregate?.connections.find(({ id }) => id === input.connection.id);
  const storedAttachment = aggregate?.attachments.find(({ id }) => id === input.attachment.id);
  if (
    aggregate === null ||
    storedConnection === undefined ||
    storedAttachment === undefined ||
    storedConnection.ownerId !== input.connection.ownerId ||
    storedConnection.providerId !== input.connection.providerId ||
    storedConnection.method !== aggregate.authorization.method ||
    storedConnection.authorizationId !== input.authorization.id ||
    storedAttachment.connectionId !== storedConnection.id
  ) {
    return yield* Connection.authorizationError(
      "Domain attachment is not owned by the active provider connection",
      "ConnectionAuthorization.authorize",
    );
  }
  const domain = yield* Effect.try({
    try: () =>
      Connection.assertAttachment({
        attachment: storedAttachment,
        capability: "dns:write",
        authorization: aggregate.authorization,
        connection: storedConnection,
        credential: aggregate.credential,
        domain: input.domain,
        providerId: input.plan.providerId,
      }),
    catch: (cause) =>
      cause instanceof Connection.AuthorizationError || cause instanceof InvalidInputError
        ? cause
        : Connection.authorizationError(
            "Domain attachment is invalid",
            "ConnectionAuthorization.authorize",
          ),
  });
  const authorization = yield* Provisioning.authorize(
    input.plan,
    input.operationIds,
    input.allowPartial === undefined ? {} : { allowPartial: input.allowPartial },
  );
  const selected = new Set(authorization.operationIds);
  const outsideAttachment = input.plan.operations.filter(
    (operation) =>
      operation._tag === "create" &&
      selected.has(operation.id) &&
      operation.requirement.name !== domain &&
      !operation.requirement.name.endsWith(`.${domain}`),
  );
  if (outsideAttachment.length > 0) {
    return yield* Connection.authorizationError(
      `Plan operations are outside the attached domain ${domain}`,
      "ConnectionAuthorization.authorize",
    );
  }
  return authorization;
});

export type Error =
  | Connection.AuthorizationError
  | InvalidInputError
  | CryptoError
  | Lifecycle.Error;
export type Requirements = Crypto.Crypto | Lifecycle.Service;
