import { Receipt, type DomainKit, type Storage } from "domainkit";
import { Transport } from "domainkit/client";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { useCallback, useEffect, useRef, useState } from "react";

import { useDomainKit, useReadOnly } from "./domain-kit.tsx";
import { Event } from "./events.ts";
import { useRunner } from "./task.ts";

export {
  AccountsState,
  completionOf,
  placementOf,
  suggestionsFor,
  useAccounts,
  useDomainField,
  useZones,
  ZonesState,
  type Account,
  type AccountsController,
  type AccountsOptions,
  type ConnectAccountInput,
  type DomainFieldController,
  type DomainFieldOptions,
  type Placement,
  type Zone,
  type ZonesController,
  type ZonesOptions,
} from "./domain-field.ts";

export type Snapshot = Transport.Snapshot;
export type Discovery = Transport.Discovery;
export type Candidate = Transport.Candidate;
/** A provider as the snapshot describes it: an id, a display name, and its auth methods. */
export type Descriptor = Transport.Snapshot["providers"][number];
export type MethodDescriptor = Descriptor["methods"][number];
export type Field = NonNullable<MethodDescriptor["fields"]>[number];

/**
 * Where a domain stands with its DNS provider. `Disconnected` carries whatever
 * `connection.discover` found, so the UI can offer a connection the customer already has before
 * asking for another one.
 */
export type State = Data.TaggedEnum<{
  Loading: { readonly snapshot: Snapshot | null };
  Disconnected: { readonly snapshot: Snapshot; readonly discovery: Discovery | null };
  Connected: { readonly snapshot: Snapshot };
  Reconnect: { readonly snapshot: Snapshot };
  Submitting: { readonly snapshot: Snapshot | null; readonly discovery: Discovery | null };
  Redirecting: { readonly url: string };
  SelectionRequired: {
    readonly snapshot: Snapshot | null;
    readonly connectionId: string;
    readonly candidates: ReadonlyArray<Candidate>;
  };
  Failure: {
    readonly error: DomainKit.Error;
    readonly snapshot: Snapshot | null;
    readonly discovery: Discovery | null;
    /** The provider and method the customer was using, when a command failed rather than a read. */
    readonly attempt: Attempt | null;
  };
}>;
export const State = Data.taggedEnum<State>();

/** Which provider and method the failed command was for, so the form can answer beside it. */
export interface Attempt {
  readonly provider: string;
  readonly method: Storage.AuthMethod;
}

export interface ConnectInput {
  readonly provider: string;
  readonly method: Storage.AuthMethod;
  /** Keyed by the descriptor's field names. Ignored by the interactive methods. */
  readonly values?: Readonly<Record<string, string>>;
  /** Where an interactive method returns the customer. */
  readonly returnTo?: string;
}

export interface Controller {
  readonly domain: string;
  /**
   * What this domain's last apply landed, read once per receipt id and held here. `null` until
   * the snapshot names a receipt, or when the transport carries no provisioning group.
   */
  readonly receipt: Receipt.Model | null;
  /**
   * How many times a connection has been established for this domain on this surface: a token
   * connect that landed, or a load that followed this library's own redirect back. It only ever
   * grows, so a flow acts on a change rather than on a state that would fire again every render.
   */
  readonly established: number;
  readonly state: State;
  readonly snapshot: Snapshot | null;
  readonly discovery: Discovery | null;
  readonly providers: ReadonlyArray<Descriptor>;
  readonly connect: (input: ConnectInput) => void;
  /** Attach the domain to a connection this owner already has. */
  readonly reuse: (input: { readonly connectionId: string; readonly zone?: string }) => void;
  /** Answer `SelectionRequired` by naming the zone that serves the domain. */
  readonly select: (zone: string) => void;
  readonly detach: () => void;
  readonly disconnect: () => void;
  /** Re-inspect the domain, discarding any failure. */
  readonly refresh: () => void;
  /** Re-run the step that failed; without one, re-inspect. */
  readonly retry: () => void;
}

