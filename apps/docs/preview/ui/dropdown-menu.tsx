import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function DropdownMenu(props: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

export function DropdownMenuTrigger(props: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

export function DropdownMenuContent({
  align = "end",
  className,
  sideOffset = 4,
  ...props
}: Omit<MenuPrimitive.Popup.Props, "className"> & {
  readonly align?: MenuPrimitive.Positioner.Props["align"];
  readonly className?: string;
  readonly sideOffset?: number;
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner align={align} sideOffset={sideOffset}>
        <MenuPrimitive.Popup
          className={cn(
            "z-50 min-w-[8rem] overflow-hidden rounded-md border border-border bg-card p-1 text-card-foreground shadow-md outline-none",
            className,
          )}
          data-slot="dropdown-menu-content"
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  variant = "default",
  ...props
}: Omit<MenuPrimitive.Item.Props, "className"> & {
  readonly className?: string;
  readonly variant?: "default" | "destructive";
}) {
  return (
    <MenuPrimitive.Item
      className={cn(
        "relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0",
        variant === "destructive" ? "text-destructive data-highlighted:text-destructive" : "",
        className,
      )}
      data-slot="dropdown-menu-item"
      data-variant={variant}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("px-2 py-1.5 text-sm font-medium", className)}
      data-slot="dropdown-menu-label"
      {...props}
    />
  );
}
