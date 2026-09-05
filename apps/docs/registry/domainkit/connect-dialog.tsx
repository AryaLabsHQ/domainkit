"use client";

import { Connect, DomainKit, type Domain } from "@domainkit/react";
import { ChevronDownIcon, ExternalLinkIcon } from "lucide-react";
import { useId, useState, type ReactElement } from "react";

import { Outcome } from "@/components/domainkit/outcome";
import { Mark, type ProviderArtwork } from "@/components/domainkit/provider-artwork";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** What the customer typed, for the one domain and provider they typed it into. */
interface Typed {
  readonly domain: string;
  readonly provider: string;
  readonly values: Readonly<Record<string, string>>;
}

function TokenForm({
  flow,
  method,
  provider,
}: {
  readonly flow: Domain.Flow;
  readonly method: Connect.DescribedMethod;
  readonly provider: Connect.Descriptor;
}) {
  const messages = DomainKit.useMessages();
  const controller = flow.connection;
  const prefix = useId();
  const [more, setMore] = useState(false);
  // A rejection keeps what was typed, so trying again starts from the value rather than nothing.
  const [typed, setTyped] = useState<Typed | null>(null);
  const kept =
    typed !== null && typed.domain === flow.domain && typed.provider === provider.id ? typed : null;
  const values = kept?.values ?? {};
  const fields = method.fields;
  if (fields === null) return null;

  const error = Connect.attempted(controller, provider.id, method.kind);
  const answered = Connect.rejectedField(error, [...fields.required, ...fields.optional]);
  // A rejection about a hidden field opens the panel, so the answer is never behind a control.
  const showMore = more || fields.optional.some((field) => field.name === answered);
  const busy = controller.state._tag === "Submitting";

  const enter = (name: string, value: string) =>
    setTyped((held) => ({
      domain: flow.domain,
      provider: provider.id,
      values:
        held?.domain === flow.domain && held.provider === provider.id
          ? { ...held.values, [name]: value }
          : { [name]: value },
    }));

  const render = (field: Connect.Field) => (
    <div className="grid gap-2" data-slot="connect-field" key={field.name}>
      <Label htmlFor={`${prefix}-${field.name}`}>
        {messages.fieldLabel(field.name)}
        {field.required ? null : (
          <span className="text-xs font-normal text-muted-foreground">
            {messages.optionalField}
          </span>
        )}
      </Label>
      <Input
        aria-invalid={field.name === answered ? true : undefined}
        autoComplete="off"
        id={`${prefix}-${field.name}`}
        name={field.name}
        onChange={(event) => enter(field.name, event.target.value)}
        required={field.required}
        type={field.secret ? "password" : "text"}
        value={values[field.name] ?? ""}
      />
      {field.name === fields.explains && method.descriptor.docsUrl !== null ? (
        <a
          className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
          href={method.descriptor.docsUrl}
          rel="noreferrer"
          target="_blank"
        >
          {messages.getToken}
          <ExternalLinkIcon aria-hidden="true" className="size-3" />
        </a>
      ) : null}
    </div>
  );

  return (
    <form
      className="grid gap-4"
      data-slot="token-form"
      onSubmit={(event) => {
        event.preventDefault();
        const submitted: Record<string, string> = {};
        for (const field of [...fields.required, ...fields.optional]) {
          const value = values[field.name] ?? "";
          if (value !== "" || field.required) submitted[field.name] = value;
        }
        controller.connect({ method: method.kind, provider: provider.id, values: submitted });
      }}
    >
      {fields.required.map(render)}
      {fields.optional.length === 0 ? null : showMore ? (
        fields.optional.map(render)
      ) : (
        <Button
          className="w-fit px-0"
          onClick={() => setMore(true)}
          size="sm"
          type="button"
          variant="link"
        >
          {messages.moreOptions}
        </Button>
      )}
      <Outcome
        context={{ domain: flow.domain, provider: provider.name }}
        error={error}
        layout="inline"
      />
      <Button disabled={busy} type="submit">
        {messages.methodToken}
      </Button>
    </form>
  );
}

export interface ConnectDialogProps {
  readonly flow: Domain.Flow;
  readonly marks?: ProviderArtwork;
  /** Replaces the trigger element. Omit it for the short "Connect" the row carries. */
  readonly trigger?: ReactElement;
}

/**
 * Authorizing DNS changes, one decision at a time. The dialog is narrowed to the provider whose
 * nameservers serve the zone; the header's menu moves it to another provider, an interactive
 * method is the offer where a provider has one, and the token form opens in its place.
 */
