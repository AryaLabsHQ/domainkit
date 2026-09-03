/** domainkit/testing */
// Re-exporting from the root evaluates it first, so the value-module cycle (DomainName ->
// DomainKitError -> Plan -> DnsRecord) is entered from `index.ts` whichever entry loads first.
export { VERSION } from "../index.ts";
export * as Testing from "../Testing.ts";
