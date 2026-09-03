import { DnsRecord } from "domainkit";
import { Transport } from "domainkit/client";
import { Domain, DomainKit } from "@domainkit/react";

// #region setup
/** Points at the routes you mounted from `domainkit/server`. No credential reaches the browser. */
const transport = Transport.fromFetch("/api/domainkit");

const requirements = [
  DnsRecord.cname({ name: "app.example.com", target: "edge.acme.dev", purpose: "Serve your site" }),
  DnsRecord.txt({
    name: "_acme.app.example.com",
    value: "acme-verify=7f3a",
    purpose: "Prove ownership",
  }),
];
// #endregion setup

// #region flow
/**
 * Two components. `Domain.Flow` connects a provider, plans the changes, takes the customer's
 * approval or refusal, applies the plan, observes the records, and cleans them up against the
 * receipt. It renders only the capability groups the transport declares.
 */
export function DomainSettings() {
  return (
    <DomainKit.Root transport={transport} colorScheme="inherit">
      <Domain.Flow domain="app.example.com" requirements={requirements} />
    </DomainKit.Root>
  );
}
// #endregion flow

// #region events
/** Finished steps arrive as events, for your notifications, analytics, and audit trail. */
export function DomainSettingsWithEvents() {
  return (
    <DomainKit.Root
      transport={transport}
      onEvent={(event) => {
        if (event._tag === "Applied") track("dns.applied", { receiptId: event.receipt.id });
      }}
    >
      <Domain.Flow domain="app.example.com" requirements={requirements} />
    </DomainKit.Root>
  );
}
// #endregion events

declare function track(name: string, properties: Record<string, string>): void;
