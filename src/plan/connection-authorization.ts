import { assertConnectionGrant } from "../auth/grants.ts";
import type { Connection } from "../auth/types.ts";
import { authorizePlan } from "../promise.ts";
import type { DnsPlan, PlanAuthorization } from "./types.ts";

export async function authorizePlanForConnection(input: {
  readonly accountId: string;
  readonly allowPartial?: boolean;
  readonly connection: Connection;
  readonly operationIds?: ReadonlyArray<string>;
  readonly plan: DnsPlan;
}): Promise<PlanAuthorization> {
  assertConnectionGrant(input.connection, {
    accountId: input.accountId,
    capability: "dns:write",
    domain: input.plan.zone,
    providerId: input.plan.providerId,
  });
  return authorizePlan(
    input.plan,
    input.operationIds,
    input.allowPartial === undefined ? {} : { allowPartial: input.allowPartial },
  );
}
