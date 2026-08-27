import { Context, Effect, Layer } from "effect";

import {
  beginOAuth as beginOAuthPromise,
  completeOAuth as completeOAuthPromise,
  refreshOAuth as refreshOAuthPromise,
  revokeOAuth as revokeOAuthPromise,
} from "./auth/oauth.ts";
import { connectToken as connectTokenPromise } from "./auth/token.ts";
import type { DomainKitError } from "./errors.ts";
import { InvalidInputError } from "./errors.ts";
import { authorizePlanForConnection as authorizePlanForConnectionPromise } from "./plan/connection-authorization.ts";
import {
  applyPlan as applyPlanPromise,
  authorizePlan as authorizePlanPromise,
  createPlan as createPlanPromise,
} from "./plan/plan.ts";
import type {
  ConnectionStore as ConnectionStoreContract,
  CredentialStore as CredentialStoreContract,
  OAuthStateStore as OAuthStateStoreContract,
  ReceiptStore as ReceiptStoreContract,
} from "./stores/contracts.ts";
import { verifyRecord as verifyRecordPromise } from "./verification/verify.ts";

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

export const OAuthStateStore = Context.Service<OAuthStateStoreContract>(
  "domainkit/OAuthStateStore",
);
export const ConnectionStore = Context.Service<ConnectionStoreContract>(
  "domainkit/ConnectionStore",
);
export const CredentialStore = Context.Service<CredentialStoreContract>(
  "domainkit/CredentialStore",
);
export const ReceiptStore = Context.Service<ReceiptStoreContract>("domainkit/ReceiptStore");

export function storeLayers(stores: {
  readonly connections: ConnectionStoreContract;
  readonly credentials: CredentialStoreContract;
  readonly oauthState: OAuthStateStoreContract;
  readonly receipts: ReceiptStoreContract;
}) {
  return Layer.mergeAll(
    Layer.succeed(OAuthStateStore)(stores.oauthState),
    Layer.succeed(ConnectionStore)(stores.connections),
    Layer.succeed(CredentialStore)(stores.credentials),
    Layer.succeed(ReceiptStore)(stores.receipts),
  );
}

export function beginOAuth(
  input: Parameters<typeof beginOAuthPromise>[0],
): Effect.Effect<Awaited<ReturnType<typeof beginOAuthPromise>>, DomainKitError> {
  return Effect.tryPromise({ try: () => beginOAuthPromise(input), catch: toDomainKitError });
}

export function completeOAuth(
  input: Parameters<typeof completeOAuthPromise>[0],
): Effect.Effect<Awaited<ReturnType<typeof completeOAuthPromise>>, DomainKitError> {
  return Effect.tryPromise({ try: () => completeOAuthPromise(input), catch: toDomainKitError });
}

export function refreshOAuth(
  input: Parameters<typeof refreshOAuthPromise>[0],
): Effect.Effect<void, DomainKitError> {
  return Effect.tryPromise({ try: () => refreshOAuthPromise(input), catch: toDomainKitError });
}

export function revokeOAuth(
  input: Parameters<typeof revokeOAuthPromise>[0],
): Effect.Effect<void, DomainKitError> {
  return Effect.tryPromise({ try: () => revokeOAuthPromise(input), catch: toDomainKitError });
}

export function connectToken(
  input: Parameters<typeof connectTokenPromise>[0],
): Effect.Effect<Awaited<ReturnType<typeof connectTokenPromise>>, DomainKitError> {
  return Effect.tryPromise({ try: () => connectTokenPromise(input), catch: toDomainKitError });
}

export function authorizePlanForConnection(
  input: Parameters<typeof authorizePlanForConnectionPromise>[0],
): Effect.Effect<Awaited<ReturnType<typeof authorizePlanForConnectionPromise>>, DomainKitError> {
  return Effect.tryPromise({
    try: () => authorizePlanForConnectionPromise(input),
    catch: toDomainKitError,
  });
}

export function verifyRecord(
  input: Parameters<typeof verifyRecordPromise>[0],
): Effect.Effect<Awaited<ReturnType<typeof verifyRecordPromise>>> {
  return Effect.promise(() => verifyRecordPromise(input));
}

function toDomainKitError(cause: unknown): DomainKitError {
  if (
    cause !== null &&
    typeof cause === "object" &&
    "_tag" in cause &&
    [
      "InvalidInputError",
      "PlanConflictError",
      "AuthorizationError",
      "PartialApplyError",
      "ProviderError",
      "StalePlanError",
    ].includes(String(cause._tag))
  ) {
    return cause as DomainKitError;
  }
  return new InvalidInputError({ message: cause instanceof Error ? cause.message : String(cause) });
}
