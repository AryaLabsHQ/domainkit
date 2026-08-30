import type { ReactNode } from "react";

export function ProviderMark({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}) {
  return (
    <span
      aria-label={label}
      className="inline-flex size-8 items-center justify-center rounded-md border bg-background"
      data-slot="provider-mark"
      role="img"
    >
      {children}
    </span>
  );
}
