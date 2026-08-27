import packageJson from "../package.json" with { type: "json" };

/** The current package version from the package manifest. */
export const VERSION = packageJson.version;

export * as Connection from "./auth/connection.ts";
export * as OAuth from "./auth/oauth.ts";
export * as ProviderAuth from "./auth/manifest.ts";
export * as Secret from "./auth/secret.ts";
export * as TokenConnection from "./auth/token.ts";
export * as ProviderDiscovery from "./discovery/selection.ts";
export * as Zones from "./discovery/zones.ts";
export * as DnsRecord from "./domain/dns-record.ts";
export * as DomainName from "./domain/domain-name.ts";
export * as InvalidInput from "./invalid-input.ts";
export * as ConnectionAuthorization from "./plan/connection-authorization.ts";
export * as Digest from "./plan/canonical-json.ts";
export * as Provisioning from "./plan/plan.ts";
export * as DnsPlan from "./plan/types.ts";
export * as DnsProvider from "./provider/provider.ts";
export * as ConnectionStore from "./stores/connection.ts";
export * as CredentialStore from "./stores/credential.ts";
export * as OAuthStateStore from "./stores/oauth-state.ts";
export * as ReceiptStore from "./stores/receipt.ts";
export * as Storage from "./stores/error.ts";
export * as CloudflareDnsOverHttps from "./verification/cloudflare-doh.ts";
export * as DnsData from "./verification/dns-data.ts";
export * as DnsOverHttps from "./verification/doh.ts";
export * as DnsResolver from "./verification/resolver.ts";
export * as Verification from "./verification/verify.ts";
