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
  readonly operationIds?: ReadonlyArray<string>;
  readonly plan: DnsPlan.DnsPlan;
}) {
  yield* Effect.try({
    try: () =>
      Connection.assertGrant(input.connection, input.authorization, {
        capability: "dns:write",
        domain: input.plan.zone,
        providerId: input.plan.providerId,
      }),
    catch: (cause) =>
      cause instanceof Connection.AuthorizationError || cause instanceof InvalidInputError
        ? cause
        : new Connection.AuthorizationError({ message: "Connection grant is invalid" }),
  });
  return yield* Provisioning.authorize(
    input.plan,
    input.operationIds,
    input.allowPartial === undefined ? {} : { allowPartial: input.allowPartial },
  );
});

export type Error = Connection.AuthorizationError | InvalidInputError | CryptoError;
export type Requirements = Crypto.Crypto;
