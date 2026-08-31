import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export interface ProviderMarkProps extends ComponentProps<"span"> {
  readonly label: string;
}

export function ProviderMark({ children, className, label, ...props }: ProviderMarkProps) {
  return (
    <span
      aria-label={label}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md [&_img]:size-full [&_img]:object-contain [&_svg]:size-full",
        className,
      )}
      data-slot="provider-mark"
      role="img"
      {...props}
    >
      {children}
    </span>
  );
}