export interface Options {
  readonly domain: string;
  /**
   * Where an interactive method returns the customer. Defaults to the page they started from;
   * pass `null` to send none and let the server's `defaultReturnTo` decide.
   */
  readonly returnTo?: string | null;
  /**
   * Refuse every command that changes the connection. Defaults to the surrounding `readOnly`,
   * which is `DomainKit.Root`'s unless a `DomainKit.ReadOnly` narrows it.
   */
  readonly readOnly?: boolean;
}

/**
 * An interactive method leaves the page and comes back, so what the library knew is gone with it.
 * It writes down the domain it sent the customer away for, and the load that follows reads it once:
 * that, not a query parameter a host would have to keep, is how a return is told from a reload.
 */
const RETURNING = "domainkit.returning";

const markReturn = (domain: string): void => {
  try {
    sessionStorage.setItem(RETURNING, domain);
  } catch {
    // A browser with storage turned off simply loses the one-click return.
  }
};

const tookReturn = (domain: string): boolean => {
  try {
    if (sessionStorage.getItem(RETURNING) !== domain) return false;
    sessionStorage.removeItem(RETURNING);
    return true;
  } catch {
    return false;
  }
};

/** Read at connect time, not at render, so it is the page the customer is actually on. */
const currentUrl = (): string | null =>
  typeof window === "undefined" ? null : window.location.href;

const snapshotOf = (state: State): Snapshot | null => {
  switch (state._tag) {
    case "Connected":
    case "Reconnect":
    case "Disconnected":
      return state.snapshot;
    case "Loading":
    case "Submitting":
    case "SelectionRequired":
    case "Failure":
      return state.snapshot;
    case "Redirecting":
      return null;
  }
};

const settled = (snapshot: Snapshot, discovery: Discovery | null): State => {
  switch (snapshot.status) {
    case "connected":
      return State.Connected({ snapshot });
    case "reconnect":
      return State.Reconnect({ snapshot });
    case "disconnected":
      return State.Disconnected({ discovery, snapshot });
  }
};

/**
 * The domain's connection, and the four ways to change it. Discovery runs on mount whenever the
 * transport declares it and the domain has no connection yet; a discovery failure is not the
 * customer's problem, so the provider list still renders.
 */
