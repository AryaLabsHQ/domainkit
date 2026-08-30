import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { useEffect, useRef, useState } from "react";

import * as Cleanup from "./cleanup.tsx";
import * as Connection from "./connection.tsx";
import * as Provisioning from "./provisioning.tsx";
import * as Provider from "./provider.tsx";
import * as Verification from "./verification.tsx";
import type { ApplyResult, DnsRecord } from "./transport.ts";

export interface FlowProps {
  readonly domain: string;
  readonly receiptId?: string;
  readonly records: ReadonlyArray<DnsRecord>;
}

export function Flow({ domain, receiptId, records }: FlowProps) {
  const connection = Connection.useController(domain);
  const state = connection.state;
  return (
    <Connection.Root status={state._tag}>
      {state._tag === "Connected" ? null : <Connection.Status state={state} />}
      {state._tag === "Failure" && (state.retry === "safe" || state.retry === "unknown") ? (
        <Connection.RetryAction controller={connection} />
      ) : null}
      {state._tag === "Disconnected" ? (
        <BaseDialog.Root>
          <Connection.Trigger providerName={state.provider.name} />
          <Connection.Dialog controller={connection} snapshot={state} />
        </BaseDialog.Root>
      ) : null}
      {state._tag === "Connected" ? (
        <div data-domainkit-part="connected-shell">
          <div data-domainkit-part="connected-card">
            <div data-domainkit-part="connected-identity">
              <Provider.Mark provider={state.provider} />
              <Connection.Status state={state} />
            </div>
          </div>
          <ConnectedFlow
            connection={state}
            {...(receiptId === undefined ? {} : { initialReceiptId: receiptId })}
            records={records}
          />
        </div>
      ) : null}
    </Connection.Root>
  );
}

function ConnectedFlow({
  connection,
  initialReceiptId,
  records,
}: {
  readonly connection: Extract<Connection.State, { readonly _tag: "Connected" }>;
  readonly initialReceiptId?: string;
  readonly records: ReadonlyArray<DnsRecord>;
}) {
  const [appliedReceipt, setAppliedReceipt] = useState<{
    readonly epoch: number;
    readonly receiptId: string;
  }>();
  const receiptEpoch = useRef({ initialReceiptId, value: 0 });
  const epoch =
    receiptEpoch.current.initialReceiptId === initialReceiptId
      ? receiptEpoch.current.value
      : receiptEpoch.current.value + 1;
  useEffect(() => {
    if (receiptEpoch.current.initialReceiptId === initialReceiptId) return;
    receiptEpoch.current = { initialReceiptId, value: receiptEpoch.current.value + 1 };
    setAppliedReceipt(undefined);
  }, [initialReceiptId]);
  const receiptId =
    appliedReceipt !== undefined && appliedReceipt.epoch === epoch
      ? appliedReceipt.receiptId
      : initialReceiptId;
  const rememberReceipt = (
    result: Extract<ApplyResult, { readonly _tag: "Applied" | "Partial" }>,
  ) => {
    setAppliedReceipt({ epoch, receiptId: result.receiptId });
  };
  return (
    <>
      <Provisioning.Flow connection={connection} onApplied={rememberReceipt} records={records} />
      <Verification.Status config={{ connection, domain: connection.domain, records }} />
      {receiptId === undefined ? null : (
        <div data-domainkit-part="connected-danger">
          <Cleanup.Flow connection={connection} receiptId={receiptId} />
        </div>
      )}
    </>
  );
}
