import packageJson from "../package.json" with { type: "json" };

/** The current package version from the package manifest. */
export const VERSION = packageJson.version;

export * as Connection from "./auth/connection-api.ts";
export * as AuthorizationLifecycle from "./auth/lifecycle-repository.ts";
export * as ProviderContext from "./auth/provider-context.ts";
export * as Diagnostic from "./auth/diagnostic.ts";
export * as ProviderAuthorization from "./auth/authorization.ts";
export * as ProviderAuth from "./auth/manifest.ts";
export * as Secret from "./auth/secret.ts";
export * as ProviderDiscovery from "./discovery/selection.ts";
export * as ZoneDiscovery from "./discovery/zone-discovery.ts";
export * as Zones from "./discovery/zones.ts";
export * as DnsRecord from "./domain/dns-record.ts";
export * as DomainName from "./domain/domain-name.ts";
export * as InvalidInput from "./invalid-input.ts";
export * as ConnectionAuthorization from "./plan/connection-authorization.ts";
export * as Digest from "./plan/canonical-json.ts";
export * as Deletion from "./plan/deletion.ts";
export * as Provisioning from "./plan/plan.ts";
export * as DnsPlan from "./plan/types.ts";
export * as DnsProvider from "./provider/provider.ts";
export * as Cloudflare from "./providers/cloudflare/index.ts";
export * as Vercel from "./providers/vercel/index.ts";
export * as OAuthStateStore from "./stores/oauth-state.ts";
export * as ReceiptStore from "./stores/receipt.ts";
export * as Storage from "./stores/error.ts";
export * as CloudflareDnsOverHttps from "./verification/cloudflare-doh.ts";
export * as DnsData from "./verification/dns-data.ts";
export * as DnsOverHttps from "./verification/doh.ts";
export * as DnsResolver from "./verification/resolver.ts";
export * as Verification from "./verification/verify.ts";
