/**
 * Adding a domain is one input. The zones every connected account reaches load when the field
 * mounts, typing filters them, Tab completes the highlighted one while keeping whatever subdomain
 * was typed in front of it, and the footer names the account the records will go to — or offers
 * the providers to connect when there is no account yet.
 *
 * The listbox is built here rather than on Base UI's Combobox because the completion rule is not
 * Combobox's selection model: a suggestion never replaces what the customer typed, it finishes it,
 * and a domain outside every zone leaves the input a plain text field.
 */
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { DomainKit } from "domainkit";
import { Transport } from "domainkit/client";
import * as Data from "effect/Data";
import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from "react";

import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit, useReadOnly } from "./domain-kit.tsx";
import * as Provider from "./provider.tsx";
import { useRunner } from "./task.ts";

export type Zone = Transport.Zone;
export type Account = Transport.Zones["connections"][number];
export type AuthMethod = Provider.Descriptor["methods"][number];

/** Where a domain's records would go: the connection that serves it, and in which zone. */
export interface Placement {
  readonly connectionId: string;
  readonly zone: string;
}

// ---------------------------------------------------------------------------------------------
// useZones
// ---------------------------------------------------------------------------------------------

export type ZonesState = Data.TaggedEnum<{
  Loading: {};
  Ready: {
    readonly zones: ReadonlyArray<Zone>;
    readonly connections: ReadonlyArray<Account>;
    readonly providers: ReadonlyArray<Provider.Descriptor>;
  };
  Failure: { readonly error: DomainKit.Error };
}>;
export const ZonesState = Data.taggedEnum<ZonesState>();

export interface ZonesController {
  readonly state: ZonesState;
  readonly zones: ReadonlyArray<Zone>;
  readonly connections: ReadonlyArray<Account>;
  readonly providers: ReadonlyArray<Provider.Descriptor>;
  readonly refresh: () => void;
}

export interface ZonesOptions {
  /** Only this provider's connections. Omit for every connection this owner holds. */
  readonly provider?: string;
}

const nothing = {
  connections: [] as ReadonlyArray<Account>,
  providers: [] as ReadonlyArray<Provider.Descriptor>,
  zones: [] as ReadonlyArray<Zone>,
};

/**
 * Every zone this owner's connections reach. A connection whose credential the provider turned
 * down is listed in `connections` as `reconnect` and contributes no zones, so one dead account
 * never costs the customer the others.
 */
export function useZones({ provider }: ZonesOptions = {}): ZonesController {
  const { revision, transport } = useDomainKit();
  const connection = transport.connection;
  const runner = useRunner();
  const [state, setState] = useState<ZonesState>(ZonesState.Loading());

  const load = useCallback(() => {
    if (connection === undefined) return;
    setState(ZonesState.Loading());
    runner.run(connection.zones(provider === undefined ? {} : { provider }), {
      onFailure: (error) => setState(ZonesState.Failure({ error })),
      onSuccess: (listing) =>
        setState(
          ZonesState.Ready({
            connections: listing.connections,
            providers: listing.providers,
            zones: listing.zones,
          }),
        ),
    });
  }, [connection, provider, runner]);

  useEffect(load, [load, revision]);

  const held = state._tag === "Ready" ? state : nothing;
  return {
    connections: held.connections,
    providers: held.providers,
    refresh: load,
    state,
    zones: held.zones,
  };
}

// ---------------------------------------------------------------------------------------------
// useAccounts
// ---------------------------------------------------------------------------------------------

export interface ConnectAccountInput {
  readonly provider: string;
  readonly method: AuthMethod["kind"];
  /** Keyed by the descriptor's field names. Ignored by the interactive methods. */
  readonly values?: Readonly<Record<string, string>>;
}

export type AccountsState = Data.TaggedEnum<{
  Loading: {};
  Ready: {};
  Submitting: { readonly provider: string };
  Redirecting: { readonly url: string };
  Failure: { readonly error: DomainKit.Error };
}>;
export const AccountsState = Data.taggedEnum<AccountsState>();

