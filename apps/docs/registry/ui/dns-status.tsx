import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type DnsStatusTone = "danger" | "neutral" | "success" | "warning";

const tones: Record<DnsStatusTone, string> = {
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  neutral: "border-border bg-muted text-muted-foreground",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

export interface DnsStatusProps extends Omit<ComponentProps<typeof Badge>, "variant"> {
  readonly tone?: DnsStatusTone;
}

export function DnsStatus({ children, className, tone = "neutral", ...props }: DnsStatusProps) {
  return (
    <Badge
      className={cn("gap-1.5 px-2.5 py-1 shadow-xs", tones[tone], className)}
      data-slot="dns-status"
      data-tone={tone}
      variant="outline"
      {...props}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current opacity-70" />
      {children}
    </Badge>
  );
}
