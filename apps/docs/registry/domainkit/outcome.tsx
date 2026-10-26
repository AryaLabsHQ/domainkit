"use client";

import { Connect, Outcome as DomainKitOutcome, DomainKit, type Messages } from "@domainkit/react";
import type { DomainKit as Kit } from "domainkit";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface OutcomeProps extends Omit<ComponentProps<"div">, "children"> {
  /** The failure to report, or `null` when the step it belongs to has not failed. */
  readonly error: Kit.Error | null;
  /** What the customer was doing, so the words can name the provider they acted on. */
  readonly context?: Messages.OutcomeContext;
  /** The retry the surface allows, or `null` where it allows none. */
  readonly onRetry?: (() => void) | null;
  /** `inline` sits under a field; `card` is the panel a step shows on its own. */
  readonly layout?: "card" | "inline";
}

/**
 * A failed step, in the catalog's words. The title and the description come from the error's
 * reason, so nothing renders a tag, a status literal, or a reason name.
 */
export function Outcome({
  className,
  context,
  error,
  layout = "card",
  onRetry,
  ...props
}: OutcomeProps) {
  const describe = DomainKitOutcome.useDescribe();
  const messages = DomainKit.useMessages();
  if (error === null) return null;
  const words = describe(error, context);
  return (
    <div
      className={cn(
        "flex gap-3 text-sm text-destructive",
        layout === "card"
          ? "rounded-md border border-destructive/30 bg-destructive/5 p-3"
          : "items-start",
        className,
      )}
      data-layout={layout}
      data-slot="outcome"
      role="alert"
      {...props}
    >
      <HugeiconsIcon aria-hidden="true" icon={Alert02Icon} className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">{words.title}</p>
        {words.description === undefined ? null : (
          <p className="text-muted-foreground">{words.description}</p>
        )}
        {onRetry == null ? null : (
          <Button className="px-0" onClick={onRetry} size="sm" type="button" variant="link">
            {messages.retry}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Callback recovery stays separate from a failed command: inspection never repeats a grant. */
export function CallbackRecoveryAlert({
  disabled = false,
  onRetry,
  onReconnect,
  providers,
}: {
  readonly disabled?: boolean;
  readonly onRetry: (input: Connect.ConnectInput) => void;
  readonly onReconnect: (input: Connect.ReconnectInput) => void;
  readonly providers: ReadonlyArray<Connect.Descriptor>;
}) {
  const recovery = Connect.useRecovery();
  const messages = DomainKit.useMessages();
  const readOnly = DomainKit.useReadOnly();
  const capabilities = DomainKit.useCapabilities();
  const outcome = recovery.outcome;
  if (outcome === null) return null;
  const provider = providers.find((entry) => entry.id === outcome.provider);
  const name = provider?.name ?? outcome.provider;
  const words =
    outcome.kind === "cancelled"
      ? messages.recoveryCancelled(name)
      : outcome.kind === "restart"
        ? messages.recoveryRestart(name)
        : messages.recoveryInspect(name);
  const method =
    provider === undefined ? undefined : Connect.describeMethods(provider).interactive[0];
  const retry =
    outcome.kind !== "inspect" &&
    method !== undefined &&
    !readOnly &&
    capabilities.includes("connection");

  return (
    <div
      className="flex gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
      data-slot="callback-recovery"
      role="alert"
    >
      <HugeiconsIcon aria-hidden="true" icon={Alert02Icon} className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">{words.title}</p>
        <p className="text-muted-foreground">{words.description}</p>
        <div className="flex flex-wrap gap-x-3">
          {retry ? (
            <Button
              className="px-0"
              disabled={disabled}
              onClick={() => {
                if (disabled || method === undefined) return;
                // The connect controller reads the current URL as its default return destination.
                recovery.dismiss();
                const input = { method: method.kind, provider: outcome.provider };
                if (outcome.connectionId === undefined) onRetry(input);
                else onReconnect({ ...input, connectionId: outcome.connectionId });
              }}
              size="sm"
              type="button"
              variant="link"
            >
              {messages.retry}
            </Button>
          ) : null}
          <Button
            className="px-0"
            onClick={recovery.dismiss}
            size="sm"
            type="button"
            variant="link"
          >
            {messages.dismissRecovery}
          </Button>
        </div>
      </div>
    </div>
  );
}