export function useController({ domain, readOnly: refused, returnTo }: Options): Controller {
  const { emit, navigate, revision, transport } = useDomainKit();
  const inherited = useReadOnly();
  // The surface is the host's now, so a control it renders anyway must not reach the transport:
  // every command that changes the connection is refused here rather than hidden up there.
  const readOnly = refused ?? inherited;
  const connection = transport.connection;
  const provisioning = transport.provisioning;
  const runner = useRunner();
  const [state, setState] = useState<State>(State.Loading({ snapshot: null }));

  // The snapshot and the discovery belong to the domain they were read for, so a controller
  // pointed at a new domain drops both while rendering rather than one effect later.
  // What was read travels with the domain it was read for, so a command or a reply that arrives
  // after the controller moved refuses to act: one domain's attachment must never be detached for
  // another.
  const held = useRef<{
    domain: string;
    snapshot: Snapshot | null;
    discovery: Discovery | null;
  }>({ discovery: null, domain, snapshot: null });
  const lastCommand = useRef<{ domain: string; run: () => void } | null>(null);
  // What the customer was doing when it failed, so the dialog can answer beside that method.
  const attempted = useRef<Attempt | null>(null);

  const [established, setEstablished] = useState(0);
  const [inspected, setInspected] = useState(domain);
  if (inspected !== domain) {
    setInspected(domain);
    runner.cancel();
    held.current = { discovery: null, domain, snapshot: null };
    lastCommand.current = null;
    setState(State.Loading({ snapshot: null }));
  }

  // A failure keeps what was already read: the customer's provider list, the domain in the
  // dialog's description, and the discovery that offered a connection they already have.
  const onFailure = useCallback(
    (error: DomainKit.Error) => {
      setState(
        State.Failure({
          attempt: attempted.current,
          discovery: held.current.discovery,
          error,
          snapshot: held.current.snapshot,
        }),
      );
      emit(Event.Failed({ domain, error }));
    },
    [domain, emit],
  );

  const load = useCallback(() => {
    if (connection === undefined) return;
    lastCommand.current = null;
    attempted.current = null;
    held.current = { discovery: null, domain, snapshot: null };
    // A refresh keeps the snapshot on screen; a domain change already cleared it.
    setState((previous) => State.Loading({ snapshot: snapshotOf(previous) }));
    runner.run(
      Effect.flatMap(connection.inspect(domain), (snapshot) =>
        snapshot.status === "disconnected"
          ? Effect.map(
              connection.discover(domain).pipe(Effect.catch(() => Effect.succeed(null))),
              (discovery) => ({ discovery, snapshot }),
            )
          : Effect.succeed({ discovery: null, snapshot }),
      ),
      {
        onFailure,
        onSuccess: ({ discovery, snapshot }) => {
          if (held.current.domain !== domain) return;
          held.current = { discovery, domain, snapshot };
          // The marker answers exactly one load: the one that came back. It is spent whatever
          // that load found, so an authorization the customer abandoned cannot leave it lying
          // there for an ordinary page view to read as a return weeks later.
          const returned = tookReturn(domain);
          if (returned && snapshot.status === "connected") {
            setEstablished((count) => count + 1);
          }
          setState(settled(snapshot, discovery));
        },
      },
    );
  }, [connection, domain, onFailure, runner]);

  useEffect(load, [load, revision]);

  const started = useCallback(
    (result: Transport.Started) => {
      if (held.current.domain !== domain) return;
      switch (result._tag) {
        case "Connected": {
          const snapshot = result.snapshot;
          setEstablished((count) => count + 1);
          // This controller is one domain's, so every command it sends carries that domain and
          // comes back with its snapshot. A reply without one connected an account alone, which
          // only a host calling the transport directly can do, so read the domain again.
          if (snapshot === null) {
            load();
            return;
          }
          held.current = { discovery: null, domain, snapshot };
          setState(settled(snapshot, null));
          if (snapshot.connectionId !== null) {
            emit(Event.Connected({ connectionId: snapshot.connectionId, domain, snapshot }));
          }
          return;
        }
        case "Redirect":
          markReturn(domain);
          setState(State.Redirecting({ url: result.authorizationUrl }));
          navigate(result.authorizationUrl);
          return;
        case "SelectionRequired":
          setState(
            State.SelectionRequired({
              candidates: result.candidates,
              connectionId: result.connectionId,
              snapshot: held.current.snapshot,
            }),
          );
          return;
      }
    },
    [domain, emit, load, navigate],
  );

  const submit = useCallback(
    (effect: Effect.Effect<Transport.Started, DomainKit.Error>, attempt: Attempt | null) => {
      if (held.current.domain !== domain) return;
      attempted.current = attempt;
      const command = () => {
        setState(
          State.Submitting({
            discovery: held.current.discovery,
            snapshot: held.current.snapshot,
          }),
        );
        runner.run(effect, { onFailure, onSuccess: started });
      };
      lastCommand.current = { domain, run: command };
      command();
    },
    [domain, onFailure, runner, started],
  );

  const connect = useCallback(
    (input: ConnectInput) => {
      if (connection === undefined || readOnly) return;
      const destination = input.returnTo ?? (returnTo === undefined ? currentUrl() : returnTo);
      const interactive = destination === null ? {} : { returnTo: destination };
      const method =
        input.method === "token"
          ? Transport.Method.token(input.values ?? {})
          : input.method === "oauth"
            ? Transport.Method.oauth(interactive)
            : Transport.Method.integration(interactive);
      // A domain whose connection the provider turned down is not asking for a second account:
      // proving the same provider again re-credits the connection it already has, and the domains
      // on it stay where they are. Starting instead would fail, because the domain is attached.
      const snapshot = held.current.snapshot;
      const stale =
        snapshot?.status === "reconnect" &&
        snapshot.provider === input.provider &&
        snapshot.connectionId !== null;
      submit(
        stale && snapshot?.connectionId != null
          ? connection.reconnect({ connectionId: snapshot.connectionId, method })
          : connection.start({ domain, method, provider: input.provider }),
        { method: input.method, provider: input.provider },
      );
    },
    [connection, domain, readOnly, returnTo, submit],
  );

  const reuse = useCallback(
    (input: { readonly connectionId: string; readonly zone?: string }) => {
      if (connection === undefined || readOnly) return;
      submit(
        connection.attach({
          connectionId: input.connectionId,
          domain,
          ...(input.zone === undefined ? {} : { zone: input.zone }),
        }),
        null,
      );
    },
    [connection, domain, readOnly, submit],
  );

  const select = useCallback(
    (zone: string) => {
      if (state._tag !== "SelectionRequired") return;
      reuse({ connectionId: state.connectionId, zone });
    },
    [reuse, state],
  );

  const release = useCallback(
    (effect: Effect.Effect<void, DomainKit.Error>, event: Event) => {
      if (held.current.domain !== domain) return;
      attempted.current = null;
      const command = () => {
        setState(
          State.Submitting({
            discovery: held.current.discovery,
            snapshot: held.current.snapshot,
          }),
        );
        runner.run(effect, {
          onFailure,
          onSuccess: () => {
            emit(event);
            load();
          },
        });
      };
      lastCommand.current = { domain, run: command };
      command();
    },
    [domain, emit, load, onFailure, runner],
  );

  const detach = useCallback(() => {
    const attachmentId = held.current.snapshot?.attachment?.id;
    if (readOnly || connection === undefined || attachmentId == null) return;
    if (held.current.domain !== domain) return;
    release(connection.detach(attachmentId), Event.Detached({ domain }));
  }, [connection, domain, readOnly, release]);

  const disconnect = useCallback(() => {
    const connectionId = held.current.snapshot?.connectionId;
    if (readOnly || connection === undefined || connectionId == null) return;
    if (held.current.domain !== domain) return;
    release(connection.disconnect(connectionId), Event.Disconnected({ connectionId, domain }));
  }, [connection, domain, readOnly, release]);

  const retry = useCallback(() => {
    const command = lastCommand.current;
    // Re-inspecting is a read, so it stays; rerunning the last write does not.
    if (readOnly || command === null || command.domain !== domain) load();
    else command.run();
  }, [domain, load, readOnly]);

  // One connection of this owner already serves the zone, so the customer has nothing left to
  // decide: the account they granted covers this domain too. Attaching here is what keeps a second
  // domain from meeting the connect dialog again. Each (domain, connection, zone) is tried once,
  // so an attach that failed, or one the customer undid with a detach, is not started over.
  const sighted = useRef<string | null>(null);
  useEffect(() => {
    if (readOnly || state._tag !== "Disconnected") return;
    const discovery = state.discovery;
    if (discovery === null || discovery._tag !== "Resolved") return;
    const sight = `${domain}|${discovery.connectionId}|${discovery.zone}`;
    if (sighted.current === sight) return;
    sighted.current = sight;
    reuse({ connectionId: discovery.connectionId, zone: discovery.zone });
  }, [domain, readOnly, reuse, state]);

  // The card names how many records this domain holds, which only the receipt knows. One read per
  // receipt id: the id changes when an apply lands, and nothing else moves it.
  const [receipt, setReceipt] = useState<Receipt.Model | null>(null);
  const receiptId = snapshotOf(state)?.lastReceiptId ?? null;
  const readReceipt = useRef<string | null>(null);
  useEffect(() => {
    if (receiptId === null) {
      readReceipt.current = null;
      setReceipt(null);
      return;
    }
    if (provisioning === undefined || readReceipt.current === receiptId) return;
    readReceipt.current = receiptId;
    runner.run(provisioning.receipt(Receipt.ReceiptId.make(receiptId)), {
      // A receipt the surface cannot read is one line of copy missing, not a failure the
      // customer has to answer, so the card renders without it.
      onFailure: () => setReceipt(null),
      onSuccess: (value) => setReceipt(value.id === receiptId ? value : null),
    });
  }, [provisioning, receiptId, runner]);

  return {
    connect,
    detach,
    disconnect,
    domain,
    established,
    discovery:
      state._tag === "Disconnected" || state._tag === "Failure" || state._tag === "Submitting"
        ? state.discovery
        : null,
    providers: snapshotOf(state)?.providers ?? [],
    receipt: receipt?.id === receiptId ? receipt : null,
    refresh: load,
    retry,
    reuse,
    select,
    snapshot: snapshotOf(state),
    state,
  };
}

