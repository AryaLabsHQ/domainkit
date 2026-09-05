"use client";

import { Connect, DomainKit } from "@domainkit/react";
import { useState, type ComponentProps } from "react";

import { Mark, type ProviderArtwork } from "@/components/domainkit/provider-artwork";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface DomainFieldProps extends Omit<ComponentProps<"div">, "children" | "onChange"> {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Fires when the value or the account it resolves to changes, for a form that holds both. */
  readonly onResolve?: Connect.DomainFieldOptions["onResolve"];
  readonly marks?: ProviderArtwork;
  readonly id?: string;
  readonly placeholder?: string;
}

/**
 * One input over every zone the workspace's accounts reach. Typing filters them, the arrow keys
 * move the highlight, Tab or Enter finishes the name while keeping whatever subdomain was typed in
 * front of the zone, and the line underneath says which account the records will go to. A domain
 * outside every zone leaves the input a plain text field: the customer adds the records by hand.
 */
export function DomainField({
  className,
  id,
  marks,
  onChange,
  onResolve,
  placeholder,
  value,
  ...props
}: DomainFieldProps) {
  const messages = DomainKit.useMessages();
  const readOnly = DomainKit.useReadOnly();
  const accounts = Connect.useAccounts();
  const field = Connect.useDomainField({
    onChange,
    value,
    zones: accounts.zones,
    ...(id === undefined ? {} : { id }),
    ...(onResolve === undefined ? {} : { onResolve }),
  });
  const [openId, setOpenId] = useState<string | null>(null);

  const busy = accounts.state._tag === "Submitting" || accounts.state._tag === "Redirecting";
  const stale = accounts.connections.filter((entry) => entry.status === "reconnect");
  const named = (provider: string) =>
    accounts.providers.find((entry) => entry.id === provider)?.name ?? provider;

  return (
    <div className={cn("grid gap-2", className)} data-slot="domain-field" {...props}>
      <div className="relative">
        <Input {...field.inputProps} placeholder={placeholder} />
        <ul
          {...field.listboxProps}
          className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-card p-1 shadow-md"
        >
          {field.suggestions.map((zone) => (
            <li
              {...field.optionProps(zone)}
              className="flex cursor-pointer items-baseline justify-between gap-3 rounded-sm px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
              key={`${zone.connectionId}:${zone.zone}`}
            >
              <span className="font-mono text-xs">{zone.zone}</span>
              <span className="truncate text-xs text-muted-foreground">{zone.label}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-muted-foreground" data-slot="domain-field-account">
        {field.found !== null
          ? messages.recordsGoTo(named(field.found.zone.provider), field.found.zone.label)
          : value.trim() === ""
            ? null
            : messages.notInConnectedAccount}
      </p>

      {readOnly || accounts.connections.length > 0
        ? null
        : accounts.providers.map((provider) => {
            const methods = Connect.describeMethods(provider);
            const interactive = methods.interactive[0];
            const typed = methods.typed[0];
            if (interactive === undefined && typed === undefined) return null;
            if (interactive !== undefined) {
              return (
                <Button
                  disabled={busy}
                  key={provider.id}
                  onClick={() =>
                    accounts.connect({ method: interactive.kind, provider: provider.id })
                  }
                  type="button"
                  variant="outline"
                >
                  <Mark className="size-4" marks={marks} provider={provider} />
                  {messages.connectTitle(provider.name)}
                </Button>
              );
            }
            // A token method asks for the values it declares first: there is nowhere else here to
            // type them, so the button opens the fields in place.
            return (
              <TokenOffer
                busy={busy}
                connect={(values) =>
                  accounts.connect({ method: "token", provider: provider.id, values })
                }
                key={provider.id}
                marks={marks}
                onOpenChange={(next) => setOpenId(next ? provider.id : null)}
                open={openId === provider.id}
                provider={provider}
              />
            );
          })}

      {readOnly
        ? null
        : stale.map((entry) => {
            const provider = accounts.providers.find((held) => held.id === entry.provider);
            if (provider === undefined) return null;
            const method = Connect.describeMethods(provider).interactive[0];
            if (method === undefined) return null;
            return (
              // Proving the account again re-credits the connection the workspace already holds,
              // so the domains on it stay where they are.
              <Button
                disabled={busy}
                key={entry.connectionId}
                onClick={() =>
                  accounts.reconnect({
                    connectionId: entry.connectionId,
                    method: method.kind,
                    provider: provider.id,
                  })
                }
                type="button"
                variant="outline"
              >
                <Mark className="size-4" marks={marks} provider={provider} />
                {messages.reconnectAccount(named(entry.provider))}
              </Button>
            );
          })}
    </div>
  );
}

function TokenOffer({
  busy,
  connect,
  marks,
  onOpenChange,
  open,
  provider,
}: {
  readonly busy: boolean;
  readonly connect: (values: Readonly<Record<string, string>>) => void;
  readonly marks?: ProviderArtwork;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly provider: Connect.Descriptor;
}) {
  const messages = DomainKit.useMessages();
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});
  const fields = Connect.describeMethods(provider).typed[0]?.fields;
  if (fields === undefined || fields === null) return null;
  if (!open) {
    return (
      <Button disabled={busy} onClick={() => onOpenChange(true)} type="button" variant="outline">
        <Mark className="size-4" marks={marks} provider={provider} />
        {messages.connectTitle(provider.name)}
      </Button>
    );
  }
  return (
    <form
      className="grid gap-2 rounded-md border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onOpenChange(false);
        connect(values);
      }}
    >
      {[...fields.required, ...fields.optional].map((field) => (
        <Input
          autoComplete="off"
          key={field.name}
          name={field.name}
          onChange={(event) => setValues((held) => ({ ...held, [field.name]: event.target.value }))}
          placeholder={messages.fieldLabel(field.name)}
          required={field.required}
          type={field.secret ? "password" : "text"}
          value={values[field.name] ?? ""}
        />
      ))}
      <Button disabled={busy} type="submit">
        {messages.methodToken}
      </Button>
    </form>
  );
}
