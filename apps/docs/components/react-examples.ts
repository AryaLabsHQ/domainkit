import type { StoryId } from "../islands/react-catalog/preview-state.ts";

export const reactExampleSource: Readonly<Record<StoryId, string>> = {
  card: `import { Records } from "@domainkit/react";

export function RecordCard({ record, evidence }) {
  return <Records.Card evidence={evidence} record={record} />;
}`,
  connection: `import { Connection } from "@domainkit/react";

export function ConnectDomain() {
  return <Connection.Flow domain="mail.example.com" />;
}`,
  domain: `import { Domain } from "@domainkit/react";

export function DomainSetup() {
  return (
    <Domain.Flow
      domain="mail.example.com"
      receiptId="receipt-1"
      records={records}
    />
  );
}`,
  "host-connection": `import { Dialog } from "@base-ui/react/dialog";
import { Connection, Provider } from "@domainkit/react";

export function ConnectionRow({ domain }: { domain: string }) {
  const controller = Connection.useController(domain);
  const state = controller.state;
  const snapshot = state._tag === "Disconnected" ? state : undefined;

  return snapshot ? (
    <Connection.Root status={state._tag}>
      <Provider.Mark provider={snapshot.provider} />
      <Dialog.Root>
        <Connection.ConnectTrigger provider={snapshot.provider} />
        <Connection.Dialog controller={controller} snapshot={snapshot} />
      </Dialog.Root>
    </Connection.Root>
  ) : (
    <Connection.Status state={state} />
  );
}`,
  "host-lifecycle": `import { Cleanup, Connection, Provisioning } from "@domainkit/react";

export function DomainActions({ domain, records, receiptId }) {
  const controller = Connection.useController(domain);
  if (controller.state._tag !== "Connected") {
    return <Connection.Status state={controller.state} />;
  }

  return (
    <Connection.Root status="Connected">
      <Cleanup.Flow connection={controller.state} receiptId={receiptId} />
      <Connection.DisconnectDialog
        connection={controller.state}
        controller={controller}
      />
      <Provisioning.Flow
        connection={controller.state}
        records={records}
        showRecords={false}
      />
    </Connection.Root>
  );
}`,
  lifecycle: `import { Domain } from "@domainkit/react";

export function DomainSetup() {
  return <Domain.Flow domain="mail.example.com" records={records} />;
}`,
  provider: `import { Provider } from "@domainkit/react";

export function ProviderIdentity({ provider }) {
  return <Provider.Mark provider={provider} />;
}`,
  records: `import { Records } from "@domainkit/react";

export function DnsRecords() {
  return (
    <>
      <Records.ZoneFile domain="mail.example.com" records={records} />
      <Records.Table evidence={evidence} records={records} />
    </>
  );
}`,
  verification: `import { Verification } from "@domainkit/react";

export function DnsVerification({ connection, domain, records }) {
  return (
    <Verification.Status config={{ connection, domain, records }} />
  );
}`,
};
