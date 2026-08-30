import type { ReactNode } from "react";

function Shell({
  children,
  tone,
}: {
  readonly children: ReactNode;
  readonly tone: "danger" | "neutral";
}) {
  return (
    <div
      className={`rounded-lg border p-6 text-center text-sm ${tone === "danger" ? "border-destructive/30 text-destructive" : "text-muted-foreground"}`}
      data-slot="async-state"
      data-tone={tone}
    >
      {children}
    </div>
  );
}

export const LoadingState = ({ children = "Loading…" }: { readonly children?: ReactNode }) => (
  <Shell tone="neutral">{children}</Shell>
);
export const EmptyState = ({
  children = "Nothing here yet.",
}: {
  readonly children?: ReactNode;
}) => <Shell tone="neutral">{children}</Shell>;
export const ErrorState = ({
  children = "Something went wrong.",
}: {
  readonly children?: ReactNode;
}) => <Shell tone="danger">{children}</Shell>;
