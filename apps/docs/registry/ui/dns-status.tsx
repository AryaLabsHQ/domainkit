import type { ReactNode } from "react";

export type DnsStatusTone = "danger" | "neutral" | "success" | "warning";

const tones: Record<DnsStatusTone, string> = {
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  neutral: "border-border bg-muted text-muted-foreground",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

export function DnsStatus({
  children,
  tone = "neutral",
}: {
  readonly children: ReactNode;
  readonly tone?: DnsStatusTone;
}) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}
      data-slot="dns-status"
      data-tone={tone}
    >
      {children}
    </span>
  );
}
