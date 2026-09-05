import { Receipt, type DnsRecord, type Plan } from "domainkit";
import { useCallback, useEffect, useRef, type ReactElement, type ReactNode } from "react";

import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import * as Connect from "./connect.tsx";
import { ReadOnly, useDomainKit, useReadOnly } from "./domain-kit.tsx";
import * as Provision from "./provision.tsx";
import * as Records from "./records.tsx";
import * as Verify from "./verify.tsx";

export interface RecordsSlotProps {
  readonly records: ReadonlyArray<DnsRecord.Model>;
  readonly readiness: Verify.Readiness | null;
  /** The plan awaiting its apply, whose operations the rows report; `null` once one has landed. */
  readonly plan: Plan.Model | null;
  readonly provisioning: Provision.Controller;
  readonly controller: Verify.Controller;
  readonly domain: string;
}

export interface VerificationSlotProps {
  readonly controller: Verify.Controller;
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
   * The account the records go to, as the provider labelled the zone when the domain was attached.
   * `null` until there is an attachment. A host writing its own summary line names the account
   * from this rather than reaching into the connection slot for it.
   */
  readonly label: string | null;
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
}

/** Built from primitives alone, so the effect that announces it depends on exactly those. */
const flowState = (input: {
  readonly connected: boolean;
  readonly label: string | null;
  readonly offering: boolean;
  readonly planning: Provision.State["_tag"];
  readonly provider: string | null;
  readonly receipt: string | null;
  readonly status: Connect.State["_tag"];
}): FlowState => ({
  applied: input.receipt !== null,
  connected: input.connected,
  connection: input.status,
  label: input.label,
  offering: input.offering,
  provider: input.provider,
  provisioning: input.planning,
  receiptId: input.receipt === null ? null : Receipt.ReceiptId.make(input.receipt),
});

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

/** The plan the rows report, which is one still awaiting its apply. */
const pendingPlan = (state: Provision.State): Plan.Model | null => {
  switch (state._tag) {
    case "Planned":
    case "Approving":
    case "Applying":
      return state.plan;
    case "Idle":
    case "Planning":
    case "Applied":
    case "Rejecting":
    case "Rejected":
    case "Failure":
      return null;
  }
};

/**
 * The whole lifecycle for one domain: connect, add the records, observe, clean up. The flow
 * renders only what the transport declares, and every part of it is a slot with a default. It adds
 * no layout containers of its own, so a host's grid can place the slot output directly.
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
  slots = {},
  ...props
}: FlowProps): ReactElement {
  const { capabilities, messages } = useDomainKit();
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
  // The flow knows what it asked for, so a domain with no attachment can still be verified.
  const verification = Verify.useController({ domain, requirements });
  const readiness = verification.readiness;
  const status = connection.state._tag;
  const planning = provisioning.state._tag;
  const surfaceReadOnly = readOnly ?? inherited;
  // The plan is what the table is: an attached domain with nothing applied to it yet has records
  // that are still a proposal, and the rows say so. The signature is what makes that one call per
  // reason to make it — the domain, the connection that landed, the receipt that is or is not
  // there, and what the host asked for — rather than one per render.
  const attached = connection.snapshot?.attachment != null;
  const label = connection.snapshot?.attachment?.label ?? null;
  const receiptId = connection.snapshot?.lastReceiptId ?? null;
  const signature =
    surfaceReadOnly || !capabilities.includes("provisioning") || !attached || receiptId !== null
      ? null
      : [domain, connection.established, Records.requirementsKey(requirements)].join("|");
  const plan = pendingPlan(provisioning.state);
  const planned = useRef<string | null>(null);
  const buildPlan = provisioning.plan;
  useEffect(() => {
    if (signature === null || planned.current === signature) return;
    planned.current = signature;
    buildPlan();
  }, [buildPlan, signature]);
  // The same predicate the surface renders on, so the state a host reads and the surface a
  // customer sees never disagree, including while a disconnect is in flight.
  const connected = Connect.holdsConnection(connection);
  const offering = Connect.offering(connection, connect);
  const provider = connection.snapshot?.provider ?? Connect.hostProvider(connection)?.id ?? null;
  const state = flowState({
    connected,
    label,
    offering,
    planning,
    provider,
    receipt: receiptId,
    status,
  });
  // The callback rides a ref so a host writing it inline does not re-announce every render.
  const announce = useRef(onState);
  useEffect(() => {
    announce.current = onState;
  });
  useEffect(() => {
    announce.current?.(
      flowState({ connected, label, offering, planning, provider, receipt: receiptId, status }),
    );
  }, [connected, label, offering, planning, provider, receiptId, status]);
  return usePart("div", props, state, {
    children: (
      <ReadOnly value={surfaceReadOnly}>
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
          <Records.Table
            {...(capabilities.includes("provisioning")
              ? { actions: <Provision.Action controller={provisioning} /> }
              : {})}
            caption={messages.recordsCaption(domain)}
            plan={plan}
            readiness={readiness}
            records={requirements}
          />
        ) : (
          slots.records({
            controller: verification,
            domain,
            plan,
            provisioning,
            readiness,
            records: requirements,
          })
        )}
        {!capabilities.includes("verification") ? null : slots.verification === undefined ? (
          <Verify.Status controller={verification} />
        ) : (
          slots.verification({ controller: verification, domain })
        )}
      </ReadOnly>
    ),
    "data-domainkit-part": "domain-flow",
    "data-domain": domain,
  });
}
