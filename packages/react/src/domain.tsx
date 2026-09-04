import { Receipt, type DnsRecord } from "domainkit";
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import * as Cleanup from "./cleanup.tsx";
import * as Connect from "./connect.tsx";
import { ReadOnly, useDomainKit, useReadOnly } from "./domain-kit.tsx";
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
  /** What the flow was told to offer when discovery names no host. */
  readonly connect: Connect.Invitation;
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
  /** Defaults to `Connect.Card` once connected and `Connect.Prompt` until then. */
  readonly connection?: (props: ConnectionSlotProps) => ReactNode;
}

/**
 * What DomainKit has to say about this domain, on the part's data attributes, in `className` and
 * `style` callbacks, and through `onState`. A host reads `connected` and `offering` to order its
 * own offers beside DomainKit's: an offer of its own competes while `offering` is true, and a
 * domain DomainKit holds needs none.
 */
export interface FlowState extends Record<string, unknown> {
  readonly connection: Connect.State["_tag"];
  readonly provisioning: Provision.State["_tag"];
  /**
   * DomainKit holds a connection for this domain, including while a command it started over that
   * connection is still running. `offering` is never true at the same time.
   */
  readonly connected: boolean;
  /** The connect surface has something to offer, so a host's own offer would compete with it. */
  readonly offering: boolean;
  /** Who holds the connection, or whose nameservers serve the zone. */
  readonly provider: string | null;
  /**
   * The apply receipt this domain's latest provisioning attempt produced, which is what cleanup
   * plans from. A host's own "remove this domain" surface offers cleanup only when there is one.
   */
  readonly receiptId: Receipt.ReceiptId | null;
  /** `receiptId !== null`: DomainKit applied records here and can prove which. */
  readonly applied: boolean;
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
  /**
   * Offer the connect dialog even when discovery names no host, for a host application that lets
   * a customer connect a provider the domain's nameservers do not point at, or `never` for a
   * domain the host has already settled another way. Defaults to `detected`.
   */
  readonly connect?: Connect.Invitation;
  /** Fires whenever what DomainKit has to say about this domain changes, and once on mount. */
  readonly onState?: (state: FlowState) => void;
  /**
   * `auto` plans and opens the review the moment a connection lands, so connecting and adding the
   * records is one pass rather than three. `manual` waits for the trigger.
   */
  readonly review?: Review;
}

/** Built from primitives alone, so the effect that announces it depends on exactly those. */
const flowState = (input: {
  readonly connected: boolean;
  readonly offering: boolean;
  readonly planning: Provision.State["_tag"];
  readonly provider: string | null;
  readonly receipt: string | null;
  readonly status: Connect.State["_tag"];
}): FlowState => ({
  applied: input.receipt !== null,
  connected: input.connected,
  connection: input.status,
  offering: input.offering,
  provider: input.provider,
  provisioning: input.planning,
  receiptId: input.receipt === null ? null : Receipt.ReceiptId.make(input.receipt),
});

/** Whether the flow opens the plan itself once a connection lands, or waits to be asked. */
export type Review = "auto" | "manual";

interface DefaultConnectionProps extends ConnectionSlotProps {
  readonly onCleaned?: (receipt: Receipt.Model) => void;
}

function DefaultConnection({
  connect,
  controller,
  onCleaned,
}: DefaultConnectionProps): ReactElement | null {
  const disconnected = controller.state._tag === "Disconnected";
  const host = Connect.hostProvider(controller);
  // No provider serves the zone, nothing is connected, and there is nothing to offer: DomainKit
  // has nothing to say about this domain, so it says nothing. A line here would sit above the
  // host's own offers and claim a place in an order it does not belong to. A host that wants the
  // sentence anyway renders `Connect.Status` itself.
  if (disconnected && host === null && !Connect.offering(controller, connect)) return null;
  // The prompt already names who serves the zone, so the status line is for everything else:
  // what the connection is doing, what a read-only customer sees where a trigger would be, and a
  // domain whose invitation the host turned off.
  const stated = disconnected && host !== null && Connect.offering(controller, connect);
  return Connect.holdsConnection(controller) ? (
    <Connect.Card controller={controller} {...(onCleaned === undefined ? {} : { onCleaned })} />
  ) : (
    <>
      {stated ? null : <Connect.Status controller={controller} />}
      <Connect.Prompt connect={connect} controller={controller} />
      {/* A failure the method already answers beside the field announces once, not twice. */}
      {Connect.answeredInPlace(controller) ? null : <Connect.Outcome controller={controller} />}
    </>
  );
}

