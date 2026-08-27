import { Effect } from "effect";

import type { DomainKitError } from "./errors.ts";
import { InvalidInputError } from "./errors.ts";
import {
  applyPlan as applyPlanPromise,
  authorizePlan as authorizePlanPromise,
  createPlan as createPlanPromise,
} from "./plan/plan.ts";

export * from "./index.ts";

export function createPlan(
  input: Parameters<typeof createPlanPromise>[0],
): Effect.Effect<Awaited<ReturnType<typeof createPlanPromise>>, DomainKitError> {
  return Effect.tryPromise({ try: () => createPlanPromise(input), catch: toDomainKitError });
}

export function authorizePlan(
  ...input: Parameters<typeof authorizePlanPromise>
): Effect.Effect<Awaited<ReturnType<typeof authorizePlanPromise>>, DomainKitError> {
  return Effect.tryPromise({ try: () => authorizePlanPromise(...input), catch: toDomainKitError });
}

export function applyPlan(
  input: Parameters<typeof applyPlanPromise>[0],
): Effect.Effect<Awaited<ReturnType<typeof applyPlanPromise>>, DomainKitError> {
  return Effect.tryPromise({ try: () => applyPlanPromise(input), catch: toDomainKitError });
}

function toDomainKitError(cause: unknown): DomainKitError {
  if (
    cause !== null &&
    typeof cause === "object" &&
    "_tag" in cause &&
    ["InvalidInputError", "PlanConflictError", "AuthorizationError", "ProviderError"].includes(
      String(cause._tag),
    )
  ) {
    return cause as DomainKitError;
  }
  return new InvalidInputError({ message: cause instanceof Error ? cause.message : String(cause) });
}
