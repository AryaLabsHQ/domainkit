"use client";

import { Connect, Domain } from "@domainkit/react";
import type { DnsRecord, Receipt } from "domainkit";
import type { ComponentProps } from "react";

import { Outcome } from "@/components/domainkit/outcome";
import { type ProviderArtwork } from "@/components/domainkit/provider-artwork";
import { ProviderRow } from "@/components/domainkit/provider-row";
import { RecordsTable } from "@/components/domainkit/records-table";
import { cn } from "@/lib/utils";

export interface DomainFlowProps extends Omit<ComponentProps<"div">, "children"> {
  readonly domain: string;
  readonly requirements: ReadonlyArray<DnsRecord.Model>;
  readonly marks?: ProviderArtwork;
  readonly onApplied?: (receipt: Receipt.Model) => void;
  readonly onCleaned?: (receipt: Receipt.Model) => void;
  /**
   * Offer the connect surface even when discovery names no host, or `never` for a domain your
   * application has already settled another way. Defaults to `detected`.
   */
  readonly connect?: Connect.Invitation;
  readonly returnTo?: string | null;
  readonly readOnly?: boolean;
}

/**
 * The whole of one domain's setup: who serves the zone, the records to add, and where each one
 * stands. The provider row heads the card and carries the single action; adding the records is one
 * press, and disconnecting is behind the row's menu. Nothing collapses once the domain is ready,
 * because the records are what a customer comes back to check.
 */
export function DomainFlow({
  className,
  connect,
  domain,
  marks,
  onApplied,
  onCleaned,
  readOnly,
  requirements,
  returnTo,
  ...props
}: DomainFlowProps) {
  const flow = Domain.useFlow({
    domain,
    requirements,
    ...(connect === undefined ? {} : { connect }),
    ...(onApplied === undefined ? {} : { onApplied }),
    ...(onCleaned === undefined ? {} : { onCleaned }),
    ...(readOnly === undefined ? {} : { readOnly }),
    ...(returnTo === undefined ? {} : { returnTo }),
  });
  const connection = flow.connection;
  // A failure a method already answers inside the connect dialog is not repeated out here.
  const failure =
    connection.state._tag === "Failure" && !Connect.answeredInPlace(connection)
      ? connection.state.error
      : null;
  const provider = flow.state.provider;

  return (
    <div className={cn("grid gap-3", className)} data-slot="domain-flow" {...props}>
      <RecordsTable
        flow={flow}
        header={
          flow.capabilities.includes("connection") ? (
            <ProviderRow flow={flow} marks={marks} />
          ) : undefined
        }
      />
      <Outcome
        context={{
          domain,
          ...(provider === null ? {} : { provider: Connect.displayName(connection, provider) }),
        }}
        error={failure}
        onRetry={flow.state.readOnly ? null : connection.retry}
      />
    </div>
  );
}
