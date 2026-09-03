import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type DnsStatusTone = "danger" | "neutral" | "success" | "warning";

/** How one DNS requirement stands after an observation. */
export type DnsRequirementStatus = "missing" | "mismatch" | "satisfied" | "unknown";

export const dnsStatusTones: Record<DnsRequirementStatus, DnsStatusTone> = {
  missing: "warning",
  mismatch: "danger",
  satisfied: "success",
  unknown: "neutral",
};

export const dnsStatusLabels: Record<DnsRequirementStatus, string> = {
  missing: "Missing",
  mismatch: "Mismatch",
  satisfied: "Satisfied",
  unknown: "Not checked",
};

const tones: Record<DnsStatusTone, string> = {
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  neutral: "border-border bg-muted text-muted-foreground",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

export interface DnsStatusProps extends Omit<ComponentProps<typeof Badge>, "variant"> {
  /** Picks the tone and the default label. */
  readonly status?: DnsRequirementStatus;
  /** Overrides the tone the status implies. */
  readonly tone?: DnsStatusTone;
}

export function DnsStatus({ children, className, status, tone, ...props }: DnsStatusProps) {
  const resolved = tone ?? (status === undefined ? "neutral" : dnsStatusTones[status]);
  return (
    <Badge
      className={cn("gap-1.5 px-2.5 py-1 shadow-xs", tones[resolved], className)}
      data-slot="dns-status"
      data-status={status}
      data-tone={resolved}
      variant="outline"
      {...props}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current opacity-70" />
      {children ?? (status === undefined ? null : dnsStatusLabels[status])}
    </Badge>
  );
}
