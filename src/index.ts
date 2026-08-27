import packageJson from "../package.json" with { type: "json" };

/** The current package version from the package manifest. */
export const VERSION = packageJson.version;

export * as Connection from "./promise/connection.ts";
export * as ProviderAuth from "./promise/provider-auth.ts";
export * as Secret from "./auth/secret.ts";
export * as ProviderDiscovery from "./discovery/selection.ts";
export * as Zones from "./discovery/zones.ts";
export * as DnsRecord from "./promise/dns-record.ts";
export * as DomainName from "./promise/domain-name.ts";
export * as InvalidInput from "./invalid-input.ts";
export * as DnsPlan from "./promise/dns-plan.ts";
export type * as DnsProvider from "./promise/dns-provider.ts";
export type * as DnsResolver from "./promise/dns-resolver.ts";
export * as OAuth from "./promise/oauth.ts";
export * as Provisioning from "./promise/provisioning.ts";
export type * as Stores from "./promise/stores.ts";
export * as TokenConnection from "./promise/token.ts";
export * as Verification from "./promise/verification.ts";
export * as CloudflareDnsOverHttps from "./promise/cloudflare-doh.ts";
