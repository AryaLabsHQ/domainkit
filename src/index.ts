import packageJson from "../package.json" with { type: "json" };

/** The current package version from the package manifest. */
export const VERSION = packageJson.version;

export * as Connection from "./promise/connection.ts";
export * as AuthorizationLifecycle from "./promise/authorization-lifecycle.ts";
export * as Diagnostic from "./auth/diagnostic.ts";
export * as ProviderContext from "./auth/provider-context.ts";
export * as Secret from "./auth/secret.ts";
export type * as DnsProvider from "./promise/dns-provider.ts";
export type * as DnsResolver from "./promise/dns-resolver.ts";
export * as ProviderAuth from "./promise/provider-auth.ts";
export * as ProviderAuthorization from "./promise/provider-authorization.ts";
export * as ProviderDiscovery from "./discovery/selection.ts";
export * as ZoneDiscovery from "./promise/zone-discovery.ts";
export * as Zones from "./discovery/zones.ts";
export * as DnsRecord from "./promise/dns-record.ts";
export * as DomainName from "./promise/domain-name.ts";
export * as InvalidInput from "./invalid-input.ts";
export * as DnsPlan from "./promise/dns-plan.ts";
export * as Deletion from "./promise/deletion.ts";
export * as Cloudflare from "./promise/cloudflare.ts";
export * as Vercel from "./promise/vercel.ts";
export * as Provisioning from "./promise/provisioning.ts";
export * as Verification from "./promise/verification.ts";
export * as CloudflareDnsOverHttps from "./promise/cloudflare-doh.ts";
export * as DnsOverHttps from "./promise/doh.ts";
export * as GoogleDnsOverHttps from "./promise/google-doh.ts";
export * as DnsResolverPool from "./promise/resolver-pool.ts";
