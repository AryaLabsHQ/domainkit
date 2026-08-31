import { CircleAlertIcon, InboxIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export interface AsyncStateProps extends ComponentProps<typeof Empty> {
  readonly children?: ReactNode;
}

interface ShellProps extends AsyncStateProps {
  readonly state: "empty" | "error" | "loading";
}

function Shell({ children, className, state, ...props }: ShellProps) {
  const error = state === "error";
  return (
    <Empty
      className={cn(
        "min-h-40 border border-border bg-card p-6 shadow-sm",
        error && "border-destructive/30",
        className,
      )}
      data-slot="async-state"
      data-state={state}
      {...props}
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {state === "loading" ? (
            <Spinner />
          ) : error ? (
            <CircleAlertIcon className="text-destructive" />
          ) : (
            <InboxIcon />
          )}
        </EmptyMedia>
        <EmptyDescription className={cn(error && "text-destructive")}>{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function LoadingState({ children = "Loading…", ...props }: AsyncStateProps) {
  return (
    <Shell state="loading" {...props}>
      {children}
    </Shell>
  );
}

export function EmptyState({ children = "Nothing here yet.", ...props }: AsyncStateProps) {
  return (
    <Shell state="empty" {...props}>
      {children}
    </Shell>
  );
}

export function ErrorState({ children = "Something went wrong.", ...props }: AsyncStateProps) {
  return (
    <Shell state="error" {...props}>
      {children}
    </Shell>
  );
}
