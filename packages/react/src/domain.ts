/**
 * The whole lifecycle for one domain in one hook: connect, add the records, observe, clean up.
 * `useFlow` runs the four controllers together and plans as soon as the domain is attached with
 * nothing applied, so the styled surface is only markup.
 */
import { Receipt, type DnsRecord, type Plan } from "domainkit";
import type { Transport } from "domainkit/client";
import { useCallback, useEffect, useRef } from "react";

import * as Cleanup from "./cleanup.ts";
import * as Connect from "./connect.ts";
import { useDomainKit, useReadOnly } from "./domain-kit.tsx";
import * as Provision from "./provision.ts";
import { requirementsKey } from "./records.ts";
import * as Verify from "./verify.ts";

/**
 * What DomainKit has to say about this domain. A host reads `connected` and `offering` to order
 * its own offers beside DomainKit's: an offer of its own competes while `offering` is true, and a
 * domain DomainKit holds needs none.
 */
export interface FlowState {
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
   * `null` until there is an attachment.
   */
  readonly label: string | null;
  /**
   * The apply receipt this domain's latest provisioning attempt produced, which is what cleanup
   * plans from. A host's own "remove this domain" surface offers cleanup only when there is one.
   */
  readonly receiptId: Receipt.ReceiptId | null;
  /** `receiptId !== null`: DomainKit applied records here and can prove which. */
  readonly applied: boolean;
  /**
   * The surface may read this domain but not write to it, so a host can say why rather than
   * leaving a customer in front of a page with nothing on it.
   */
  readonly readOnly: boolean;
}

export interface FlowOptions {
  readonly domain: string;
  readonly requirements: ReadonlyArray<DnsRecord.Model>;
  /**
   * Offer the connect surface even when discovery names no host, for a host application that lets
   * a customer connect a provider the domain's nameservers do not point at, or `never` for a
   * domain the host has already settled another way. Defaults to `detected`.
   */
  readonly connect?: Connect.Invitation;
  readonly onApplied?: (receipt: Receipt.Model) => void;
  readonly onCleaned?: (receipt: Receipt.Model) => void;
  /**
   * Where an interactive provider flow returns the customer. Defaults to the page they started
   * from; pass `null` to let the server's `defaultReturnTo` decide.
   */
  readonly returnTo?: string | null;
  /** Report this domain's state without the controls that change it. Defaults to the root's. */
  readonly readOnly?: boolean;
}

export interface Flow {
  readonly domain: string;
  /** What the host asked for, as the surface renders it row by row. */
  readonly requirements: ReadonlyArray<DnsRecord.Model>;
  readonly state: FlowState;
  readonly connection: Connect.Controller;
  readonly provisioning: Provision.Controller;
  /** Bound to the domain's latest apply receipt, which is the only thing cleanup may undo. */
  readonly cleanup: Cleanup.Controller;
  readonly verification: Verify.Controller;
  /** The plan the rows report, which is one still awaiting its apply. */
  readonly plan: Plan.Model | null;
  readonly readiness: Verify.Readiness | null;
  /** Which capability groups the transport declares, so a surface renders only what it can run. */
  readonly capabilities: ReadonlyArray<Transport.Capability>;
  /** What the flow was told to offer when discovery names no host. */
  readonly invitation: Connect.Invitation;
}

/** Built from primitives alone, so the memo that reports it depends on exactly those. */
const flowState = (input: {
  readonly connected: boolean;
  readonly label: string | null;
  readonly offering: boolean;
  readonly planning: Provision.State["_tag"];
  readonly provider: string | null;
  readonly readOnly: boolean;
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
  readOnly: input.readOnly,
  receiptId: input.receipt === null ? null : Receipt.ReceiptId.make(input.receipt),
});

export function useFlow({
  connect = "detected",
  domain,
  onApplied,
  onCleaned,
  readOnly,
  requirements,
  returnTo,
}: FlowOptions): Flow {
  const { capabilities } = useDomainKit();
  const inherited = useReadOnly();
  const surfaceReadOnly = readOnly ?? inherited;
  // The flow's own flag reaches its controllers, so a read-only domain among writable ones
  // refuses commands rather than only reporting that it should.
  const connection = Connect.useController({
    domain,
    readOnly: surfaceReadOnly,
    ...(returnTo === undefined ? {} : { returnTo }),
  });
  const refresh = connection.refresh;
  const provisioning = Provision.useController({
    domain,
    readOnly: surfaceReadOnly,
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
  const receiptId = connection.snapshot?.lastReceiptId ?? null;
  const cleanup = Cleanup.useController({
    domain,
    readOnly: surfaceReadOnly,
    ...(onCleaned === undefined ? {} : { onCleaned }),
    ...(receiptId === null ? {} : { receiptId: Receipt.ReceiptId.make(receiptId) }),
  });

  // The plan is what the table is: an attached domain with nothing applied to it yet has records
  // that are still a proposal, and the rows say so. The signature is what makes that one call per
  // reason to make it — the domain, the connection that landed, the receipt that is or is not
  // there, and what the host asked for — rather than one per render.
  const attached = connection.snapshot?.attachment != null;
  const signature =
    surfaceReadOnly || !capabilities.includes("provisioning") || !attached || receiptId !== null
      ? null
      : [domain, connection.established, requirementsKey(requirements)].join("|");
  const planned = useRef<string | null>(null);
  const buildPlan = provisioning.plan;
  useEffect(() => {
    // A flow that cannot plan forgets what it planned, so pointing it back at a domain it once
    // planned for builds a plan again rather than leaving that domain with none.
    if (signature === null) {
      planned.current = null;
      return;
    }
    if (planned.current === signature) return;
    planned.current = signature;
    buildPlan();
  }, [buildPlan, signature]);

  // The same predicates the surface renders on, so the state a host reads and the surface a
  // customer sees never disagree, including while a disconnect is in flight.
  const connected = Connect.holdsConnection(connection);
  const offering = Connect.offering(connection, connect);
  const provider = connection.snapshot?.provider ?? Connect.hostProvider(connection)?.id ?? null;
  return {
    capabilities,
    cleanup,
    connection,
    domain,
    invitation: connect,
    plan: Provision.pendingPlan(provisioning.state),
    provisioning,
    readiness: verification.readiness,
    requirements,
    state: flowState({
      connected,
      label: connection.snapshot?.attachment?.label ?? null,
      offering,
      planning: provisioning.state._tag,
      provider,
      readOnly: surfaceReadOnly,
      receipt: receiptId,
      status: connection.state._tag,
    }),
    verification,
  };
}
