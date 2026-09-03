/** domainkit/testing */
// The root evaluates first so the value-module cycle (DomainName -> DomainKitError -> Plan ->
// DnsRecord) is entered from `index.ts`, whichever entry a consumer imports first.
import "../index.ts";

export * as Testing from "../Testing.ts";