export interface AccountsController {
  readonly state: AccountsState;
  readonly zones: ReadonlyArray<Zone>;
  readonly connections: ReadonlyArray<Account>;
  readonly providers: ReadonlyArray<Provider.Descriptor>;
  /** Connect a provider with no domain attached. The account is what the customer is granting. */
  readonly connect: (input: ConnectAccountInput) => void;
  /**
   * Prove an account again for a connection the owner already holds. The connection and its
   * domains stay; only the credential behind it is replaced.
   */
  readonly reconnect: (input: ConnectAccountInput & { readonly connectionId: string }) => void;
  readonly refresh: () => void;
}

export interface AccountsOptions {
  /** Where an interactive method returns the customer. Defaults to the page they started from. */
  readonly returnTo?: string | null;
}

const currentUrl = (): string | null =>
  typeof window === "undefined" ? null : window.location.href;

/**
 * The accounts this owner holds, and the one way to add another: connect a provider without naming
 * a domain. A token method finishes in place; an interactive one redirects and comes back through
 * the library's own callback, which lands on `returnTo`.
 */
export function useAccounts({ returnTo }: AccountsOptions = {}): AccountsController {
  const { navigate, transport } = useDomainKit();
  const connection = transport.connection;
  const runner = useRunner();
  const listing = useZones();
  const [command, setCommand] = useState<AccountsState | null>(null);

  const refresh = listing.refresh;
  const submit = useCallback(
    (input: ConnectAccountInput & { readonly connectionId?: string }) => {
      if (connection === undefined) return;
      const destination = returnTo === undefined ? currentUrl() : returnTo;
      const interactive = destination === null ? {} : { returnTo: destination };
      const method =
        input.method === "token"
          ? Transport.Method.token(input.values ?? {})
          : input.method === "oauth"
            ? Transport.Method.oauth(interactive)
            : Transport.Method.integration(interactive);
      setCommand(AccountsState.Submitting({ provider: input.provider }));
      const granting =
        input.connectionId === undefined
          ? connection.start({ method, provider: input.provider })
          : connection.reconnect({ connectionId: input.connectionId, method });
      runner.run(granting, {
        onFailure: (error) => setCommand(AccountsState.Failure({ error })),
        onSuccess: (started) => {
          if (started._tag === "Redirect") {
            setCommand(AccountsState.Redirecting({ url: started.authorizationUrl }));
            navigate(started.authorizationUrl);
            return;
          }
          // A selection is about a domain and this flow names none, so the account is connected.
          setCommand(null);
          refresh();
        },
      });
    },
    [connection, navigate, refresh, returnTo, runner],
  );
  const connect = useCallback((input: ConnectAccountInput) => submit(input), [submit]);
  const reconnect = useCallback(
    (input: ConnectAccountInput & { readonly connectionId: string }) => submit(input),
    [submit],
  );

  const state =
    command ??
    (listing.state._tag === "Loading"
      ? AccountsState.Loading()
      : listing.state._tag === "Failure"
        ? AccountsState.Failure({ error: listing.state.error })
        : AccountsState.Ready());

  return {
    connect,
    reconnect,
    connections: listing.connections,
    providers: listing.providers,
    refresh,
    state,
    zones: listing.zones,
  };
}

// ---------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------

const normalize = (value: string): string => value.trim().toLowerCase().replace(/\.$/, "");

/**
 * The zone a value already sits in: the longest listed zone the value is at or under. Two accounts
 * can serve the same zone, so `preferred` names the one the customer picked and wins among equals;
 * without it the first listed account answers.
 */
export const placementOf = (
  value: string,
  zones: ReadonlyArray<Zone>,
  preferred?: Placement | null,
): { readonly zone: Zone; readonly placement: Placement } | null => {
  const domain = normalize(value);
  if (domain === "") return null;
  const matching = zones.filter((candidate) => {
    const zone = normalize(candidate.zone);
    return domain === zone || domain.endsWith(`.${zone}`);
  });
  const longest = matching.reduce(
    (best, candidate) =>
      best === null || normalize(candidate.zone).length > normalize(best.zone).length
        ? candidate
        : best,
    null as Zone | null,
  );
  if (longest === null) return null;
  const closest = matching.filter(
    (candidate) => normalize(candidate.zone) === normalize(longest.zone),
  );
  const best =
    closest.find(
      (candidate) =>
        preferred != null &&
        candidate.connectionId === preferred.connectionId &&
        normalize(candidate.zone) === normalize(preferred.zone),
    ) ??
    closest[0] ??
    longest;
  return { placement: { connectionId: best.connectionId, zone: best.zone }, zone: best };
};

