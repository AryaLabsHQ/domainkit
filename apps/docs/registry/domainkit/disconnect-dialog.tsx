"use client";

import { Cleanup, Connect, DomainKit, type Domain } from "@domainkit/react";
import { useEffect, useState, type ReactElement } from "react";

import { Outcome } from "@/components/domainkit/outcome";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export interface DisconnectDialogProps {
  readonly flow: Domain.Flow;
  /** Replaces the trigger element. Ignored when the host drives `open` itself. */
  readonly trigger?: ReactElement;
  /** Drive the dialog from your own state, from a menu item that closes as the dialog opens. */
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

/**
 * Letting a provider go, with the records DomainKit added as one decision rather than two.
 * Confirming removes what this domain's apply receipt proves DomainKit created, then releases the
 * connection; a plan with nothing in it goes straight to the release. The plan is built when the
 * dialog opens, so what would be removed is on screen while the customer decides.
 */
export function DisconnectDialog({
  flow,
  onOpenChange,
  open: controlled,
  trigger,
}: DisconnectDialogProps) {
  const messages = DomainKit.useMessages();
  const connection = flow.connection;
  const cleanup = flow.cleanup;
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlled ?? uncontrolled;
  const setOpen = onOpenChange ?? setUncontrolled;
  const [alsoRemove, setAlsoRemove] = useState(true);
  const [everyDomain, setEveryDomain] = useState(false);
  // The first of the two commands the confirm runs. The second is the controller's own.
  const [removing, setRemoving] = useState(false);

  const snapshot = connection.snapshot;
  // Only an apply receipt proves DomainKit created anything, so only then is there a choice.
  const removable = flow.capabilities.includes("cleanup") && flow.state.receiptId !== null;
  // Releasing a connection takes every domain on it, so a shared one asks which the customer meant.
  const shared = (snapshot?.connectionDomains ?? 0) > 1;
  const removals = Cleanup.planOf(cleanup.state);
  const count = removals?.operations.length ?? 0;
  const choosable = removable && count > 0;
  // No plan, no promise: confirming while one is still being built would release the connection
  // and leave the records behind.
  const settling = removable && removals === null;
  const releasing = connection.state._tag === "Submitting";
  const busy = removing || releasing;

  const plan = cleanup.plan;
  const cleaning = cleanup.state;
  useEffect(() => {
    if (open && removable && cleaning._tag === "Idle") plan();
  }, [cleaning, open, plan, removable]);

  const detach = connection.detach;
  const release = connection.disconnect;
  useEffect(() => {
    if (!removing) return;
    if (cleaning._tag === "Applied") {
      setRemoving(false);
      if (shared && !everyDomain) detach();
      else release();
      return;
    }
    if (cleaning._tag === "Failure" || cleaning._tag === "Rejected") setRemoving(false);
  }, [cleaning, detach, everyDomain, release, removing, shared]);

  const provider = flow.state.provider;
  const named = provider === null ? "" : Connect.displayName(connection, provider);
  const heading = provider === null ? messages.disconnect : messages.disconnectTitle(named);

  return (
    <Dialog
      onOpenChange={(next: boolean) => {
        if (!next && busy) return;
        setOpen(next);
      }}
      open={open}
    >
      {controlled === undefined ? (
        <DialogTrigger render={trigger ?? <Button variant="outline" />}>
          {messages.disconnect}
        </DialogTrigger>
      ) : null}
      <DialogContent
        className={cn("gap-5", choosable ? "sm:max-w-xl" : undefined)}
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription>{messages.disconnectConsent(flow.domain, named)}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {shared ? (
            <fieldset className="grid gap-2" data-slot="disconnect-scope">
              <legend className="text-sm font-medium">{messages.disconnectScope}</legend>
              <Label className="font-normal">
                <input
                  checked={!everyDomain}
                  disabled={busy}
                  name="disconnect-scope"
                  onChange={() => setEveryDomain(false)}
                  type="radio"
                />
                {messages.disconnectThisDomain}
              </Label>
              <Label className="font-normal">
                <input
                  checked={everyDomain}
                  disabled={busy}
                  name="disconnect-scope"
                  onChange={() => setEveryDomain(true)}
                  type="radio"
                />
                {messages.disconnectEveryDomain(snapshot?.connectionDomains ?? 0)}
              </Label>
            </fieldset>
          ) : null}

          {choosable ? (
            <div className="grid gap-3" data-slot="disconnect-cleanup">
              <Label className="font-normal">
                <Switch
                  checked={alsoRemove}
                  disabled={busy}
                  onCheckedChange={(checked: boolean) => setAlsoRemove(checked)}
                />
                {messages.disconnectWithCleanup(count)}
              </Label>
              <ul className="grid gap-1 rounded-md border border-border p-3 text-xs">
                {removals?.operations.map((operation) => (
                  <li className="flex items-center gap-2" key={operation.id}>
                    <span className="font-mono">{operation.record._tag}</span>
                    <span className="truncate font-mono">{operation.record.name}</span>
                    <span className="ml-auto text-muted-foreground">
                      {messages.operation(operation)}
                    </span>
                  </li>
                ))}
              </ul>
              {alsoRemove ? null : (
                <p className="text-xs text-muted-foreground">
                  {messages.disconnectKeepsRecords(named)}
                </p>
              )}
            </div>
          ) : null}

          {releasing ? (
            <p className="text-sm text-muted-foreground" role="status">
              {messages.disconnecting}
            </p>
          ) : null}
          <Outcome
            context={{ domain: flow.domain, provider: named }}
            error={cleaning._tag === "Failure" ? cleaning.error : null}
            layout="inline"
            onRetry={cleanup.retry}
          />
          <Outcome
            context={{ domain: flow.domain, provider: named }}
            error={connection.state._tag === "Failure" ? connection.state.error : null}
            layout="inline"
            onRetry={connection.retry}
          />
        </div>

        <DialogFooter>
          {busy ? null : (
            <DialogClose render={<Button variant="outline" />}>{messages.cancel}</DialogClose>
          )}
          <Button
            disabled={busy || settling}
            onClick={() => {
              if (choosable && alsoRemove) {
                setRemoving(true);
                cleanup.approve();
                return;
              }
              if (shared && !everyDomain) detach();
              else release();
            }}
            type="button"
            variant="destructive"
          >
            {messages.disconnect}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
