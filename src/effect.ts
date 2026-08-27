import { Effect } from "effect";

import { verifyRecord as verifyRecordPromise } from "./verification/verify.ts";

export * from "./index.ts";

export { beginOAuth, completeOAuth, refreshOAuth, revokeOAuth } from "./auth/oauth.ts";
export type { BeginOAuthInput, Fetch, OAuthError, OAuthSubjectResolver } from "./auth/oauth.ts";
export { connectToken } from "./auth/token.ts";
export type { ConnectTokenInput } from "./auth/token.ts";
export { authorizePlanForConnection } from "./plan/connection-authorization.ts";
export { webCryptoLayer } from "./plan/canonical-json.ts";
export { applyPlan, authorizePlan, createPlan } from "./plan/plan.ts";
export type {
  ApplyPlanError,
  AuthorizationPlanError,
  CreatePlanInput,
  PlanError,
} from "./plan/plan.ts";
export {
  DnsProvider,
  layerDnsProviderFromPromise,
  toPromiseDnsProvider,
} from "./provider/provider.ts";
export type {
  DnsProviderService,
  PromiseDnsProvider,
  ProviderCreateResult,
} from "./provider/provider.ts";
export {
  ConnectionStore,
  connectionLayerFromPromise,
  CredentialStore,
  credentialLayerFromPromise,
  OAuthStateStore,
  oauthStateLayerFromPromise,
  ReceiptStore,
  storeLayersFromPromise,
} from "./stores/contracts.ts";
export type {
  ConnectionStoreService,
  CredentialStoreService,
  OAuthStateStoreService,
  PromiseConnectionStore,
  PromiseCredentialStore,
  PromiseOAuthStateStore,
  PromiseReceiptStore,
  ReceiptStoreService,
} from "./stores/contracts.ts";

export function verifyRecord(
  input: Parameters<typeof verifyRecordPromise>[0],
): Effect.Effect<Awaited<ReturnType<typeof verifyRecordPromise>>> {
  return Effect.promise(() => verifyRecordPromise(input));
}
