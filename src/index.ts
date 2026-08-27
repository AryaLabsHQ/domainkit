import packageJson from "../package.json" with { type: "json" };

/** The current package version from the package manifest. */
export const VERSION = packageJson.version;

export { assertConnectionGrant } from "./auth/grants.ts";
export { beginOAuth, completeOAuth, refreshOAuth, revokeOAuth } from "./auth/oauth.ts";
export type { BeginOAuthInput, Fetch } from "./auth/oauth.ts";
export { Secret } from "./auth/secret.ts";
export { connectToken } from "./auth/token.ts";
export { Connection, ConnectionGrant, ProviderAuthManifest } from "./auth/types.ts";
export type {
  OAuthClientConfiguration,
  OAuthContinuation,
  OAuthMethod,
  OAuthSubjectResolver,
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
  InvalidInputError,
  PlanConflictError,
  ProviderError,
} from "./errors.ts";
export type { DomainKitError } from "./errors.ts";
export type { DnsProvider, ProviderCreateResult } from "./provider/provider.ts";
export { authorizePlanForConnection } from "./plan/connection-authorization.ts";
export { applyPlan, authorizePlan, createPlan, renderManualInstructions } from "./plan/plan.ts";
export type { CreatePlanInput } from "./plan/plan.ts";
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
export type {
  ConnectionStore,
  CredentialStore,
  OAuthStateStore,
  ReceiptStore,
} from "./stores/contracts.ts";
