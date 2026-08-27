import { Crypto, Effect } from "effect";

import { assertConnectionGrant } from "../auth/grants.ts";
import type { Connection } from "../auth/types.ts";
import { AuthorizationError, type CryptoError, InvalidInputError } from "../errors.ts";
import { authorizePlan } from "./plan.ts";
import type { DnsPlan, PlanAuthorization } from "./types.ts";

export function authorizePlanForConnection(input: {
  readonly accountId: string;
  readonly allowPartial?: boolean;
  readonly connection: Connection;
  readonly operationIds?: ReadonlyArray<string>;
  readonly plan: DnsPlan;
}): Effect.Effect<
  PlanAuthorization,
  AuthorizationError | InvalidInputError | CryptoError,
  Crypto.Crypto
> {
  return Effect.gen(function* () {
    yield* Effect.try({
      try: () =>
        assertConnectionGrant(input.connection, {
          accountId: input.accountId,
          capability: "dns:write",
          domain: input.plan.zone,
          providerId: input.plan.providerId,
        }),
      catch: (cause) =>
        cause instanceof AuthorizationError || cause instanceof InvalidInputError
          ? cause
          : new AuthorizationError({ message: "Connection grant is invalid" }),
    });
    return yield* authorizePlan(
      input.plan,
      input.operationIds,
      input.allowPartial === undefined ? {} : { allowPartial: input.allowPartial },
    );
  });
}
