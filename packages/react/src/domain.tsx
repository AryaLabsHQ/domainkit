import { Receipt, type DnsRecord } from "domainkit";
import { useCallback, type ReactElement, type ReactNode } from "react";

import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import * as Cleanup from "./cleanup.tsx";
import * as Connect from "./connect.tsx";
import { ReadOnly, useDomainKit, useReadOnly } from "./domain-kit.tsx";
import { useIcons } from "./icons.tsx";
import * as Provision from "./provision.tsx";
import * as Records from "./records.tsx";
import * as Verify from "./verify.tsx";

export interface RecordsSlotProps {
  readonly records: ReadonlyArray<DnsRecord.Model>;
  readonly readiness: Verify.Readiness | null;
  readonly controller: Verify.Controller;
  readonly domain: string;
}

export interface VerificationSlotProps {
  readonly controller: Verify.Controller;
  readonly domain: string;
}

export interface ActionsSlotProps {
  readonly connection: Connect.Controller;
  readonly provisioning: Provision.Controller;
  readonly cleanup: Cleanup.Controller;
  readonly domain: string;
}

export interface ConnectionSlotProps {
  readonly controller: Connect.Controller;
  readonly domain: string;
}

/**
 * Each slot replaces one part of the flow and keeps the rest. Every slot has a default, so
 * `<Domain.Flow domain requirements />` is complete on its own.
 */
export interface Slots {
  /** The requirements table. Defaults to `Records.Table` with readiness when there is any. */
  readonly records?: (props: RecordsSlotProps) => ReactNode;
  /** Defaults to `Verify.Status`. Rendered only when the transport declares `verification`. */
  readonly verification?: (props: VerificationSlotProps) => ReactNode;
  /** Defaults to Approve and Decline, plus cleanup when the transport declares it. */
  readonly actions?: (props: ActionsSlotProps) => ReactNode;
  /** Defaults to `Connect.Card` once connected and `Connect.Dialog` until then. */
  readonly connection?: (props: ConnectionSlotProps) => ReactNode;
}

export interface FlowState extends Record<string, unknown> {
  readonly connection: Connect.State["_tag"];
  readonly provisioning: Provision.State["_tag"];
}

export interface FlowProps extends Omit<PartProps<"div", FlowState>, "children"> {
  readonly domain: string;
  readonly requirements: ReadonlyArray<DnsRecord.Model>;
  readonly slots?: Slots;
  readonly onApplied?: (receipt: Receipt.Model) => void;
  readonly onCleaned?: (receipt: Receipt.Model) => void;
  /**
   * Where an interactive provider flow returns the customer. Defaults to the page they started
   * from; pass `null` to let the server's `defaultReturnTo` decide.
   */
  readonly returnTo?: string | null;
  /** Render this domain's state without the controls that change it. Defaults to the root's. */
  readonly readOnly?: boolean;
}

function DefaultConnection({ controller }: ConnectionSlotProps): ReactElement {
  return controller.state._tag === "Connected" ? (
    <Connect.Card controller={controller} />
  ) : (
    <>
      <Connect.Status controller={controller} />
      <Connect.Dialog controller={controller} />
      <Connect.Outcome controller={controller} />
    </>
  );
}

function DefaultActions({
  cleanup,
  connection,
  provisioning,
}: ActionsSlotProps): ReactElement | null {
  const { capabilities, messages } = useDomainKit();
  const readOnly = useReadOnly();
  const icons = useIcons();
  const connected = connection.state._tag === "Connected";
  // Every control here starts a write; the state a read-only customer may see is rendered above.
  if (readOnly) return null;
  const hasReceipt = connection.snapshot?.lastReceiptId != null;
  return (
    <>
      {capabilities.includes("provisioning") && connected ? (
        <>
          <button
            data-domainkit-part="plan-trigger"
            disabled={provisioning.state._tag === "Planning"}
            onClick={provisioning.plan}
            type="button"
          >
            {messages.reviewChanges}
          </button>
          <Provision.Status controller={provisioning} />
          <Provision.Actions controller={provisioning} />
          <Provision.Outcome controller={provisioning} />
        </>
      ) : null}
      {capabilities.includes("cleanup") && connected && hasReceipt ? (
        <>
          <button
            data-domainkit-part="cleanup-trigger"
            disabled={cleanup.state._tag === "Planning"}
            onClick={cleanup.plan}
            type="button"
          >
            <span aria-hidden="true" data-icon="inline-start">
              {icons.close}
            </span>
            {messages.cleanUp}
          </button>
          <Cleanup.Status controller={cleanup} />
          <Cleanup.Actions controller={cleanup} />
          <Cleanup.Outcome controller={cleanup} />
        </>
      ) : null}
    </>
  );
}

/**
 * The whole lifecycle for one domain: connect, review, apply, observe, clean up. The flow renders
 * only what the transport declares, and every part of it is a slot with a default. It adds no
 * layout containers of its own, so a host's grid can place the slot output directly.
 */
export function Flow({
  domain,
  onApplied,
  onCleaned,
  readOnly,
  requirements,
  returnTo,
  slots = {},
  ...props
}: FlowProps): ReactElement {
  const { capabilities } = useDomainKit();
  const inherited = useReadOnly();
  const connection = Connect.useController({
    domain,
    ...(returnTo === undefined ? {} : { returnTo }),
  });
  const refresh = connection.refresh;
  const provisioning = Provision.useController({
    domain,
    onApplied: useCallback(
      (receipt: Receipt.Model) => {
        refresh();
        onApplied?.(receipt);
      },
      [onApplied, refresh],
    ),
    requirements,
  });
  const cleanup = Cleanup.useController({
    domain,
    onCleaned: useCallback(
      (receipt: Receipt.Model) => {
        refresh();
        onCleaned?.(receipt);
      },
      [onCleaned, refresh],
    ),
    ...(connection.snapshot?.lastReceiptId == null
      ? {}
      : { receiptId: Receipt.ReceiptId.make(connection.snapshot.lastReceiptId) }),
  });
  const verification = Verify.useController({ domain });
  const readiness = verification.readiness;
  return usePart(
    "div",
    props,
    { connection: connection.state._tag, provisioning: provisioning.state._tag },
    {
      children: (
        <ReadOnly value={readOnly ?? inherited}>
          {!capabilities.includes("connection") ? null : slots.connection === undefined ? (
            <DefaultConnection controller={connection} domain={domain} />
          ) : (
            slots.connection({ controller: connection, domain })
          )}
          {slots.records === undefined ? (
            <Records.Table readiness={readiness} records={requirements} />
          ) : (
            slots.records({ controller: verification, domain, readiness, records: requirements })
          )}
          {!capabilities.includes("verification") ? null : slots.verification === undefined ? (
            <Verify.Status controller={verification} />
          ) : (
            slots.verification({ controller: verification, domain })
          )}
          {slots.actions === undefined ? (
            <DefaultActions
              cleanup={cleanup}
              connection={connection}
              domain={domain}
              provisioning={provisioning}
            />
          ) : (
            slots.actions({ cleanup, connection, domain, provisioning })
          )}
        </ReadOnly>
      ),
      "data-domainkit-part": "domain-flow",
      "data-domain": domain,
    },
  );
}
