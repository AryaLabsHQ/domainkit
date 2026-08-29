import { Crypto, Effect } from "effect";

import * as Connection from "../auth/connection.ts";
import * as ProviderAuthorization from "../auth/authorization.ts";
import { Error as InvalidInputError } from "../invalid-input.ts";
import { CryptoError } from "./canonical-json.ts";
import * as Provisioning from "./plan.ts";
import type * as DnsPlan from "./types.ts";

export const authorize = Effect.fn("ConnectionAuthorization.authorize")(function* (input: {
  readonly allowPartial?: boolean;
  readonly authorization: ProviderAuthorization.ProviderAuthorization;
  readonly connection: Connection.Connection;
  readonly domain: string;
  readonly operationIds?: ReadonlyArray<string>;
  readonly plan: DnsPlan.DnsPlan;
}) {
  const domain = yield* Effect.try({
    try: () =>
      Connection.assertGrant(input.connection, input.authorization, {
        capability: "dns:write",
        domain: input.domain,
        providerId: input.plan.providerId,
      }),
    catch: (cause) =>
      cause instanceof Connection.AuthorizationError || cause instanceof InvalidInputError
        ? cause
        : Connection.authorizationError(
            "Connection grant is invalid",
            "ConnectionAuthorization.authorize",
          ),
  });
  const authorization = yield* Provisioning.authorize(
    input.plan,
    input.operationIds,
    input.allowPartial === undefined ? {} : { allowPartial: input.allowPartial },
  );
  const selected = new Set(authorization.operationIds);
  const outsideGrant = input.plan.operations.filter(
    (operation) =>
      operation._tag === "create" &&
      selected.has(operation.id) &&
      operation.requirement.name !== domain &&
      !operation.requirement.name.endsWith(`.${domain}`),
  );
  if (outsideGrant.length > 0) {
    return yield* Connection.authorizationError(
      `Plan operations are outside the granted domain ${domain}`,
      "ConnectionAuthorization.authorize",
    );
  }
  return authorization;
});

export type Error = Connection.AuthorizationError | InvalidInputError | CryptoError;
export type Requirements = Crypto.Crypto;
