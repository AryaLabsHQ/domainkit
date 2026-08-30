import type { ReactNode } from "react";

export function DnsOperation({
  action,
  name,
  priority,
  reason,
  type,
  value,
}: {
  readonly action: ReactNode;
  readonly name: string;
  readonly priority?: number;
  readonly reason?: ReactNode;
  readonly type: string;
  readonly value: string;
}) {
  return (
    <div
      className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[auto_1fr]"
      data-slot="dns-operation"
    >
      <div className="flex items-center gap-2 self-start">
        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">{action}</span>
        <strong className="text-xs">{type}</strong>
      </div>
      <div className="min-w-0 space-y-1 font-mono text-xs">
        <div>{name}</div>
        <div className="break-all text-muted-foreground">{value}</div>
        {priority === undefined ? null : <div>Priority {priority}</div>}
        {reason === undefined ? null : <div className="font-sans text-destructive">{reason}</div>}
      </div>
    </div>
  );
}
