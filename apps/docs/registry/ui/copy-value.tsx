"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CopyValueProps extends ComponentProps<"span"> {
  readonly copiedIcon?: ReactNode;
  readonly copyIcon?: ReactNode;
  readonly value: string;
}

export function CopyValue({ className, copiedIcon, copyIcon, value, ...props }: CopyValueProps) {
  const [copied, setCopied] = useState(false);
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(reset.current), []);
  const copy = () => {
    if (navigator.clipboard === undefined) return;
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        clearTimeout(reset.current);
        reset.current = setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  };
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-muted/30 py-1 pr-1 pl-2.5 shadow-xs",
        className,
      )}
      data-copied={copied || undefined}
      data-slot="copy-value"
      {...props}
    >
      <code className="truncate text-xs text-foreground">{value}</code>
      <Button
        aria-label={`${copied ? "Copied" : "Copy"} ${value}`}
        onClick={copy}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        {copied ? (copiedIcon ?? <CheckIcon />) : (copyIcon ?? <CopyIcon />)}
      </Button>
    </span>
  );
}