/**
 * What the customer typed in front of the zone they are reaching for. "mail.ex" against
 * `example.com` is the subdomain "mail"; "ex" on its own is none.
 */
const subdomainOf = (value: string, zone: string): string => {
  const typed = normalize(value);
  const target = normalize(zone);
  if (typed === "" || target.startsWith(typed)) return "";
  const cut = typed.lastIndexOf(".");
  if (cut < 0) return "";
  const head = typed.slice(0, cut);
  const tail = typed.slice(cut + 1);
  return target.startsWith(tail) ? head : "";
};

/** Zones the typed value is reaching for: a prefix of the zone, or a subdomain of one. */
export const suggestionsFor = (value: string, zones: ReadonlyArray<Zone>): ReadonlyArray<Zone> => {
  const typed = normalize(value);
  if (typed === "") return zones;
  return zones.filter((candidate) => {
    const zone = normalize(candidate.zone);
    if (zone.startsWith(typed)) return true;
    const cut = typed.lastIndexOf(".");
    if (cut < 0) return false;
    const tail = typed.slice(cut + 1);
    return tail !== "" && zone.startsWith(tail);
  });
};

/** The value a suggestion completes to: whatever subdomain was typed, then the zone. */
export const completionOf = (value: string, zone: Zone): string => {
  const subdomain = subdomainOf(value, zone.zone);
  return subdomain === "" ? zone.zone : `${subdomain}.${zone.zone}`;
};

// ---------------------------------------------------------------------------------------------
// DomainField
// ---------------------------------------------------------------------------------------------

export interface DomainFieldState extends Record<string, unknown> {
  readonly open: boolean;
  readonly resolved: boolean;
}

export interface DomainFieldProps extends Omit<
  PartProps<"div", DomainFieldState>,
  "children" | "onChange"
> {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Fires whenever the value's account changes, so a host submits the two together. */
  readonly onResolve?: (input: {
    readonly domain: string;
    readonly connection: Placement | null;
  }) => void;
  /** Where an interactive connect offer returns the customer. Defaults to the current page. */
  readonly returnTo?: string | null;
  readonly id?: string;
  readonly placeholder?: string;
  readonly autoFocus?: boolean;
}

/**
 * One input over every zone the workspace's accounts reach. Arrow keys move the highlight, Tab or
 * Enter completes it, Escape closes the list, and the footer says where the records will go.
 */
