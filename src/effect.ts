import packageJson from "../package.json" with { type: "json" };

/** The current package version from the package manifest. */
export const VERSION = packageJson.version;

export { assertConnectionGrant } from "./auth/grants.ts";
export { beginOAuth, completeOAuth, refreshOAuth, revokeOAuth } from "./auth/oauth.ts";
export type { BeginOAuthInput, Fetch, OAuthError, OAuthSubjectResolver } from "./auth/oauth.ts";
export { Secret } from "./auth/secret.ts";
export { connectToken } from "./auth/token.ts";
export type { ConnectTokenInput } from "./auth/token.ts";
export {
  Connection,
  ConnectionCapability,
  ConnectionGrant,
  ProviderAuthManifest,
} from "./auth/types.ts";
export type {
  ConnectionCapability as ConnectionCapabilityValue,
  OAuthClientConfiguration,
  OAuthContinuation,
  OAuthMethod,
  StoredCredential,
  TokenValidation,
} from "./auth/types.ts";
export { DomainName, parseDomainName } from "./domain/domain-name.ts";
export {
  AaaaRecord,
  ARecord,
  CaaRecord,
  CnameRecord,
  DnsRecord,
  DnsRecordType,
  MxRecord,
  NsRecord,
  parseDnsRecord,
  RequirementMetadata,
  SrvRecord,
  TxtRecord,
} from "./domain/dns-record.ts";
export type {
  DnsRecordInput,
  DnsRecordType as DnsRecordTypeValue,
  RequirementMetadata as RequirementMetadataValue,
} from "./domain/dns-record.ts";
export {
  AuthorizationError,
  CryptoError,
  InvalidInputError,
  PartialApplyError,
  PlanConflictError,
  ProviderError,
  ResolverError,
  StorageError,
  StalePlanError,
} from "./errors.ts";
export type { DomainKitError } from "./errors.ts";
export { selectProvider } from "./discovery/selection.ts";
export type {
  ConnectedZone,
  ProviderCandidateEvidence,
  ProviderSelection,
} from "./discovery/selection.ts";
export { deriveZoneCandidates } from "./discovery/zones.ts";
export { authorizePlanForConnection } from "./plan/connection-authorization.ts";
export { webCryptoLayer } from "./plan/canonical-json.ts";
export { applyPlan, authorizePlan, createPlan, renderManualInstructions } from "./plan/plan.ts";
export type {
  ApplyPlanError,
  AuthorizationPlanError,
  CreatePlanInput,
  PlanError,
} from "./plan/plan.ts";
export {
  ApplyReceipt,
  decodeApplyReceipt,
  decodeDnsPlan,
  DnsPlan,
  encodeApplyReceipt,
  encodeDnsPlan,
  PlanAuthorization,
  PlanOperation,
} from "./plan/types.ts";
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
export {
  CloudflareDnsResolver,
  makeCloudflareDnsResolver,
  normalizeDnsData,
} from "./verification/cloudflare-doh.ts";
export type { CloudflareDnsResolverOptions } from "./verification/cloudflare-doh.ts";
export {
  DnsResolver,
  layerDnsResolverFromPromise,
  toPromiseDnsResolver,
} from "./verification/resolver.ts";
export type {
  DnsAnswer,
  DnsQuery,
  DnsResolution,
  DnsResolverService,
  PromiseDnsResolution,
  PromiseDnsResolver,
} from "./verification/resolver.ts";
export { verifyRecord } from "./verification/verify.ts";
export type {
  ProviderObservation,
  PublicDnsObservation,
  RecordVerification,
} from "./verification/verify.ts";