export function ConnectDialog({ flow, marks, trigger }: ConnectDialogProps) {
  const messages = DomainKit.useMessages();
  const controller = flow.connection;
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const busy = controller.state._tag === "Submitting";

  const narrowed =
    Connect.providerOf(controller, chosen ?? flow.state.provider) ??
    Connect.hostProvider(controller);
  const heading =
    narrowed === null ? messages.connectAnyTitle : messages.connectTitle(narrowed.name);
  const alternatives =
    narrowed === null ? [] : controller.providers.filter((entry) => entry.id !== narrowed.id);
  const reusable = Connect.reusableConnections(controller);
  const methods = narrowed === null ? null : Connect.describeMethods(narrowed);
  const asking = narrowed !== null && typing === narrowed.id;
  // A failure a method already answers beside its own field is not repeated at the foot.
  const unattributed =
    controller.state._tag === "Failure" && !Connect.answeredInPlace(controller)
      ? controller.state.error
      : null;

  return (
    <Dialog
      onOpenChange={(next: boolean) => {
        if (!next && busy) return;
        setOpen(next);
      }}
      open={open}
    >
      <DialogTrigger render={trigger ?? <Button size="sm" />}>{messages.connect}</DialogTrigger>
      <DialogContent className="gap-5" showCloseButton={!busy}>
        <DialogHeader className="flex-row items-start gap-3">
          {narrowed === null ? null : <Mark marks={marks} provider={narrowed} />}
          <div className="grid min-w-0 flex-1 gap-1">
            {alternatives.length === 0 ? (
              <DialogTitle>{heading}</DialogTitle>
            ) : (
              // The heading is also the control that moves the dialog to another provider. The
              // title stays the element that names the dialog; the trigger sits inside it.
              <DropdownMenu>
                <DialogTitle render={<div />}>
                  <DropdownMenuTrigger
                    disabled={busy}
                    render={<Button className="-mx-2 h-auto py-1 text-lg" variant="ghost" />}
                  >
                    {heading}
                    <ChevronDownIcon aria-hidden="true" className="size-4" />
                  </DropdownMenuTrigger>
                </DialogTitle>
                <DropdownMenuContent align="start" aria-label={messages.useAnotherProvider}>
                  {alternatives.map((entry) => (
                    <DropdownMenuItem key={entry.id} onClick={() => setChosen(entry.id)}>
                      <Mark className="size-4" marks={marks} provider={entry} />
                      {entry.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <DialogDescription>{messages.connectDescription(flow.domain)}</DialogDescription>
          </div>
        </DialogHeader>

        <div className="grid gap-4">
          {reusable.length === 0 || asking ? null : (
            <div className="grid gap-2" data-slot="reusable-connections">
              <p className="text-sm text-muted-foreground">{messages.reusableConnections}</p>
              {reusable.map((entry) => (
                <Button
                  key={`${entry.connectionId}:${entry.zone ?? ""}`}
                  onClick={() =>
                    controller.reuse({
                      connectionId: entry.connectionId,
                      ...(entry.zone === undefined ? {} : { zone: entry.zone }),
                    })
                  }
                  type="button"
                  variant="outline"
                >
                  {messages.useConnection(entry.label)}
                </Button>
              ))}
            </div>
          )}

          {narrowed === null || methods === null ? (
            <p className="text-sm text-muted-foreground">{messages.noProviders}</p>
          ) : asking ? (
            <div className="grid gap-3">
              <Button
                className="w-fit px-0"
                onClick={() => setTyping(null)}
                size="sm"
                type="button"
                variant="link"
              >
                {messages.back}
              </Button>
              {methods.typed.map((method) => (
                <TokenForm flow={flow} key={method.kind} method={method} provider={narrowed} />
              ))}
            </div>
          ) : methods.alternate ? (
            <div className="grid gap-3">
              {methods.interactive.map((method) => (
                <div className="grid gap-2" key={method.kind}>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      controller.connect({ method: method.kind, provider: narrowed.id })
                    }
                    type="button"
                  >
                    {method.kind === "oauth"
                      ? messages.methodOAuth(narrowed.name)
                      : messages.methodIntegration(narrowed.name)}
                  </Button>
                  <Outcome
                    context={{ domain: flow.domain, provider: narrowed.name }}
                    error={Connect.attempted(controller, narrowed.id, method.kind)}
                    layout="inline"
                  />
                </div>
              ))}
              <Button
                disabled={busy}
                onClick={() => setTyping(narrowed.id)}
                type="button"
                variant="outline"
              >
                {messages.useTokenInstead}
              </Button>
            </div>
          ) : (
            <div className="grid gap-3">
              {methods.interactive.map((method) => (
                <Button
                  disabled={busy}
                  key={method.kind}
                  onClick={() => controller.connect({ method: method.kind, provider: narrowed.id })}
                  type="button"
                >
                  {method.kind === "oauth"
                    ? messages.methodOAuth(narrowed.name)
                    : messages.methodIntegration(narrowed.name)}
                </Button>
              ))}
              {methods.typed.map((method) => (
                <TokenForm flow={flow} key={method.kind} method={method} provider={narrowed} />
              ))}
            </div>
          )}

          <Outcome
            context={{
              domain: flow.domain,
              ...(narrowed === null ? {} : { provider: narrowed.name }),
            }}
            error={unattributed}
            onRetry={controller.retry}
          />
        </div>

        {busy ? null : (
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{messages.cancel}</DialogClose>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