export function DomainField({
  autoFocus,
  id,
  onChange,
  onResolve,
  placeholder,
  returnTo,
  value,
  ...props
}: DomainFieldProps): ReactElement {
  const { messages } = useDomainKit();
  const readOnly = useReadOnly();
  const accounts = useAccounts(returnTo === undefined ? {} : { returnTo });
  const generated = useId();
  const inputId = id ?? generated;
  const listId = `${inputId}-suggestions`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Which account the customer completed from, so a zone two accounts both serve stays the one
  // they picked rather than whichever the listing happens to hold first. `placementOf` honours it
  // only while the value still sits in that zone, so a value that moves — whether the customer
  // typed it or the host set it — loses the preference by the same rule.
  const [chosen, setChosen] = useState<Placement | null>(null);
  const suggestions = suggestionsFor(value, accounts.zones);
  const highlighted = suggestions[Math.min(active, Math.max(suggestions.length - 1, 0))] ?? null;
  const found = placementOf(value, accounts.zones, chosen);
  const showing = open && suggestions.length > 0;

  // The host is told what the value resolved to, not every keystroke that left it where it was.
  const placement = found?.placement ?? null;
  const connectionId = placement?.connectionId ?? null;
  const placedIn = placement?.zone ?? null;
  const announced = useRef<string | null>(null);
  useEffect(() => {
    const signature = `${value}|${connectionId ?? ""}|${placedIn ?? ""}`;
    if (announced.current === signature) return;
    announced.current = signature;
    onResolve?.({
      connection:
        connectionId === null || placedIn === null ? null : { connectionId, zone: placedIn },
      domain: value,
    });
  }, [connectionId, onResolve, placedIn, value]);

  const complete = (zone: Zone) => {
    onChange(completionOf(value, zone));
    setChosen({ connectionId: zone.connectionId, zone: zone.zone });
    setOpen(false);
    setActive(0);
  };

  return usePart(
    "div",
    props,
    { open: showing, resolved: found !== null },
    {
      children: (
        <>
          <input
            aria-activedescendant={
              showing && highlighted !== null ? optionId(listId, highlighted) : undefined
            }
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={showing}
            autoComplete="off"
            autoFocus={autoFocus}
            data-domainkit-part="domain-input"
            id={inputId}
            onChange={(event) => {
              onChange(event.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setOpen(false);
                return;
              }
              if (suggestions.length === 0) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setOpen(true);
                setActive((index) => (index + 1) % suggestions.length);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setOpen(true);
                setActive((index) => (index + suggestions.length - 1) % suggestions.length);
                return;
              }
              // Tab and Enter finish the name rather than choosing one: what the customer typed
              // in front of the zone stays in front of it.
              if (
                (event.key === "Tab" || event.key === "Enter") &&
                showing &&
                highlighted !== null
              ) {
                event.preventDefault();
                complete(highlighted);
              }
            }}
            placeholder={placeholder}
            role="combobox"
            type="text"
            value={value}
          />
          <ul
            aria-label={messages.zoneSuggestions}
            data-domainkit-part="domain-suggestions"
            hidden={!showing}
            id={listId}
            role="listbox"
          >
            {suggestions.map((suggestion) => (
              <li
                aria-selected={suggestion === highlighted}
                data-domainkit-part="domain-suggestion"
                id={optionId(listId, suggestion)}
                key={`${suggestion.connectionId}:${suggestion.zone}`}
                onMouseDown={(event) => {
                  // The press must not take focus off the input before the completion lands.
                  event.preventDefault();
                  complete(suggestion);
                }}
                role="option"
              >
                <span data-domainkit-part="domain-suggestion-zone">{suggestion.zone}</span>
                <span data-domainkit-part="domain-suggestion-account">{suggestion.label}</span>
              </li>
            ))}
          </ul>
          <Footer
            accounts={accounts}
            found={found?.zone ?? null}
            readOnly={readOnly}
            value={value}
          />
        </>
      ),
      "data-domainkit-part": "domain-field",
    },
  );
}

const optionId = (listId: string, zone: Zone): string =>
  `${listId}-${zone.connectionId}-${zone.zone}`;

interface FooterProps {
  readonly accounts: AccountsController;
  readonly found: Zone | null;
  readonly readOnly: boolean;
  readonly value: string;
}

/**
 * Where the records will go, or how to make somewhere for them to go. A held account the provider
 * turned down is offered as a reconnect rather than as a second account.
 */
function Footer({ accounts, found, readOnly, value }: FooterProps): ReactElement | null {
  const { messages } = useDomainKit();
  const named = (provider: string) =>
    accounts.providers.find((entry) => entry.id === provider)?.name ?? provider;
  const stale = accounts.connections.filter((entry) => entry.status === "reconnect");
  const offering = accounts.connections.length === 0;
  const busy = accounts.state._tag === "Submitting" || accounts.state._tag === "Redirecting";
  const line =
    found !== null ? (
      <span data-domainkit-part="domain-field-account">
        {messages.recordsGoTo(named(found.provider), found.label)}
      </span>
    ) : value.trim() !== "" ? (
      <span data-domainkit-part="domain-field-account">{messages.notInConnectedAccount}</span>
    ) : null;
  const offers =
    !offering || readOnly
      ? null
      : accounts.providers.map((provider) => (
          <Offer busy={busy} connect={accounts.connect} key={provider.id} provider={provider} />
        ));
  // Proving the account again re-credits the connection the workspace already holds, so the
  // domains on it stay where they are; a second account beside the rejected one would help nobody.
  const reconnects =
    readOnly || stale.length === 0
      ? null
      : stale.map((entry) => {
          const provider = accounts.providers.find((held) => held.id === entry.provider);
          return provider === undefined ? null : (
            <Offer
              busy={busy}
              connect={(input) =>
                accounts.reconnect({ ...input, connectionId: entry.connectionId })
              }
              connectionId={entry.connectionId}
              key={entry.connectionId}
              label={messages.reconnectAccount(named(entry.provider))}
              part="domain-field-reconnect"
              provider={provider}
            />
          );
        });
  if (line === null && offers === null && reconnects === null) return null;
  return (
    <div data-domainkit-part="domain-field-footer">
      {line}
      {offers}
      {reconnects}
    </div>
  );
}

