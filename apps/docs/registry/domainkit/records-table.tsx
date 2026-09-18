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

/** What a pending plan will do to one record. */
function Planned({ operation }: { readonly operation: Plan.Operation | null }) {
  const messages = DomainKit.useMessages();
  if (operation === null) return null;
  return (
    <DnsStatus tone={operationTones[operation._tag]}>{messages.planStatus(operation)}</DnsStatus>
  );
}

/** What the last observation read back for one record. */
function Observed({ status }: { readonly status: Records.RequirementStatus | null }) {
  const messages = DomainKit.useMessages();
  if (status === null) return null;
  // `dns-status` already picks the tone from the status; the words come from the catalog.
  return <DnsStatus status={status}>{messages.requirementStatus(status)}</DnsStatus>;
}

export interface RecordsTableProps extends Omit<ComponentProps<"div">, "children"> {
  readonly flow: Domain.Flow;
  /** The line above the table, which is where the provider row goes. */
  readonly header?: ReactNode;
}

/**
 * What the customer has to add, and where each record stands. A plan still awaiting its apply gets
 * a column of its own saying what it will do, beside the status column, which is always what the
 * observers read back. A blocked record says what is in the way and what to do about it, on its own
 * row under the one it explains.
 */
export function RecordsTable({ className, flow, header, ...props }: RecordsTableProps) {
  const messages = DomainKit.useMessages();
  const requirements = flow.requirements;
  // The plan column exists only while a plan is pending, so a settled table is the observation
  // alone rather than a column of blanks.
  const plan = flow.plan;
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
            {plan === null ? null : <TableHead className="w-32">{messages.headingPlan}</TableHead>}
            <TableHead className="w-36">{messages.headingStatus}</TableHead>
            <TableHead>{messages.headingName}</TableHead>
            <TableHead className="w-full max-w-0">{messages.headingValue}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requirements.map((record) => {
            const standing = Records.standingOf(record, { plan, readiness: flow.readiness });
            const conflict = standing.planned?._tag === "Conflict" ? standing.planned : null;
            return (
              <Fragment key={Records.identity(record)}>
                <TableRow className={conflict === null ? undefined : "border-b-0"}>
                  <TableCell className="font-mono text-xs">{record._tag}</TableCell>
                  {plan === null ? null : (
                    <TableCell>
                      <Planned operation={standing.planned} />
                    </TableCell>
                  )}
                  <TableCell>
                    <Observed status={standing.observed?.status ?? null} />
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
                    <TableCell
                      className="pt-0 text-xs text-muted-foreground"
                      colSpan={plan === null ? 4 : 5}
                    >
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
