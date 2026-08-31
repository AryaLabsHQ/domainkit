import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Button({
  className,
  size = "default",
  variant = "default",
  ...props
}: ComponentProps<"button"> & {
  readonly size?: "default" | "icon-xs";
  readonly variant?: "default" | "ghost";
}) {
  return (
    <button
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        variant === "default"
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "hover:bg-accent hover:text-accent-foreground",
        size === "icon-xs" ? "size-6 [&_svg]:size-3" : "h-9 px-4 py-2",
        className,
      )}
      data-slot="button"
      {...props}
    />
  );
}
