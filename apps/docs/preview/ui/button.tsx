import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

type Variant = "default" | "destructive" | "ghost" | "link" | "outline" | "secondary";
type Size = "default" | "icon" | "icon-sm" | "icon-xs" | "sm";

const variants: Record<Variant, string> = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  destructive: "bg-destructive text-white hover:bg-destructive/90",
  ghost: "hover:bg-accent hover:text-accent-foreground",
  link: "text-primary underline-offset-4 hover:underline",
  outline: "border border-border bg-background hover:bg-accent hover:text-accent-foreground",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
};

const sizes: Record<Size, string> = {
  default: "h-9 px-4 py-2 has-[>svg]:px-3",
  icon: "size-9",
  "icon-sm": "size-8 [&_svg:not([class*='size-'])]:size-3.5",
  "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
  sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
};

export function Button({
  className,
  size = "default",
  variant = "default",
  ...props
}: ComponentProps<"button"> & { readonly size?: Size; readonly variant?: Variant }) {
  return (
    <button
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        variants[variant],
        sizes[size],
        className,
      )}
      data-slot="button"
      {...props}
    />
  );
}