interface OfferProps {
  readonly busy: boolean;
  readonly connect: AccountsController["connect"];
  /** The connection this offer re-credits, when it is a reconnect rather than a new account. */
  readonly connectionId?: string;
  readonly label?: string;
  readonly part?: string;
  readonly provider: Provider.Descriptor;
}

/**
 * One provider to connect, with its mark. A method the customer clicks through starts on the
 * press; a token method asks for the values it declares first, because there is nowhere else on
 * this surface to type them.
 */
function Offer({
  busy,
  connect,
  connectionId,
  label,
  part = "domain-field-connect",
  provider,
}: OfferProps): ReactElement {
  const { colorScheme, messages, portalContainer, themeStyle } = useDomainKit();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});
  const interactive = provider.methods.find((method) => method.fields === null);
  const typed = provider.methods.find((method) => method.fields !== null);
  const name = label ?? messages.connectTitle(provider.name);
  if (interactive !== undefined || typed === undefined) {
    return (
      <button
        data-connection-id={connectionId}
        data-domainkit-part={part}
        data-provider={provider.id}
        disabled={busy}
        onClick={() => connect({ method: interactive?.kind ?? "token", provider: provider.id })}
        type="button"
      >
        <Provider.Mark provider={provider} />
        {name}
      </button>
    );
  }
  const fields = typed.fields ?? [];
  return (
    <BaseDialog.Root onOpenChange={setOpen} open={open}>
      <BaseDialog.Trigger
        data-connection-id={connectionId}
        data-domainkit-part={part}
        data-provider={provider.id}
        disabled={busy}
      >
        <Provider.Mark provider={provider} />
        {name}
      </BaseDialog.Trigger>
      <BaseDialog.Portal container={portalContainer}>
        <BaseDialog.Backdrop
          data-color-scheme={colorScheme}
          data-domainkit-part="dialog-backdrop"
          data-domainkit-root=""
          style={themeStyle}
        />
        <BaseDialog.Popup
          data-color-scheme={colorScheme}
          data-domainkit-part="connection-dialog"
          data-domainkit-root=""
          style={themeStyle}
        >
          <div data-domainkit-part="dialog-header">
            <div data-domainkit-part="dialog-heading">
              <BaseDialog.Title data-domainkit-part="dialog-title">{name}</BaseDialog.Title>
            </div>
          </div>
          <form
            data-domainkit-part="token-connect"
            data-provider={provider.id}
            onSubmit={(event) => {
              event.preventDefault();
              setOpen(false);
              connect({ method: "token", provider: provider.id, values });
            }}
          >
            {fields.map((field) => (
              <label data-domainkit-part="field" key={field.name}>
                <span data-domainkit-part="field-label">{messages.fieldLabel(field.name)}</span>
                <input
                  autoComplete="off"
                  data-domainkit-part="field-input"
                  name={field.name}
                  onChange={(event) =>
                    setValues((held) => ({ ...held, [field.name]: event.target.value }))
                  }
                  required={field.required}
                  type={field.secret ? "password" : "text"}
                  value={values[field.name] ?? ""}
                />
              </label>
            ))}
            <button data-domainkit-part="token-submit" type="submit">
              {messages.methodToken}
            </button>
          </form>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