// ---------------------------------------------------------------------------------------------
// Reading a connection
// ---------------------------------------------------------------------------------------------

/**
 * Whether a failure is already answered where it was raised: beside the method the customer used.
 * A surface rendering one outcome for the whole flow skips it, so the failure announces once.
 */
export const answeredInPlace = (controller: Controller): boolean =>
  controller.state._tag === "Failure" && controller.state.attempt !== null;

/**
 * Whether the surface should read as connected: it is, or a command it started is in flight over a
 * connection that was. The provider row and the dialog it opened stay on screen for the length of
 * the command rather than vanishing under the customer half way through it.
 */
export const holdsConnection = (controller: Controller): boolean =>
  controller.state._tag === "Connected" ||
  (controller.state._tag === "Submitting" && controller.snapshot?.status === "connected");

/**
 * Whether the provider turned the credential down, so the customer must prove the account again.
 * Proving it re-credits the connection the workspace already holds and leaves its domains where
 * they are, which is why the surface offers a reconnect rather than a second account.
 */
export const reconnect = (controller: Controller): boolean =>
  controller.state._tag === "Reconnect" ||
  (controller.state._tag === "Submitting" && controller.snapshot?.status === "reconnect");

/**
 * The provider whose nameservers serve this domain, as the snapshot describes it. Discovery names
 * it by id; without a descriptor there is nothing to draw, so there is no host.
 */
