import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { Transport } from "domainkit";
import { useRef, useState, type RefObject } from "react";

import * as Cleanup from "./cleanup.tsx";
import * as Connection from "./connection.tsx";
import { useDomainKit } from "./domain-kit.tsx";
import * as Provider from "./provider.tsx";
import * as Provisioning from "./provisioning.tsx";
import * as Records from "./records.tsx";
import * as Verification from "./verification.tsx";

export interface FlowProps {
  readonly domain: string;
  readonly receiptId?: string;
  readonly records: ReadonlyArray<Transport.DnsRecord>;
}

export function Flow({ domain, receiptId, records }: FlowProps) {
  const controller = Connection.useController(domain);
  const state = controller.state;
  const connected =
    state._tag === "Connected"
      ? state
      : state._tag === "Disconnecting"
        ? state.snapshot
        : undefined;
  return (
    <Connection.Root status={state._tag}>
      {state._tag === "Connected" || state._tag === "Disconnecting" ? (
        <ConnectedCard
          connection={state._tag === "Connected" ? state : state.snapshot}
          controller={controller}
          {...(receiptId === undefined ? {} : { initialReceiptId: receiptId })}
          records={records}
          status={state._tag}
        />
      ) : (
        <AvailableCard controller={controller} state={state} />
      )}
      <Records.Table records={records} />
      <Verification.Status
        config={{
          ...(connected === undefined ? {} : { connection: connected }),
          domain,
          records,
        }}
      />
    </Connection.Root>
  );
}

function AvailableCard({
  controller,
  state,
}: {
  readonly controller: Connection.Controller;
  readonly state: Exclude<Connection.State, Transport.Connected>;
}) {
  const { messages } = useDomainKit();
  const snapshot =
    state._tag === "Disconnected"
      ? state
      : state._tag === "Submitting" || state._tag === "Redirecting"
        ? state.snapshot
        : undefined;
  return (
    <Connection.Card status={state._tag}>
      <Connection.CardIdentity status={state._tag}>
        {snapshot === undefined ? null : <Provider.Mark provider={snapshot.provider} />}
        <Connection.Status state={state} />
      </Connection.CardIdentity>
      <Connection.CardActions status={state._tag}>
        {state._tag === "Failure" && state.retry !== "never" ? (
          <Connection.RetryAction
            controller={controller}
            kind={state.retry === "after-user-action" ? "after-user-action" : "retry"}
          />
        ) : null}
        {snapshot === undefined ? null : (
          <BaseDialog.Root
            onOpenChange={(open, eventDetails) => {
              if (!open && (state._tag === "Submitting" || state._tag === "Redirecting")) {
                eventDetails.cancel();
              }
            }}
          >
            <Connection.ConnectTrigger
              disabled={state._tag === "Submitting" || state._tag === "Redirecting"}
              provider={snapshot.provider}
            >
              {messages.connectProvider(snapshot.provider.name)}
            </Connection.ConnectTrigger>
            <Connection.Dialog controller={controller} snapshot={snapshot} />
          </BaseDialog.Root>
        )}
      </Connection.CardActions>
    </Connection.Card>
  );
}

function ConnectedCard({
  connection,
  controller,
  initialReceiptId,
  records,
  status,
}: {
  readonly connection: Transport.Connected;
  readonly controller: Connection.Controller;
  readonly initialReceiptId?: string;
  readonly records: ReadonlyArray<Transport.DnsRecord>;
  readonly status: "Connected" | "Disconnecting";
}) {
  const [receipt, setReceipt] = useState({
    host: initialReceiptId,
    value: initialReceiptId,
  });
  if (receipt.host !== initialReceiptId) {
    setReceipt({ host: initialReceiptId, value: initialReceiptId });
  }
  const receiptId = receipt.host === initialReceiptId ? receipt.value : initialReceiptId;
  const disabled = status === "Disconnecting";
  const actionsTriggerRef = useRef<HTMLButtonElement>(null);
  return (
    <Connection.Card status={status}>
      <Connection.CardIdentity status={status}>
        <Provider.Mark provider={connection.provider} />
        <Connection.Status state={status === "Connected" ? connection : controller.state} />
      </Connection.CardIdentity>
      <Connection.CardActions status={status}>
        <Provisioning.Flow
          connection={connection}
          onApplied={(result) => setReceipt({ host: initialReceiptId, value: result.receiptId })}
          records={records}
          showRecords={false}
        />
        {receiptId === undefined ? (
          <ProviderActions
            actionsTriggerRef={actionsTriggerRef}
            connection={connection}
            controller={controller}
            disabled={disabled}
          />
        ) : (
          <ProviderActionsWithCleanup
            actionsTriggerRef={actionsTriggerRef}
            connection={connection}
            controller={controller}
            disabled={disabled}
            key={receiptId}
            onCleaned={() => setReceipt({ host: initialReceiptId, value: undefined })}
            receiptId={receiptId}
          />
        )}
      </Connection.CardActions>
    </Connection.Card>
  );
}

