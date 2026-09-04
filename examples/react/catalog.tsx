import type { DnsRecord } from "domainkit";
import {
  Cleanup,
  Connect,
  Domain,
  Outcome,
  Provider,
  Provision,
  Records,
  Verify,
} from "@domainkit/react";

declare const domain: string;
declare const requirements: ReadonlyArray<DnsRecord.Model>;
declare const provider: Provider.Descriptor;
declare function MyIcon(): React.ReactElement;

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

// #region connect-prompt
/** The disconnected offer. With no provider serving the zone this renders nothing; `connect="always"` offers the dialog anyway. */
export function ConnectPrompt() {
  const controller = Connect.useController({ domain });
  return <Connect.Prompt controller={controller} />;
}
// #endregion connect-prompt

// #region outcome
/** The default composition, then one the host writes itself. Both take their words from the catalog. */
export function ConnectionOutcome() {
  const controller = Connect.useController({ domain });
  return (
    <>
      <Connect.Outcome controller={controller} />
      <Connect.Outcome controller={controller} layout="inline">
        <Outcome.Media variant="default">
          <MyIcon />
        </Outcome.Media>
        <Outcome.Title />
        <Outcome.Content />
      </Connect.Outcome>
    </>
  );
}
// #endregion outcome

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
