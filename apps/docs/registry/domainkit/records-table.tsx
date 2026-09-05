"use client";

import { DomainKit, Records, type Domain } from "@domainkit/react";
import { DnsRecord, type Plan } from "domainkit";
import { Fragment, type ComponentProps, type ReactNode } from "react";

import { CopyValue } from "@/components/ui/copy-value";
import { DnsStatus, type DnsStatusTone } from "@/components/ui/dns-status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const operationTones: Record<Plan.Operation["_tag"], DnsStatusTone> = {
  Conflict: "danger",
  Create: "warning",
  Delete: "warning",
  Noop: "success",
};

/** What a pending plan will do to one record, or what the last observation read back. */
function Standing({ standing }: { readonly standing: Records.Standing | null }) {
  const messages = DomainKit.useMessages();
  if (standing === null) return null;
  return standing._tag === "Operation" ? (
    <DnsStatus tone={operationTones[standing.operation._tag]}>
      {messages.planStatus(standing.operation)}
    </DnsStatus>
  ) : (
    // `dns-status` already picks the tone from the status; the words come from the catalog.
    <DnsStatus status={standing.status}>{messages.requirementStatus(standing.status)}</DnsStatus>
  );
}

export interface RecordsTableProps extends Omit<ComponentProps<"div">, "children"> {
  readonly flow: Domain.Flow;
  /** The line above the table, which is where the provider row goes. */
  readonly header?: ReactNode;
}

/**
 * What the customer has to add, and where each record stands. While a plan is pending the status
 * column is what the plan will do; once an apply has landed it is what the observers read back.
 * A blocked record says what is in the way and what to do about it, on its own row under the one
 * it explains.
 */
export function RecordsTable({ className, flow, header, ...props }: RecordsTableProps) {
  const messages = DomainKit.useMessages();
  const requirements = flow.requirements;
  return (
    <div
      className={cn("overflow-hidden rounded-xl border border-border bg-card", className)}
      data-slot="records-table"
      {...props}
    >
      {header === undefined ? null : <div className="border-b border-border">{header}</div>}
      <Table>
        <caption className="sr-only">{messages.recordsCaption(flow.domain)}</caption>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">{messages.headingType}</TableHead>
            <TableHead className="w-36">{messages.headingStatus}</TableHead>
            <TableHead>{messages.headingName}</TableHead>
            <TableHead className="w-full max-w-0">{messages.headingValue}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requirements.map((record) => {
            const standing = Records.statusOf(record, {
              plan: flow.plan,
              readiness: flow.readiness,
            });
            const conflict =
              standing?._tag === "Operation" && standing.operation._tag === "Conflict"
                ? standing.operation
                : null;
            return (
              <Fragment key={Records.identity(record)}>
                <TableRow className={conflict === null ? undefined : "border-b-0"}>
                  <TableCell className="font-mono text-xs">{record._tag}</TableCell>
                  <TableCell>
                    <Standing standing={standing} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{record.name}</TableCell>
                  <TableCell className="w-full max-w-0">
                    <CopyValue className="max-w-full" value={DnsRecord.data(record)} />
                    {record._tag === "MX" ? (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {messages.priority(record.priority)}
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
                {conflict === null ? null : (
                  <TableRow data-slot="records-conflict">
                    <TableCell className="pt-0 text-xs text-muted-foreground" colSpan={4}>
                      {messages.conflictReason(conflict.reason)}{" "}
                      {messages.conflictAdvice(conflict.reason)}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