export const hostProvider = (controller: Controller): Descriptor | null => {
  const discovery = controller.discovery;
  if (discovery === null || discovery._tag !== "NotFound" || discovery.host === null) return null;
  const named = discovery.host.provider;
  return controller.providers.find((entry) => entry.id === named) ?? null;
};

/** The descriptor for one provider id, or `null` when the snapshot describes no such provider. */
export const providerOf = (
  controller: Controller,
  providerId: string | null | undefined,
): Descriptor | null =>
  providerId == null
    ? null
    : (controller.providers.find((entry) => entry.id === providerId) ?? null);

/** The provider as the customer knows it, falling back to the id when the snapshot has no name. */
export const displayName = (controller: Controller, providerId: string): string =>
  providerOf(controller, providerId)?.name ?? providerId;

/**
 * Whether the flow offers a connect surface: only when discovery names a host, always, or never.
 * `never` is a host that decides for itself, such as a domain already ready without DomainKit; a
 * connected domain keeps its status and its disconnect either way.
 */
export type Invitation = "always" | "detected" | "never";

/**
 * Whether the connect surface has anything to offer for this domain: a provider that serves the
 * zone, a connection discovery already found, one the owner already holds, or a command already
 * running. Never while a connection is held, which is what `holdsConnection` answers. A host reads
 * it to order its own offers beside DomainKit's rather than competing with them.
 */
export const offering = (controller: Controller, connect: Invitation = "detected"): boolean => {
  // A surface that holds a connection is not offering one: the connected row is what renders, and
  // a host reading both must never see them claim different things about the same domain.
  if (holdsConnection(controller)) return false;
  const state = controller.state;
  // A command in flight owns the surface whatever discovery found: it is how the customer answers
  // a zone choice, a reconnect, or a redirect that came back.
  if (
    state._tag === "Submitting" ||
    state._tag === "Redirecting" ||
    state._tag === "SelectionRequired" ||
    state._tag === "Reconnect"
  ) {
    return true;
  }
  if (connect !== "detected") return connect === "always";
  const discovery = controller.discovery;
  return (
    hostProvider(controller) !== null ||
    (discovery !== null && discovery._tag !== "NotFound") ||
    (controller.snapshot?.reusable.length ?? 0) > 0
  );
};

/** A connection this owner already holds that would serve the domain, as one list to offer. */
export interface Reusable {
  readonly connectionId: string;
  /** The zone the connection would attach, when discovery named one. */
  readonly zone: string | undefined;
  readonly label: string;
}

/**
 * Every connection the customer can attach without proving anything: the one discovery resolved,
 * the candidates a zone choice is between, and the connections the snapshot lists as reusable.
 */
