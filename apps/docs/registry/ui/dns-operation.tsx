import type { ComponentProps, ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface DnsOperationProps extends ComponentProps<typeof Card> {
  readonly action: ReactNode;
  readonly name: string;
  readonly priority?: number;
  readonly reason?: ReactNode;
  readonly type: string;
  readonly value: string;
}

export function DnsOperation({
  action,
  className,
  name,
  priority,
  reason,
  type,
  value,
  ...props
}: DnsOperationProps) {
  return (
    <Card
      className={cn("gap-4 border-border py-4 transition-colors hover:bg-muted/20", className)}
      data-slot="dns-operation"
      {...props}
    >
      <CardContent className="grid gap-4 px-4 sm:grid-cols-[auto_1fr]">
        <div className="flex items-center gap-2 self-start">
          <Badge className="tracking-wide uppercase" variant="secondary">
            {action}
          </Badge>
          <Badge className="font-mono" variant="default">
            {type}
          </Badge>
        </div>
        <div className="min-w-0 space-y-1.5 font-mono text-xs">
          <div className="font-medium text-foreground">{name}</div>
          <div className="break-all text-muted-foreground">{value}</div>
          {priority === undefined ? null : (
            <div className="text-muted-foreground">Priority {priority}</div>
          )}
          {reason === undefined ? null : (
            <div className="rounded-md bg-destructive/10 px-2.5 py-2 font-sans text-destructive">
              {reason}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
