import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export interface ProviderMarkProps extends ComponentProps<"span"> {
  readonly label: string;
}

/**
 * The mark is 32px by default and clips whatever it holds. Its radius is a share of its size, so a
 * 16px mark in a row and a 32px mark on a card carry the same corner instead of the smaller one
 * rounding into a circle.
 */
export function ProviderMark({ children, className, label, ...props }: ProviderMarkProps) {
  return (
    <span
      {...props}
      aria-label={label}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[25%] [&_img]:size-full [&_img]:object-contain [&_svg]:size-full",
        className,
      )}
      data-slot="provider-mark"
      role="img"
    >
      {children}
    </span>
  );
}
