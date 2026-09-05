"use client";

import { Connect, DomainKit, type Domain } from "@domainkit/react";
import { MoreHorizontalIcon } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";

import { ConnectDialog } from "@/components/domainkit/connect-dialog";
import { DisconnectDialog } from "@/components/domainkit/disconnect-dialog";
import { PlanAction } from "@/components/domainkit/plan-action";
import { Mark, type ProviderArtwork } from "@/components/domainkit/provider-artwork";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface ProviderRowProps extends Omit<ComponentProps<"div">, "children"> {
  readonly flow: Domain.Flow;
  readonly marks?: ProviderArtwork;
  /** Replaces the one action on the right, for a host that owns that decision itself. */
  readonly action?: ReactNode;
}

/**
 * The line that heads the records card: who serves the zone, which account the records go to, and
 * the one thing to do about it. Disconnecting is behind the row's menu, because it is the rare
 * action and the common one must not sit beside it.
 */
export function ProviderRow({ action, className, flow, marks, ...props }: ProviderRowProps) {
  const messages = DomainKit.useMessages();
  // The dialog is a sibling of the menu rather than a child of one of its items: closing the menu
  // unmounts what is inside it, and the dialog has to outlive the press that opened it.
  const [disconnecting, setDisconnecting] = useState(false);
  const connection = flow.connection;
  const state = flow.state;
  const attached = Connect.providerOf(connection, state.provider);
  const host = Connect.hostProvider(connection);
  const provider = attached ?? host;
  const connected = state.connected;
  const label = state.label;

  const line = (): string => {
    if (provider === null) return messages.notConnected;
    if (connected) {
      return label === null ? provider.name : messages.connectedAccount(provider.name, label);
    }
    if (state.readOnly) return messages.administratorConnects(provider.name);
    return messages.hostDetected(provider.name);
  };

  // Read-only offers no trigger, so the line above is the whole of what the row has to say.
  const offer =
    action ??
    (connected ? (
      <PlanAction flow={flow} />
    ) : state.readOnly || !state.offering ? null : (
      <ConnectDialog flow={flow} marks={marks} />
    ));

  if (provider === null && !state.offering) return null;
  return (
    <div
      className={cn("flex items-center gap-3 px-4 py-3", className)}
      data-slot="provider-row"
      data-state={connected ? "connected" : "disconnected"}
      {...props}
    >
      {provider === null ? null : <Mark marks={marks} provider={provider} />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{line()}</p>
        {Connect.reconnect(connection) ? (
          <p className="truncate text-xs text-muted-foreground">{messages.needsReconnect}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {offer}
        {connected && !state.readOnly ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button aria-label={messages.moreActions} size="icon-sm" variant="ghost" />}
            >
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => setDisconnecting(true)} variant="destructive">
                {messages.disconnect}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {connected && !state.readOnly ? (
          <DisconnectDialog flow={flow} onOpenChange={setDisconnecting} open={disconnecting} />
        ) : null}
      </div>
    </div>
  );
}