function ProviderActionsWithCleanup({
  actionsTriggerRef,
  connection,
  controller,
  disabled,
  onCleaned,
  receiptId,
}: {
  readonly actionsTriggerRef: RefObject<HTMLButtonElement | null>;
  readonly connection: Transport.Connected;
  readonly controller: Connection.Controller;
  readonly disabled: boolean;
  readonly onCleaned: () => void;
  readonly receiptId: string;
}) {
  const [cleaned, setCleaned] = useState(false);
  const cleanup = Cleanup.useController(connection, receiptId, (result) => {
    if (result._tag === "Cleaned") setCleaned(true);
  });
  return (
    <ProviderActions
      actionsTriggerRef={actionsTriggerRef}
      cleanup={cleanup}
      connection={connection}
      controller={controller}
      disabled={disabled}
      onCleanupCloseComplete={() => {
        if (cleaned) onCleaned();
      }}
    />
  );
}

function ProviderActions({
  actionsTriggerRef: actionsTriggerRefProp,
  cleanup,
  connection,
  controller,
  disabled,
  onCleanupCloseComplete,
}: {
  readonly actionsTriggerRef?: RefObject<HTMLButtonElement | null>;
  readonly cleanup?: Cleanup.Controller;
  readonly connection: Transport.Connected;
  readonly controller: Connection.Controller;
  readonly disabled: boolean;
  readonly onCleanupCloseComplete?: () => void;
}) {
  const { colorScheme, messages, portalContainer, themeStyle } = useDomainKit();
  const fallbackActionsTriggerRef = useRef<HTMLButtonElement>(null);
  const actionsTriggerRef = actionsTriggerRefProp ?? fallbackActionsTriggerRef;
  const [menuOpen, setMenuOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  return (
    <>
      <BaseMenu.Root disabled={disabled} modal={false} onOpenChange={setMenuOpen} open={menuOpen}>
        <BaseMenu.Trigger
          aria-label={messages.moreActions}
          data-domainkit-part="actions-trigger"
          ref={actionsTriggerRef}
        >
          <span aria-hidden="true">⋯</span>
        </BaseMenu.Trigger>
        <BaseMenu.Portal container={portalContainer} keepMounted>
          <BaseMenu.Positioner align="end" sideOffset={6}>
            <BaseMenu.Popup
              data-color-scheme={colorScheme}
              data-domainkit-part="actions-menu"
              data-domainkit-root=""
              style={themeStyle}
            >
              {cleanup === undefined ? null : (
                <>
                  <BaseMenu.Item
                    closeOnClick={false}
                    data-domainkit-part="actions-item"
                    nativeButton
                    onClickCapture={() => {
                      setMenuOpen(false);
                      queueMicrotask(() => cleanup.plan());
                    }}
                    render={<button type="button" />}
                  >
                    {messages.reviewCleanup}
                  </BaseMenu.Item>
                  <BaseMenu.Separator data-domainkit-part="actions-separator" />
                </>
              )}
              <BaseMenu.Item
                closeOnClick={false}
                data-domainkit-part="actions-item"
                data-tone="danger"
                nativeButton
                onClickCapture={() => {
                  setMenuOpen(false);
                  queueMicrotask(() => setDisconnectOpen(true));
                }}
                render={<button type="button" />}
              >
                {messages.disconnectDomain}
              </BaseMenu.Item>
            </BaseMenu.Popup>
          </BaseMenu.Positioner>
        </BaseMenu.Portal>
      </BaseMenu.Root>
      {cleanup === undefined ? null : (
        <Cleanup.Dialog
          controller={cleanup}
          onOpenChangeComplete={(open) => {
            if (!open) {
              onCleanupCloseComplete?.();
              queueMicrotask(() => actionsTriggerRef.current?.focus());
            }
          }}
          trigger={null}
        />
      )}
      <Connection.DisconnectDialog
        connection={connection}
        controller={controller}
        onOpenChange={(open) => {
          setDisconnectOpen(open);
          if (!open) queueMicrotask(() => actionsTriggerRef.current?.focus());
        }}
        open={disconnectOpen}
        trigger={null}
      />
    </>
  );
}
