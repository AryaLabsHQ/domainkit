/**
 * domainkit — the Effect-native root. One module per concept, each `Foo.Foo` for its tag or
 * schema.
 *
 * Lifecycle services: Connect, Provision, Cleanup, Verify.
 * Host seams:         Storage, Custody, Principal.
 * Providers:          Provider, Providers, Cloudflare, Vercel.
 * Values:             DomainName, DnsRecord, Plan, Approval, Receipt.
 * Everything else:    DomainKitError, Resolver, DomainKit (the composed layer).
 *
 * Subpath: domainkit/testing.
 */
import packageJson from "../package.json" with { type: "json" };

/** The current package version from the package manifest. */
export const VERSION = packageJson.version;

export * as Approval from "./Approval.ts";
export * as DnsRecord from "./DnsRecord.ts";
export * as DomainKitError from "./DomainKitError.ts";
export * as DomainName from "./DomainName.ts";
export * as Plan from "./Plan.ts";
export * as Receipt from "./Receipt.ts";
