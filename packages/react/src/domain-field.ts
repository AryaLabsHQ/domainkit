/**
 * Adding a domain is one input. The zones every connected account reaches load when the field
 * mounts, typing filters them, Tab completes the highlighted one while keeping whatever subdomain
 * was typed in front of it, and the surface names the account the records will go to.
 *
 * The listbox is built here rather than on a combobox primitive because the completion rule is not
 * a selection model: a suggestion never replaces what the customer typed, it finishes it, and a
 * domain outside every zone leaves the input a plain text field.
 */
import type { DomainKit } from "domainkit";
import { Transport } from "domainkit/client";
import * as Data from "effect/Data";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type AriaAttributes,
  type FocusEventHandler,
  type FormEventHandler,
  type KeyboardEventHandler,
  type MouseEventHandler,
} from "react";

import type { Descriptor } from "./connect.ts";
import { useDomainKit, useMessages } from "./domain-kit.tsx";
import { useRunner } from "./task.ts";

export type Zone = Transport.Zone;
export type Account = Transport.Zones["connections"][number];
export type AuthMethod = Descriptor["methods"][number];

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
    readonly providers: ReadonlyArray<Descriptor>;
  };
  Failure: { readonly error: DomainKit.Error };
}>;
export const ZonesState = Data.taggedEnum<ZonesState>();

export interface ZonesController {
  readonly state: ZonesState;
  readonly zones: ReadonlyArray<Zone>;
  readonly connections: ReadonlyArray<Account>;
  readonly providers: ReadonlyArray<Descriptor>;
  readonly refresh: () => void;
}

export interface ZonesOptions {
  /** Only this provider's connections. Omit for every connection this owner holds. */
  readonly provider?: string;
}

const nothing = {
  connections: [] as ReadonlyArray<Account>,
  providers: [] as ReadonlyArray<Descriptor>,
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
  readonly providers: ReadonlyArray<Descriptor>;
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
// useDomainField
// ---------------------------------------------------------------------------------------------

const optionId = (listId: string, zone: Zone): string =>
  `${listId}-${zone.connectionId}-${zone.zone}`;

export interface DomainFieldOptions {
  /** Every zone the surface offers, which `useZones` or `useAccounts` already holds. */
  readonly zones: ReadonlyArray<Zone>;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /**
   * Fires when the value or the account it resolves to changes, so a host holds the two together
   * and submits them together. It reports the value as typed, not only the placement, because a
   * form needs the name the customer is on as well as where its records would go.
   */
  readonly onResolve?: (input: {
    readonly domain: string;
    readonly connection: Placement | null;
  }) => void;
  /** The input's id. The listbox and its options are named from it; one is generated otherwise. */
  readonly id?: string;
}

/** The props one suggestion carries, so the option is a listbox option to a screen reader. */
export interface OptionProps {
  readonly "aria-selected": boolean;
  readonly id: string;
  readonly onMouseDown: MouseEventHandler<Element>;
  readonly role: "option";
}

export interface DomainFieldController {
  /** Whether the listbox is showing: the customer opened it and there is something in it. */
  readonly open: boolean;
  /** The zones the typed value is reaching for, in the order they were listed. */
  readonly suggestions: ReadonlyArray<Zone>;
  /** The suggestion Tab and Enter would complete, or `null` when the list is empty. */
  readonly highlighted: Zone | null;
  /** The zone the value already sits in, with the account its records would go to. */
  readonly found: { readonly zone: Zone; readonly placement: Placement } | null;
  /** Finish the name from one suggestion, keeping whatever subdomain was typed in front of it. */
  readonly complete: (zone: Zone) => void;
  readonly close: () => void;
  readonly inputProps: {
    readonly "aria-activedescendant": AriaAttributes["aria-activedescendant"];
    readonly "aria-autocomplete": "list";
    readonly "aria-controls": string;
    readonly "aria-expanded": boolean;
    readonly autoComplete: "off";
    readonly id: string;
    readonly onChange: FormEventHandler<HTMLInputElement>;
    readonly onFocus: FocusEventHandler<HTMLInputElement>;
    readonly onKeyDown: KeyboardEventHandler<HTMLInputElement>;
    readonly role: "combobox";
    readonly type: "text";
    readonly value: string;
  };
  readonly listboxProps: {
    readonly "aria-label": string;
    readonly hidden: boolean;
    readonly id: string;
    readonly role: "listbox";
  };
  readonly optionProps: (zone: Zone) => OptionProps;
}

/**
 * One input over every zone the workspace's accounts reach, as props rather than markup. Arrow
 * keys move the highlight, Tab or Enter completes it, Escape closes the list, and `found` says
 * where the records will go.
 */
export function useDomainField({
  id,
  onChange,
  onResolve,
  value,
  zones,
}: DomainFieldOptions): DomainFieldController {
  const messages = useMessages();
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
  const suggestions = suggestionsFor(value, zones);
  const highlighted = suggestions[Math.min(active, Math.max(suggestions.length - 1, 0))] ?? null;
  const found = placementOf(value, zones, chosen);
  const showing = open && suggestions.length > 0;

  // One report per value and placement: a re-render that changes neither says nothing.
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

  return {
    close: () => setOpen(false),
    complete,
    found,
    highlighted,
    inputProps: {
      "aria-activedescendant":
        showing && highlighted !== null ? optionId(listId, highlighted) : undefined,
      "aria-autocomplete": "list",
      "aria-controls": listId,
      "aria-expanded": showing,
      autoComplete: "off",
      id: inputId,
      onChange: (event) => {
        onChange((event.target as HTMLInputElement).value);
        setActive(0);
        setOpen(true);
      },
      onFocus: () => setOpen(true),
      onKeyDown: (event) => {
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
        // Tab and Enter finish the name rather than choosing one: what the customer typed in
        // front of the zone stays in front of it.
        if ((event.key === "Tab" || event.key === "Enter") && showing && highlighted !== null) {
          event.preventDefault();
          complete(highlighted);
        }
      },
      role: "combobox",
      type: "text",
      value,
    },
    listboxProps: {
      "aria-label": messages.zoneSuggestions,
      hidden: !showing,
      id: listId,
      role: "listbox",
    },
    open: showing,
    optionProps: (zone) => ({
      "aria-selected": zone === highlighted,
      id: optionId(listId, zone),
      // The press must not take focus off the input before the completion lands.
      onMouseDown: (event) => {
        event.preventDefault();
        complete(zone);
      },
      role: "option",
    }),
    suggestions,
  };
}
