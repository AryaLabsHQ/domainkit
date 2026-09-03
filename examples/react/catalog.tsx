import type { DnsRecord } from "domainkit";
import { Cleanup, Connect, Domain, Provider, Provision, Records, Verify } from "@domainkit/react";

declare const domain: string;
declare const requirements: ReadonlyArray<DnsRecord.Model>;
declare const provider: Provider.Descriptor;

// #region domain-flow
export function DomainSetup() {
  return <Domain.Flow domain={domain} requirements={requirements} />;
}
// #endregion domain-flow

// #region connect
export function ConnectProvider() {
  return <Connect.Flow domain={domain} />;
}
// #endregion connect

// #region provision
export function ReviewChanges() {
  return <Provision.Flow domain={domain} requirements={requirements} trigger="Review changes" />;
}
// #endregion provision

// #region cleanup
export function RemoveRecords() {
  return <Cleanup.Flow domain={domain} trigger="Remove records" />;
}
// #endregion cleanup

// #region records
export function RequirementList() {
  return (
    <>
      <Records.ZoneFile domain={domain} records={requirements} />
      <Records.Table caption={`DNS for ${domain}`} records={requirements} />
    </>
  );
}
// #endregion records

// #region record-card
export function RequirementCards() {
  return requirements.map((record) => (
    <Records.Card key={Records.identity(record)} record={record} />
  ));
}
// #endregion record-card

// #region verification
export function DnsStatus() {
  const controller = Verify.useController({ domain });
  return <Verify.Status controller={controller} />;
}
// #endregion verification

// #region provider-mark
export function ProviderIdentity() {
  return <Provider.Mark provider={provider} />;
}
// #endregion provider-mark

// #region slots
/** One slot replaced, the rest of the flow untouched. */
export function DomainSetupWithMyTable() {
  return (
    <Domain.Flow
      domain={domain}
      requirements={requirements}
      slots={{
        records: ({ readiness, records }) => (
          <Records.Table caption="Add these records" readiness={readiness} records={records} />
        ),
      }}
    />
  );
}
// #endregion slots
