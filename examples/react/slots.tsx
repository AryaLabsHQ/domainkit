import type { DnsRecord } from "domainkit";
import type { Transport } from "domainkit/client";
import { Connect, Domain, DomainKit, Records, Verify } from "@domainkit/react";

declare const transport: Transport.Interface;
declare const requirements: ReadonlyArray<DnsRecord.Model>;

// #region one-slot
/** Own one piece of the flow and keep the rest. Every slot has a default. */
export function DomainSettings() {
  return (
    <DomainKit.Root transport={transport}>
      <Domain.Flow
        domain="app.example.com"
        requirements={requirements}
        slots={{
          records: ({ records, readiness }) =>
            records.map((record) => (
              <Records.Card
                className="my-card"
                key={Records.identity(record)}
                readiness={readiness}
                record={record}
              />
            )),
        }}
        onApplied={(receipt) => track("dns.applied", { receiptId: receipt.id })}
      />
    </DomainKit.Root>
  );
}
// #endregion one-slot

// #region layout
/**
 * `Domain.Flow` wraps no slot in a container of its own, so the slot output is a direct child of
 * the flow root and your grid places it.
 */
export function DomainSettingsInAGrid() {
  return (
    <DomainKit.Root transport={transport}>
      <Domain.Flow
        className="settings-grid"
        domain="app.example.com"
        requirements={requirements}
        slots={{
          connection: ({ controller }) => <Connect.Card controller={controller} />,
          verification: ({ controller }) => <Verify.Status controller={controller} />,
        }}
      />
    </DomainKit.Root>
  );
}
// #endregion layout

// #region actions
/** The records slot carries the plan and the provisioning controller, so a host owns the action. */
export function DomainSettingsWithMyButtons() {
  return (
    <DomainKit.Root transport={transport}>
      <Domain.Flow
        domain="app.example.com"
        requirements={requirements}
        slots={{
          records: ({ plan, provisioning, readiness, records }) => (
            <div className="my-records">
              <Records.Table plan={plan} readiness={readiness} records={records} />
              <button disabled={plan === null} onClick={() => provisioning.approve()} type="button">
                Add these records
              </button>
            </div>
          ),
        }}
      />
    </DomainKit.Root>
  );
}
// #endregion actions

declare function track(name: string, properties: Record<string, string>): void;
