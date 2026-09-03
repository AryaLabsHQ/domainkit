import type { ComponentProps, ReactNode } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface DnsTableRecord {
  readonly id: string;
  readonly name: string;
  readonly priority?: number;
  /** What the record is for, shown to the customer under its name. */
  readonly purpose?: ReactNode;
  /** Readiness for this record, once something has observed it. */
  readonly status?: ReactNode;
  readonly type: string;
  readonly value: string;
}

export interface DnsTableProps extends ComponentProps<"div"> {
  readonly records: ReadonlyArray<DnsTableRecord>;
}

export function DnsTable({ className, records, ...props }: DnsTableProps) {
  const hasStatus = records.some((record) => record.status !== undefined);
  return (
    <div
      className={cn("overflow-hidden rounded-xl border border-border bg-card shadow-sm", className)}
      data-slot="dns-table-panel"
      {...props}
    >
      <Table data-slot="dns-table">
        <TableHeader className="bg-muted/40 text-muted-foreground">
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-4 text-xs">Type</TableHead>
            <TableHead className="px-4 text-xs">Name</TableHead>
            <TableHead className="px-4 text-xs">Value</TableHead>
            {hasStatus ? <TableHead className="px-4 text-xs">Status</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => (
            <DnsTableRow key={record.id} record={record} showStatus={hasStatus} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export interface DnsTableRowProps extends ComponentProps<"tr"> {
  readonly record: DnsTableRecord;
  readonly showStatus?: boolean;
}

export function DnsTableRow({ className, record, showStatus = false, ...props }: DnsTableRowProps) {
  return (
    <TableRow className={cn("hover:bg-muted/30", className)} data-slot="dns-table-row" {...props}>
      <TableCell className="px-4 font-medium">{record.type}</TableCell>
      <TableCell className="px-4 font-mono text-xs">
        <span className="block">{record.name}</span>
        {record.purpose === undefined ? null : (
          <span className="mt-0.5 block font-sans text-muted-foreground">{record.purpose}</span>
        )}
      </TableCell>
      <TableCell className="max-w-80 px-4 font-mono text-xs">
        <span className="block truncate" title={record.value}>
          {record.value}
        </span>
        {record.priority === undefined ? null : (
          <span className="mt-0.5 block text-muted-foreground">Priority {record.priority}</span>
        )}
      </TableCell>
      {showStatus ? <TableCell className="px-4">{record.status}</TableCell> : null}
    </TableRow>
  );
}