export const reusableConnections = (controller: Controller): ReadonlyArray<Reusable> => {
  const state = controller.state;
  const discovery = controller.discovery;
  const candidates =
    state._tag === "SelectionRequired"
      ? state.candidates.map((candidate) => ({ ...candidate, connectionId: state.connectionId }))
      : discovery !== null && discovery._tag === "SelectionRequired"
        ? discovery.candidates
        : [];
  const resolved = discovery !== null && discovery._tag === "Resolved" ? [discovery] : [];
  return [
    ...resolved.map((entry) => ({
      connectionId: entry.connectionId,
      label: entry.label,
      zone: entry.zone,
    })),
    ...candidates.map((entry) => ({
      connectionId: entry.connectionId,
      label: entry.label,
      zone: entry.zone,
    })),
    ...(controller.snapshot?.reusable ?? []).map((entry) => ({
      connectionId: entry.connectionId,
      label: entry.provider,
      zone: undefined,
    })),
  ];
};

// ---------------------------------------------------------------------------------------------
// Reading a provider's methods
// ---------------------------------------------------------------------------------------------

/** The fields one token method declares, split into what the surface asks for and what it hides. */
export interface MethodFields {
  readonly required: ReadonlyArray<Field>;
  /** The fields a provider does not need, which the surface keeps behind a disclosure. */
  readonly optional: ReadonlyArray<Field>;
  /** The field the provider's documentation link explains: the first secret, else the first field. */
  readonly explains: string | null;
}

/** One declared auth method, with the fields it asks for already arranged. */
export interface DescribedMethod {
  readonly kind: Storage.AuthMethod;
  readonly descriptor: MethodDescriptor;
  /** `null` for a method the customer clicks through, which asks for nothing on the page. */
  readonly fields: MethodFields | null;
}

/** What one provider offers, in the order the descriptor declares it. */
export interface DescribedMethods {
  /** The methods the customer clicks through: OAuth and the provider's own integration. */
  readonly interactive: ReadonlyArray<DescribedMethod>;
  /** The methods that ask for credentials on the page. */
  readonly typed: ReadonlyArray<DescribedMethod>;
  /**
   * Both kinds are on offer, so the surface shows the interactive one and a control that opens the
   * token form in its place: one decision at a time rather than a wall of alternatives.
   */
  readonly alternate: boolean;
}

const fieldsOf = (method: MethodDescriptor): MethodFields | null => {
  const fields = method.fields;
  if (fields === null) return null;
  const required = fields.filter((field) => field.required);
  const optional = fields.filter((field) => !field.required);
  return {
    explains: (required.find((field) => field.secret) ?? required[0] ?? optional[0])?.name ?? null,
    optional,
    required,
  };
};

/** One provider's auth methods, arranged for a surface that asks for one decision at a time. */
export const describeMethods = (provider: Descriptor): DescribedMethods => {
  const described = provider.methods.map<DescribedMethod>((method) => ({
    descriptor: method,
    fields: fieldsOf(method),
    kind: method.kind,
  }));
  const interactive = described.filter((method) => method.fields === null);
  const typed = described.filter((method) => method.fields !== null);
  return { alternate: interactive.length > 0 && typed.length > 0, interactive, typed };
};

/**
 * The one field a rejected command was about, if any. A provider that turns down credentials is
 * answering the secret it was given, and it names no field, so the first secret carries the
 * answer; anything else is about the request rather than one input.
 */
export const rejectedField = (
  error: DomainKit.Error | null,
  fields: ReadonlyArray<Field>,
): string | null => {
  if (error === null) return null;
  const reason = error.reason;
  if (reason._tag === "InvalidInput") {
    return fields.find((field) => field.name === reason.field)?.name ?? null;
  }
  if (reason._tag !== "Unauthenticated" && reason._tag !== "Forbidden") return null;
  return fields.find((field) => field.secret)?.name ?? null;
};

/** Whether a failure was raised by this provider's method, so the form answers beside it. */
export const attempted = (
  controller: Controller,
  provider: string,
  method: Storage.AuthMethod,
): DomainKit.Error | null => {
  const state = controller.state;
  if (state._tag !== "Failure" || state.attempt === null) return null;
  return state.attempt.provider === provider && state.attempt.method === method
    ? state.error
    : null;
};
