import type { ReactNode } from "react";

export interface DnsTableRecord {
  readonly id: string;
  readonly name: string;
  readonly priority?: number;
  readonly status?: ReactNode;
  readonly type: string;
  readonly value: string;
}

export function DnsTable({ records }: { readonly records: ReadonlyArray<DnsTableRecord> }) {
  const hasStatus = records.some((record) => record.status !== undefined);
  return (
    <div className="overflow-hidden rounded-lg border" data-slot="dns-table-panel">
      <table className="w-full text-sm" data-slot="dns-table">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Value</th>
            {hasStatus ? <th className="px-3 py-2 font-medium">Status</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y">
          {records.map((record) => (
            <DnsTableRow key={record.id} record={record} showStatus={hasStatus} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DnsTableRow({
  record,
  showStatus = false,
}: {
  readonly record: DnsTableRecord;
  readonly showStatus?: boolean;
}) {
  return (
    <tr data-slot="dns-table-row">
      <td className="px-3 py-3 font-medium">{record.type}</td>
      <td className="px-3 py-3 font-mono text-xs">{record.name}</td>
      <td className="max-w-80 truncate px-3 py-3 font-mono text-xs" title={record.value}>
        {record.value}
        {record.priority === undefined ? null : (
          <span className="ml-2 text-muted-foreground">Priority {record.priority}</span>
        )}
      </td>
      {showStatus ? <td className="px-3 py-3">{record.status}</td> : null}
    </tr>
  );
}
