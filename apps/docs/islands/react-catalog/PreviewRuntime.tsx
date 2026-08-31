import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { DomainName, Transport } from "domainkit";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Cleanup,
  Connection,
  Domain,
  DomainKit,
  Lifecycle,
  Provider,
  Provisioning,
  Records,
  Testing,
  Verification,
} from "@domainkit/react";

import { defaultRecords, type PreviewState } from "./preview-state.ts";
import { workshopTheme } from "./themes.ts";

function makeTransport(
  state: Pick<PreviewState, "domain" | "providerId" | "providerName" | "story" | "targetState">,
  records: () => ReadonlyArray<Transport.DnsRecord>,
) {
  const provider = Testing.provider({
    id: state.providerId,
    name: state.providerName,
  });
  const targets =
    state.targetState === "unavailable"
      ? []
      : [
          Testing.target({
            evidence: {
              accountName: "Arya Labs",
              nameservers: [],
              status: "active",
              zoneType: "full",
            },
          }),
          ...(state.targetState === "ambiguous"
            ? [
                Testing.target({
                  accountId: "team-2",
                  accountKind: "team",
                  evidence: {
                    accountName: "Samva Team",
                    nameservers: [],
                    status: "active",
                    zoneType: "full",
                  },
                  zoneId: "zone-2",
                }),
              ]
            : []),
        ];
  const disconnected = {
    _tag: "Disconnected" as const,
    domain: state.domain,
    provider,
    reusableConnections: [
      {
        connection: Testing.connection({ providerId: state.providerId }),
        targets,
      },
    ],
  };
  const transport = Testing.makeFakeTransport({
    cleanupPlan: {
      _tag: "CleanupPlan",
      digest: "cleanup-digest-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
      operations: [],
    } satisfies Transport.CleanupPlan,
    detach: {
      _tag: "Detached",
      attachment: Testing.attachment({
        connectionId: "connection-1",
        domain: DomainName.parse(state.domain),
        target: targets[0] ?? Testing.target(),
      }),
      connection: Testing.connection({ providerId: state.providerId }),
      remainingAttachments: 0,
    },
    inspect:
      state.story === "lifecycle" || state.story === "host-lifecycle"
        ? {
            ...Testing.connected({
              attachment: Testing.attachment({
                domain: DomainName.parse(state.domain),
                target: targets[0] ?? Testing.target(),
              }),
              connection: Testing.connection({ providerId: state.providerId }),
            }),
            provider,
          }
        : disconnected,
  });
  let detached = false;
  return Transport.layerFromAsync({
    ...transport,
    cleanup: {
      apply: transport.cleanup.apply,
      plan: async (input: Parameters<typeof transport.cleanup.plan>[0]) => {
        const planned = await transport.cleanup.plan(input);
        if (planned._tag !== "CleanupPlan") return planned;
        return {
          ...planned,
          operations: records().map((record) => ({
            _tag: "Delete" as const,
            id: `delete-${record.id}`,
            record,
          })),
        };
      },
    },
    connection: {
      ...transport.connection,
      detach: async (input) => {
        const result = await transport.connection.detach(input);
        detached = true;
        return result;
      },
      inspect: (input) =>
        detached ? Promise.resolve(disconnected) : transport.connection.inspect(input),
    },
  });
}

function HostConnectionRow({ domain }: { readonly domain: string }) {
  const controller = Connection.useController(domain);
  const state = controller.state;
  const snapshot =
    state._tag === "Disconnected"
      ? state
      : state._tag === "Submitting" || state._tag === "Redirecting"
        ? state.snapshot
        : undefined;
  return (
    <Connection.Root status={state._tag}>
      {snapshot === undefined ? (
        <Connection.Status state={state} />
      ) : (
        <div data-preview-host-row="">
          <div data-preview-host-identity="">
            <Provider.Mark provider={snapshot.provider} />
            <div>
              <strong>{snapshot.provider.name}</strong>
              <p>Manages DNS for this domain.</p>
            </div>
          </div>
          <BaseDialog.Root>
            <Connection.Trigger
              aria-label={`Connect ${snapshot.provider.name}`}
              render={<button data-preview-host-button="" type="button" />}
            >
              <span aria-hidden="true">Connect</span>
              <span aria-hidden="true">{snapshot.provider.name}</span>
            </Connection.Trigger>
            <Connection.Dialog controller={controller} snapshot={snapshot} />
          </BaseDialog.Root>
        </div>
      )}
    </Connection.Root>
  );
}

