import { useEffect, useRef, useState, type ReactNode } from "react";

export function CopyValue({
  copiedIcon,
  copyIcon,
  value,
}: {
  readonly copiedIcon?: ReactNode;
  readonly copyIcon?: ReactNode;
  readonly value: string;
}) {
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
      className="inline-flex min-w-0 items-center gap-1"
      data-copied={copied || undefined}
      data-slot="copy-value"
    >
      <code className="truncate text-xs">{value}</code>
      <button
        aria-label={`${copied ? "Copied" : "Copy"} ${value}`}
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={copy}
        type="button"
      >
        {copied ? (copiedIcon ?? "✓") : (copyIcon ?? "⧉")}
      </button>
    </span>
  );
}
