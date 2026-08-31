import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Empty({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-6 rounded-lg border-dashed p-6 text-center text-balance",
        className,
      )}
      data-slot="empty"
      {...props}
    />
  );
}

export function EmptyHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex max-w-sm flex-col items-center gap-2 text-center", className)}
      data-slot="empty-header"
      {...props}
    />
  );
}

export function EmptyMedia({
  className,
  variant = "default",
  ...props
}: ComponentProps<"div"> & { readonly variant?: "default" | "icon" }) {
  return (
    <div
      className={cn(
        "mb-2 flex shrink-0 items-center justify-center [&_svg]:shrink-0",
        variant === "icon" &&
          "size-10 rounded-lg bg-muted text-foreground [&_svg:not([class*='size-'])]:size-6",
        className,
      )}
      data-slot="empty-icon"
      {...props}
    />
  );
}

export function EmptyDescription({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("text-sm/relaxed text-muted-foreground", className)}
      data-slot="empty-description"
      {...props}
    />
  );
}