/**
 * The page carries the trigger and, once an attempt ends, its outcome. What the plan will do,
 * whether to approve it, and how the apply is going all belong to the dialog the trigger opens:
 * approving beside no operations is a decision taken without the thing it is about. Removing
 * records is not here either — it is the option inside the disconnect dialog — and `Cleanup.Flow`
 * stays exported for a host that wants the standalone surface.
 */
interface DefaultActionsProps extends ActionsSlotProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

function DefaultActions({
  connection,
  onOpenChange,
  open,
  provisioning,
}: DefaultActionsProps): ReactElement | null {
  const readOnly = useReadOnly();
  const { capabilities } = useDomainKit();
  const connected = connection.state._tag === "Connected";
  // Every control here starts a write; the state a read-only customer may see is rendered above.
  if (readOnly) return null;
  if (!capabilities.includes("provisioning") || !connected) return null;
  return (
    <>
      <Provision.Dialog controller={provisioning} onOpenChange={onOpenChange} open={open} />
      {open ? null : <Provision.Outcome controller={provisioning} />}
    </>
  );
}

/**
 * The whole lifecycle for one domain: connect, review, apply, observe, clean up. The flow renders
 * only what the transport declares, and every part of it is a slot with a default. It adds no
 * layout containers of its own, so a host's grid can place the slot output directly.
 */
export function Flow({
  connect = "detected",
  domain,
  onApplied,
  onCleaned,
  onState,
  readOnly,
  requirements,
  returnTo,
  review = "auto",
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
  // The flow knows what it asked for, so a domain with no attachment can still be verified.
  const verification = Verify.useController({ domain, requirements });
  const readiness = verification.readiness;
  const status = connection.state._tag;
  const planning = provisioning.state._tag;
  // Connecting is the customer saying yes to the records; the plan is what those records are, so
  // it opens itself rather than waiting behind another click. `established` only ever grows, so
  // this fires once per connection that landed and never again on a re-render or a reload.
  const [reviewing, setReviewing] = useState(false);
  // A flow pointed at a new domain drops the review with everything else it was holding, while
  // rendering rather than an effect later, so no frame shows one domain's plan over another's.
  const [reviewed, setReviewed] = useState(domain);
  if (reviewed !== domain) {
    setReviewed(domain);
    setReviewing(false);
  }
  const established = connection.established;
  const answered = useRef(established);
  const buildPlan = provisioning.plan;
  useEffect(() => {
    if (answered.current === established) return;
    answered.current = established;
    if (review === "manual") return;
    buildPlan();
    setReviewing(true);
  }, [buildPlan, established, review]);
  // The same predicate the surface renders on, so the state a host reads and the surface a
  // customer sees never disagree, including while a disconnect is in flight.
  const connected = Connect.holdsConnection(connection);
  const offering = Connect.offering(connection, connect);
  const provider = connection.snapshot?.provider ?? Connect.hostProvider(connection)?.id ?? null;
  const receipt = connection.snapshot?.lastReceiptId ?? null;
  const state = flowState({ connected, offering, planning, provider, receipt, status });
  // The callback rides a ref so a host writing it inline does not re-announce every render.
  const announce = useRef(onState);
  useEffect(() => {
    announce.current = onState;
  });
  useEffect(() => {
    announce.current?.(flowState({ connected, offering, planning, provider, receipt, status }));
  }, [connected, offering, planning, provider, receipt, status]);
  return usePart("div", props, state, {
    children: (
      <ReadOnly value={readOnly ?? inherited}>
        {!capabilities.includes("connection") ? null : slots.connection === undefined ? (
          <DefaultConnection
            connect={connect}
            controller={connection}
            domain={domain}
            {...(onCleaned === undefined ? {} : { onCleaned })}
          />
        ) : (
          slots.connection({ connect, controller: connection, domain })
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
            onOpenChange={setReviewing}
            open={reviewing}
            provisioning={provisioning}
          />
        ) : (
          slots.actions({ cleanup, connection, domain, provisioning })
        )}
      </ReadOnly>
    ),
    "data-domainkit-part": "domain-flow",
    "data-domain": domain,
  });
}