function HostLifecycleRow({
  domain,
  hasReceipt,
  records,
}: {
  readonly domain: string;
  readonly hasReceipt: boolean;
  readonly records: ReadonlyArray<Transport.DnsRecord>;
}) {
  const controller = Connection.useController(domain);
  const connection = controller.state;
  const [appliedReceiptId, setAppliedReceiptId] = useState<string | undefined>(() =>
    hasReceipt ? "receipt-1" : undefined,
  );
  useEffect(() => {
    setAppliedReceiptId((current: string | undefined) =>
      hasReceipt ? (current ?? "receipt-1") : undefined,
    );
  }, [hasReceipt]);
  if (connection._tag !== "Connected") {
    return <Connection.Status state={connection} />;
  }
  return (
    <Connection.Root status={connection._tag}>
      <div data-preview-host-row="">
        <div data-preview-host-identity="">
          <Provider.Mark provider={connection.provider} />
          <div>
            <strong>{connection.provider.name}</strong>
            <p>Connected</p>
          </div>
        </div>
        <div data-preview-host-actions="">
          {appliedReceiptId === undefined ? null : (
            <Cleanup.Flow
              connection={connection}
              receiptId={appliedReceiptId}
              style={{ display: "contents" }}
            />
          )}
          <Connection.DisconnectDialog connection={connection} controller={controller} />
          <Provisioning.Flow
            connection={connection}
            onApplied={(result) => setAppliedReceiptId(result.receiptId)}
            records={records}
            showRecords={false}
            style={{ display: "contents" }}
          />
        </div>
      </div>
    </Connection.Root>
  );
}

export function Preview({ state }: { readonly state: PreviewState }) {
  const [event, setEvent] = useState<Lifecycle.Event>();
  useEffect(() => {
    if (event === undefined) return;
    const timeout = window.setTimeout(() => setEvent(undefined), 4_000);
    return () => window.clearTimeout(timeout);
  }, [event]);
  const records = useRef(state.records);
  records.current = state.records;
  const transport = useMemo(
    () => makeTransport(state, () => records.current),
    [state.domain, state.providerId, state.providerName, state.story, state.targetState],
  );
  let children: ReactNode;
  switch (state.story) {
    case "connection":
      children = <Connection.Flow domain={state.domain} />;
      break;
    case "host-connection":
      children = (
        <div data-preview-stack="">
          <HostConnectionRow domain={state.domain} />
          <div data-preview-narrow="">
            <HostConnectionRow domain={state.domain} />
          </div>
        </div>
      );
      break;
    case "host-lifecycle":
      children = (
        <HostLifecycleRow
          domain={state.domain}
          hasReceipt={state.receipt}
          records={state.records}
        />
      );
      break;
    case "domain":
    case "lifecycle":
      children = (
        <Domain.Flow
          domain={state.domain}
          receiptId={state.receipt ? "receipt-1" : undefined}
          records={state.records}
        />
      );
      break;
    case "provider":
      children = (
        <div data-preview-spot="">
          <Provider.Mark
            provider={Testing.provider({ id: state.providerId, name: state.providerName })}
          />
        </div>
      );
      break;
    case "records":
      children = (
        <div data-preview-stack="">
          <Records.ZoneFile domain={state.domain} records={state.records} />
          <Records.Table
            evidence={state.records.map((record) => ({
              _tag: "Found" as const,
              recordId: record.id,
            }))}
            records={state.records}
          />
        </div>
      );
      break;
    case "card":
      children = (
        <div data-preview-stack="">
          {state.records.map((record) => (
            <Records.Card
              evidence={[{ _tag: "Found", recordId: record.id }]}
              key={record.id}
              record={record}
            />
          ))}
        </div>
      );
      break;
    case "verification":
      children = <Verification.Status config={{ domain: state.domain, records: state.records }} />;
      break;
  }
  return (
    <DomainKit.Root
      colorScheme={state.colorScheme}
      onEvent={setEvent}
      theme={workshopTheme(state.theme, state.colorScheme)}
      transport={transport}
    >
      {children}
      {event === undefined ? null : (
        <div data-preview-notification="" role="status">
          {event._tag}
        </div>
      )}
    </DomainKit.Root>
  );
}

export { defaultRecords };
export default Preview;
