import { DnsRecord, Plan } from "domainkit";
import { Transport } from "domainkit/client";
import { Domain, DomainKit } from "@domainkit/react";

// #region setup
/** Points at the routes you mounted from `domainkit/server`. No credential reaches the browser. */
const transport = Transport.fromFetch("/api/domainkit");

const requirements = [
  DnsRecord.cname({
    name: "app.example.com",
    target: "edge.acme.dev",
    purpose: "Serve your site",
  }),
  DnsRecord.txt({
    name: "_acme.app.example.com",
    value: "acme-verify=7f3a",
    purpose: "Prove ownership",
  }),
];
// #endregion setup

// #region flow
/**
 * One hook. `Domain.useFlow` connects a provider, plans the changes, takes the customer's approval
 * or refusal, applies the plan, observes the records, and cleans them up against the receipt. It
 * reports only the capability groups the transport declares, and your markup renders it.
 */
function DomainSetup() {
  const flow = Domain.useFlow({ domain: "app.example.com", requirements });
  const writes = flow.plan === null ? [] : Plan.writes(flow.plan);
  return (
    <section>
      <p>{flow.state.connected ? `Connected to ${flow.state.provider}` : "Not connected"}</p>
      {writes.length === 0 ? null : (
        <button onClick={() => flow.provisioning.approve()} type="button">
          Add {writes.length} records
        </button>
      )}
    </section>
  );
}

export function DomainSettings() {
  return (
    <DomainKit.Root transport={transport}>
      <DomainSetup />
    </DomainKit.Root>
  );
}
// #endregion flow

// #region events
/** Finished steps arrive as events, for your notifications, analytics, and audit trail. */
export function DomainSettingsWithEvents() {
  return (
    <DomainKit.Root
      onEvent={(event) => {
        if (event._tag === "Applied") track("dns.applied", { receiptId: event.receipt.id });
      }}
      transport={transport}
    >
      <DomainSetup />
    </DomainKit.Root>
  );
}
// #endregion events

// #region return-to
/**
 * An interactive provider returns the customer to the page they started from, read when they
 * connect rather than when the flow renders. Name a different destination, or pass `null` to leave
 * the server's `defaultReturnTo` in charge.
 */
function DomainSetupWithReturn() {
  const flow = Domain.useFlow({
    domain: "app.example.com",
    requirements,
    returnTo: "/settings/domains?connected=1",
  });
  return <p>{flow.state.connection}</p>;
}

export function DomainSettingsWithReturn() {
  return (
    <DomainKit.Root transport={transport}>
      <DomainSetupWithReturn />
    </DomainKit.Root>
  );
}
// #endregion return-to

declare function track(name: string, properties: Record<string, string>): void;
