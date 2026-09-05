import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

type Variant = "default" | "destructive" | "outline" | "secondary";

const variants: Record<Variant, string> = {
  default: "border-transparent bg-primary text-primary-foreground",
  destructive: "border-transparent bg-destructive text-white",
  outline: "border-border text-foreground",
  secondary: "border-transparent bg-secondary text-secondary-foreground",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: ComponentProps<"span"> & { readonly variant?: Variant }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        variants[variant],
        className,
      )}
      data-slot="badge"
      {...props}
    />
  );
}
