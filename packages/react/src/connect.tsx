import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { DomainKit, Storage } from "domainkit";
import { Transport } from "domainkit/client";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit, useReadOnly } from "./domain-kit.tsx";
import { Event } from "./events.ts";
import { useIcons } from "./icons.tsx";
import { outcome as describeOutcome } from "./messages.ts";
import * as OutcomeUi from "./outcome.tsx";
import * as Provider from "./provider.tsx";
import { useRunner } from "./task.ts";

export type Snapshot = Transport.Snapshot;
export type Discovery = Transport.Discovery;
export type Candidate = Transport.Candidate;
export type Descriptor = Provider.Descriptor;
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
  Submitting: { readonly snapshot: Snapshot | null };
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
}

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
export function useController({ domain, returnTo }: Options): Controller {
  const { emit, navigate, revision, transport } = useDomainKit();
  const readOnly = useReadOnly();
  const connection = transport.connection;
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
        case "Connected":
          held.current = { discovery: null, domain, snapshot: result.snapshot };
          setState(settled(result.snapshot, null));
          if (result.snapshot.connectionId !== null) {
            emit(
              Event.Connected({
                connectionId: result.snapshot.connectionId,
                domain,
                snapshot: result.snapshot,
              }),
            );
          }
          return;
        case "Redirect":
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
    [domain, emit, navigate],
  );

  const submit = useCallback(
    (effect: Effect.Effect<Transport.Started, DomainKit.Error>, attempt: Attempt | null) => {
      if (held.current.domain !== domain) return;
      attempted.current = attempt;
      const command = () => {
        setState(State.Submitting({ snapshot: held.current.snapshot }));
        runner.run(effect, { onFailure, onSuccess: started });
      };
      lastCommand.current = { domain, run: command };
      command();
    },
    [domain, onFailure, runner, started],
  );

  const connect = useCallback(
    (input: ConnectInput) => {
      if (connection === undefined) return;
      const destination = input.returnTo ?? (returnTo === undefined ? currentUrl() : returnTo);
      const interactive = destination === null ? {} : { returnTo: destination };
      const method =
        input.method === "token"
          ? Transport.Method.token(input.values ?? {})
          : input.method === "oauth"
            ? Transport.Method.oauth(interactive)
            : Transport.Method.integration(interactive);
      submit(connection.start({ domain, method, provider: input.provider }), {
        method: input.method,
        provider: input.provider,
      });
    },
    [connection, domain, returnTo, submit],
  );

  const reuse = useCallback(
    (input: { readonly connectionId: string; readonly zone?: string }) => {
      if (connection === undefined) return;
      submit(
        connection.attach({
          connectionId: input.connectionId,
          domain,
          ...(input.zone === undefined ? {} : { zone: input.zone }),
        }),
        null,
      );
    },
    [connection, domain, submit],
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
        setState(State.Submitting({ snapshot: held.current.snapshot }));
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
    const attachmentId = held.current.snapshot?.attachmentId;
    if (connection === undefined || attachmentId == null || held.current.domain !== domain) return;
    release(connection.detach(attachmentId), Event.Detached({ domain }));
  }, [connection, domain, release]);

  const disconnect = useCallback(() => {
    const connectionId = held.current.snapshot?.connectionId;
    if (connection === undefined || connectionId == null || held.current.domain !== domain) return;
    release(connection.disconnect(connectionId), Event.Disconnected({ connectionId, domain }));
  }, [connection, domain, release]);

  const retry = useCallback(() => {
    const command = lastCommand.current;
    // Re-inspecting is a read, so it stays; rerunning the last write does not.
    if (readOnly || command === null || command.domain !== domain) load();
    else command.run();
  }, [domain, load, readOnly]);

  return {
    connect,
    detach,
    disconnect,
    discovery: state._tag === "Disconnected" || state._tag === "Failure" ? state.discovery : null,
    providers: snapshotOf(state)?.providers ?? [],
    refresh: load,
    retry,
    reuse,
    select,
    snapshot: snapshotOf(state),
    state,
  };
}

// ---------------------------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------------------------

export interface RootState extends Record<string, unknown> {
  readonly status: State["_tag"];
}

export interface RootProps extends PartProps<"div", RootState> {
  readonly controller: Controller;
}

export function Root({ controller, ...props }: RootProps): ReactElement {
  return usePart(
    "div",
    props,
    { status: controller.state._tag },
    { "data-domainkit-part": "connection-root", "data-state": controller.state._tag },
  );
}

/**
 * Whether a failure is already answered where it was raised: beside the method the customer used.
 * A flow rendering its own `Outcome` beside the dialog skips it, so the failure announces once.
 */
export const answeredInPlace = (controller: Controller): boolean =>
  controller.state._tag === "Failure" && controller.state.attempt !== null;

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

/** The provider as the customer knows it, falling back to the id when the snapshot has no name. */
const displayName = (controller: Controller, provider: string): string =>
  controller.providers.find((entry) => entry.id === provider)?.name ?? provider;

export interface OutcomeProps extends OutcomeUi.RootProps {
  readonly controller: Controller;
}

/**
 * The last failure as a card: media, the catalog's title and description, and the retry the flow
 * allows. Children replace the composition and keep the binding.
 */
export function Outcome({ children, controller, ...props }: OutcomeProps): ReactElement | null {
  const { messages } = useDomainKit();
  const readOnly = useReadOnly();
  const state = controller.state;
  if (state._tag !== "Failure") return null;
  // The reason names an id at best, and `Unauthenticated` names nothing: the flow knows which
  // provider the customer typed a token for, so it is the flow that supplies the name.
  const acted =
    state.attempt === null ? undefined : displayName(controller, state.attempt.provider);
  const words = describeOutcome(state.error, messages, {
    ...(controller.snapshot === null ? {} : { domain: controller.snapshot.domain }),
    ...(acted === undefined ? {} : { provider: acted }),
  });
  return (
    <OutcomeUi.Provider
      value={{
        description: words.description,
        layout: props.layout ?? "card",
        retry: readOnly ? null : controller.retry,
        retryPart: "connection-retry",
        title: words.title,
        tone: "danger",
      }}
    >
      <OutcomeUi.Root {...props}>{children ?? <OutcomeUi.Composition />}</OutcomeUi.Root>
    </OutcomeUi.Provider>
  );
}

export interface StatusProps extends PartProps<"p", RootState> {
  readonly controller: Controller;
}

export function Status({ controller, ...props }: StatusProps): ReactElement {
  const { messages } = useDomainKit();
  const state = controller.state;
  const provider = controller.snapshot?.provider ?? "";
  const text = (): string => {
    switch (state._tag) {
      case "Loading":
        return messages.loading;
      case "Submitting":
        return messages.connecting;
      case "Redirecting":
        return messages.redirecting;
      case "Connected":
        return messages.connectedTo(provider);
      case "Reconnect":
        return messages.reconnectRequired(provider);
      case "SelectionRequired":
        return messages.chooseZone;
      case "Disconnected":
        return messages.notConnected;
      case "Failure":
        return "";
    }
  };
  return usePart(
    "p",
    props,
    { status: state._tag },
    {
      children: text(),
      "data-domainkit-part": "connection-status",
      "data-state": state._tag,
      role: state._tag === "Submitting" || state._tag === "Loading" ? "status" : undefined,
    },
  );
}

/**
 * The one field a rejected command was about, if any. A provider that turns down credentials is
 * answering the secret it was given, and it names no field, so the first secret carries the
 * answer; anything else is about the request rather than one input.
 */
const rejected = (
  reason: DomainKit.Error["reason"] | null,
  fields: ReadonlyArray<Field>,
): string | null => {
  if (reason === null) return null;
  if (reason._tag === "InvalidInput") {
    return fields.find((field) => field.name === reason.field)?.name ?? null;
  }
  if (reason._tag !== "Unauthenticated" && reason._tag !== "Forbidden") return null;
  return fields.find((field) => field.secret)?.name ?? null;
};

interface MethodProps {
  readonly controller: Controller;
  readonly method: MethodDescriptor;
  readonly provider: Descriptor;
}

interface FieldProps {
  readonly controller: Controller;
  readonly docsUrl: string | null;
  readonly field: Field;
  readonly invalid: boolean;
}

/**
 * One declared field in shadcn's `Field` anatomy: the label, the control, the note under it, and
 * the error the provider answered with. The docs link rides the field it explains.
 */
function TokenField({ controller, docsUrl, field, invalid }: FieldProps): ReactElement {
  const { messages } = useDomainKit();
  const icons = useIcons();
  const id = useId();
  return (
    <div
      data-domainkit-part="field"
      data-invalid={invalid ? "" : undefined}
      data-orientation="vertical"
    >
      <label data-domainkit-part="field-label" htmlFor={id}>
        {messages.fieldLabel(field.name)}
        {field.required ? null : (
          <span data-domainkit-part="field-optional">{messages.optionalField}</span>
        )}
      </label>
      <input
        aria-invalid={invalid ? true : undefined}
        autoComplete="off"
        data-domainkit-part="field-input"
        id={id}
        name={field.name}
        required={field.required}
        type={field.secret ? "password" : "text"}
      />
      {docsUrl === null ? null : (
        <a data-domainkit-part="field-description" href={docsUrl} rel="noreferrer" target="_blank">
          {messages.getToken}
          <span aria-hidden="true" data-icon="inline-end">
            {icons.external}
          </span>
        </a>
      )}
      {invalid ? (
        <div data-domainkit-part="field-error">
          <Outcome controller={controller} layout="inline" />
        </div>
      ) : null}
    </div>
  );
}

/**
 * One auth method, rendered from its descriptor. A token method draws an input per declared
 * field, so a provider that needs an account id alongside a token needs no code here. The fields
 * a provider does not need sit behind a disclosure, so the common form is one field.
 */
function Method({ controller, method, provider }: MethodProps): ReactElement {
  const { messages } = useDomainKit();
  const state = controller.state;
  const busy = state._tag === "Submitting";
  // A failed command answers where it was raised, so the customer keeps the form they filled in.
  const failed =
    state._tag === "Failure" &&
    state.attempt !== null &&
    state.attempt.provider === provider.id &&
    state.attempt.method === method.kind;
  if (method.fields === null) {
    return (
      <>
        <button
          data-domainkit-part={method.kind === "oauth" ? "oauth-connect" : "integration-connect"}
          data-provider={provider.id}
          disabled={busy}
          onClick={() => controller.connect({ method: method.kind, provider: provider.id })}
          type="button"
        >
          {method.kind === "oauth"
            ? messages.methodOAuth(provider.name)
            : messages.methodIntegration(provider.name)}
        </button>
        {failed ? <Outcome controller={controller} layout="inline" /> : null}
      </>
    );
  }
  const fields = method.fields;
  const answered = rejected(failed && state._tag === "Failure" ? state.error.reason : null, fields);
  const required = fields.filter((field) => field.required);
  const optional = fields.filter((field) => !field.required);
  // The docs link explains the secret, so it rides that field rather than the form.
  const explains = (required.find((field) => field.secret) ?? required[0] ?? optional[0])?.name;
  const render = (field: Field) => (
    <TokenField
      controller={controller}
      docsUrl={field.name === explains ? method.docsUrl : null}
      field={field}
      invalid={field.name === answered}
      key={field.name}
    />
  );
  return (
    <form
      data-domainkit-part="token-connect"
      data-provider={provider.id}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const values: Record<string, string> = {};
        for (const field of fields) {
          const value = data.get(field.name);
          if (typeof value === "string" && (value !== "" || field.required)) {
            values[field.name] = value;
          }
        }
        controller.connect({ method: method.kind, provider: provider.id, values });
      }}
    >
      {required.map(render)}
      {optional.length === 0 ? null : (
        <details
          data-domainkit-part="more-options"
          open={optional.some((field) => field.name === answered) || undefined}
        >
          <summary data-domainkit-part="more-options-trigger">{messages.moreOptions}</summary>
          {optional.map(render)}
        </details>
      )}
      {failed && answered === null ? <Outcome controller={controller} layout="inline" /> : null}
      <button data-domainkit-part="token-submit" disabled={busy} type="submit">
        {messages.methodToken}
      </button>
    </form>
  );
}

interface AuthenticationProps {
  readonly controller: Controller;
  readonly provider: Descriptor;
  /** Whether this provider's methods are showing. A narrowed dialog has one, always open. */
  readonly open: boolean;
  readonly onOpen?: () => void;
}

/**
 * One provider's methods. With a heading it is a disclosure the customer opens; the provider a
 * narrowed dialog is about carries no heading, because the dialog title already names it.
 */
function Authentication({ controller, onOpen, open, provider }: AuthenticationProps): ReactElement {
  const methods = provider.methods.map((method) => (
    <Method
      controller={controller}
      key={`${provider.id}:${method.kind}`}
      method={method}
      provider={provider}
    />
  ));
  return (
    <section
      data-domainkit-part="provider-authentication"
      data-provider={provider.id}
      data-state={open ? "open" : "closed"}
    >
      {onOpen === undefined ? null : (
        <button
          aria-expanded={open}
          data-domainkit-part="provider-heading"
          onClick={onOpen}
          type="button"
        >
          <Provider.Mark provider={provider} />
          <strong>{provider.name}</strong>
        </button>
      )}
      {open ? methods : null}
    </section>
  );
}

export interface FormProps extends PartProps<"div", RootState> {
  readonly controller: Controller;
}

/**
 * Everything a disconnected domain can do: a connection discovery already found, the connections
 * this owner already has, then each provider's declared methods.
 */
export function Form({ controller, ...props }: FormProps): ReactElement {
  const { messages } = useDomainKit();
  // One provider open at a time, so a dialog listing every provider is a list rather than a wall.
  // `null` is the customer choosing nothing yet; `""` is them closing what was open.
  const [opened, setOpened] = useState<string | null>(null);
  const state = controller.state;
  const snapshot = controller.snapshot;
  const discovery = controller.discovery;
  const candidates =
    state._tag === "SelectionRequired"
      ? state.candidates.map((candidate) => ({ ...candidate, connectionId: state.connectionId }))
      : discovery !== null && discovery._tag === "SelectionRequired"
        ? discovery.candidates
        : [];
  const resolved = discovery !== null && discovery._tag === "Resolved" ? discovery : null;
  const reusable = snapshot?.reusable ?? [];
  const providers = controller.providers;
  // A known host is the whole offer; the rest wait behind a disclosure.
  const host = hostProvider(controller);
  const others = providers.filter((provider) => provider.id !== host?.id);
  const authentication = (provider: Descriptor, open: boolean) => (
    <Authentication
      controller={controller}
      key={provider.id}
      onOpen={() => setOpened(open ? "" : provider.id)}
      open={open}
      provider={provider}
    />
  );
  return usePart(
    "div",
    props,
    { status: state._tag },
    {
      children: (
        <>
          {resolved === null ? null : (
            <section data-domainkit-part="discovery-resolved">
              <p>{messages.discoveredConnection(resolved.label)}</p>
              <button
                data-domainkit-part="attach-target"
                onClick={() =>
                  controller.reuse({
                    connectionId: resolved.connectionId,
                    zone: resolved.zone,
                  })
                }
                type="button"
              >
                {messages.useConnection(resolved.label)}
              </button>
            </section>
          )}
          {candidates.length === 0 ? null : (
            <section data-domainkit-part="discovery-candidates">
              <p>
                {state._tag === "SelectionRequired"
                  ? messages.chooseZone
                  : messages.discoveryAmbiguous}
              </p>
              <div data-domainkit-part="target-list" data-state="ambiguous">
                {candidates.map((candidate) => (
                  <button
                    data-domainkit-part="attach-target"
                    key={`${candidate.connectionId}:${candidate.zone}`}
                    onClick={() =>
                      controller.reuse({
                        connectionId: candidate.connectionId,
                        zone: candidate.zone,
                      })
                    }
                    type="button"
                  >
                    {messages.useConnection(candidate.label)}
                  </button>
                ))}
              </div>
            </section>
          )}
          {reusable.length === 0 ? null : (
            <section data-domainkit-part="reusable-connection">
              <div data-domainkit-part="reusable-connection-heading">
                <strong>{messages.reusableConnections}</strong>
              </div>
              {reusable.map((connection) => (
                <button
                  data-connection-id={connection.connectionId}
                  data-domainkit-part="attach-target"
                  key={connection.connectionId}
                  onClick={() => controller.reuse({ connectionId: connection.connectionId })}
                  type="button"
                >
                  {messages.useConnection(connection.provider)}
                </button>
              ))}
            </section>
          )}
          {providers.length === 0 ? (
            <p data-domainkit-part="target-unavailable">{messages.noProviders}</p>
          ) : host === null ? (
            others.map((provider) =>
              authentication(
                provider,
                opened === null ? provider.id === others[0]?.id : opened === provider.id,
              ),
            )
          ) : (
            <>
              <Authentication controller={controller} open provider={host} />
              {others.length === 0 ? null : (
                <details data-domainkit-part="other-providers">
                  <summary data-domainkit-part="other-providers-trigger">
                    {messages.useAnotherProvider}
                  </summary>
                  {others.map((provider) => authentication(provider, opened === provider.id))}
                </details>
              )}
            </>
          )}
        </>
      ),
      "data-domainkit-part": "connection-form",
    },
  );
}

export interface DialogProps {
  readonly controller: Controller;
  readonly children?: ReactNode;
  /** Replace the dialog surface: a drawer, a panel, whatever the host already has. */
  readonly render?: (props: { readonly open: boolean; readonly children: ReactNode }) => ReactNode;
  readonly title?: ReactNode;
  readonly trigger?: ReactNode;
}

/** The connect surface. Without `render` it is a Base UI dialog behind `trigger`. */
export function Dialog({
  children,
  controller,
  render,
  title,
  trigger,
}: DialogProps): ReactElement {
  const { colorScheme, messages, portalContainer, themeStyle } = useDomainKit();
  const readOnly = useReadOnly();
  const [open, setOpen] = useState(false);
  const state = controller.state;
  const busy = state._tag === "Submitting";
  // A failure a method already answers is not repeated at the foot of the dialog.
  const unattributed = state._tag === "Failure" && !answeredInPlace(controller);
  const snapshot = controller.snapshot;
  // The provider the dialog is about: the one already attached, else the one that serves the zone.
  const attached = snapshot?.provider ?? null;
  const host = hostProvider(controller);
  const named = attached === null ? (host?.name ?? null) : displayName(controller, attached);
  const heading =
    title ?? (named === null ? messages.connectAnyTitle : messages.connectTitle(named));
  const running =
    state._tag === "Loading" ||
    state._tag === "Submitting" ||
    state._tag === "Redirecting" ||
    state._tag === "SelectionRequired";
  // A named provider makes the trigger a short "Connect"; without one it says what it opens.
  const label = named === null ? messages.connectAnyTitle : messages.connect;
  const body = children ?? <Form controller={controller} />;
  // Connecting is a write, so the whole surface goes rather than a disabled trigger.
  if (readOnly) return <></>;
  if (render !== undefined) {
    return (
      <>
        <button
          data-domainkit-part="connection-trigger"
          onClick={() => setOpen(!open)}
          type="button"
        >
          {trigger ?? label}
        </button>
        {render({ children: body, open })}
      </>
    );
  }
  return (
    <BaseDialog.Root
      onOpenChange={(next, details) => {
        if (!next && busy) {
          details.cancel();
          return;
        }
        setOpen(next);
      }}
      open={open}
    >
      <BaseDialog.Trigger data-domainkit-part="connection-trigger">
        {trigger ?? label}
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
              <BaseDialog.Title data-domainkit-part="dialog-title">{heading}</BaseDialog.Title>
              <BaseDialog.Description data-domainkit-part="dialog-description">
                {messages.connectDescription(snapshot?.domain ?? "")}
              </BaseDialog.Description>
            </div>
            {busy ? null : (
              <BaseDialog.Close aria-label={messages.close} data-domainkit-part="dialog-close">
                ×
              </BaseDialog.Close>
            )}
          </div>
          <div data-domainkit-part="dialog-body">
            {/* The title and description already say what is connected; this line is progress. */}
            {running ? <Status controller={controller} /> : null}
            {body}
            {unattributed ? <Outcome controller={controller} /> : null}
          </div>
          {busy ? null : (
            <div data-domainkit-part="dialog-footer">
              <BaseDialog.Close data-domainkit-part="dialog-cancel">
                {messages.cancel}
              </BaseDialog.Close>
            </div>
          )}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

/** Whether the flow offers a connect surface when discovery names no host. */
export type Invitation = "always" | "detected";

export interface PromptProps extends PartProps<"div", RootState> {
  readonly controller: Controller;
  /**
   * `detected` offers nothing when discovery names no host, which is the honest answer for a
   * domain DomainKit cannot write to. `always` offers the all-providers dialog anyway.
   */
  readonly connect?: Invitation;
}

/**
 * The disconnected offer: the provider whose nameservers serve the domain, what that means, and
 * the trigger that connects it. With no host detected there is nothing to offer, so nothing
 * renders unless the host application asks for the dialog anyway.
 */
export function Prompt({
  connect = "detected",
  controller,
  ...props
}: PromptProps): ReactElement | null {
  const { messages } = useDomainKit();
  const readOnly = useReadOnly();
  const state = controller.state;
  const host = hostProvider(controller);
  const discovery = controller.discovery;
  // Something to offer: the provider that serves the zone, a connection discovery already found,
  // or one this owner holds. With none of them there is no invitation, and none while it loads.
  const offers =
    host !== null ||
    (discovery !== null && discovery._tag !== "NotFound") ||
    (controller.snapshot?.reusable.length ?? 0) > 0;
  // A command in flight owns the surface whatever discovery found: it is how the customer answers
  // a zone choice, a reconnect, or a redirect that came back.
  const inFlight =
    state._tag === "Submitting" ||
    state._tag === "Redirecting" ||
    state._tag === "SelectionRequired" ||
    state._tag === "Reconnect";
  const element = usePart(
    "div",
    props,
    { status: state._tag },
    {
      children: (
        <>
          {host === null ? null : (
            <div data-domainkit-part="host-identity">
              <Provider.Mark provider={host} />
              <span data-domainkit-part="host-name">{host.name}</span>
              <span data-domainkit-part="host-statement">{messages.hostOwnsZone}</span>
            </div>
          )}
          <Dialog controller={controller} />
        </>
      ),
      "data-domainkit-part": "connect-prompt",
      "data-host": host?.id,
    },
  );
  if (!inFlight && !offers && connect !== "always") return null;
  // Read-only keeps the statement and drops the trigger, like every other write surface.
  if (readOnly && host === null) return null;
  return element;
}

export interface CardProps extends PartProps<"div", RootState> {
  readonly controller: Controller;
}

/** A connected domain: which provider holds it, and how to let it go. */
export function Card({ controller, ...props }: CardProps): ReactElement {
  const { messages } = useDomainKit();
  const readOnly = useReadOnly();
  const state = controller.state;
  const snapshot = controller.snapshot;
  const provider = controller.providers.find((entry) => entry.id === snapshot?.provider);
  return usePart(
    "div",
    props,
    { status: state._tag },
    {
      children: (
        <>
          <div data-domainkit-part="connected-identity">
            {provider === undefined ? null : <Provider.Mark provider={provider} />}
            <Status controller={controller} />
          </div>
          {readOnly ? null : (
            <div data-domainkit-part="connected-actions">
              <button
                data-domainkit-part="disconnect-trigger"
                disabled={state._tag === "Submitting"}
                onClick={controller.detach}
                type="button"
              >
                {messages.detach}
              </button>
              <button
                data-domainkit-part="disconnect-action"
                disabled={state._tag === "Submitting"}
                onClick={controller.disconnect}
                type="button"
              >
                {messages.disconnect}
              </button>
            </div>
          )}
          <Outcome controller={controller} />
        </>
      ),
      "data-domainkit-part": "connected-card",
    },
  );
}

export interface FlowProps extends Omit<RootProps, "controller"> {
  readonly domain: string;
  readonly returnTo?: string | null;
  /** Offer the connect dialog even when discovery names no host. Defaults to `detected`. */
  readonly connect?: Invitation;
}

/** Connection on its own: the card once connected, the prompt until then. */
export function Flow({ connect, domain, returnTo, ...props }: FlowProps): ReactElement {
  const controller = useController({ domain, ...(returnTo === undefined ? {} : { returnTo }) });
  const state = controller.state;
  return (
    <Root controller={controller} {...props}>
      {state._tag === "Connected" ? (
        <Card controller={controller} />
      ) : (
        <>
          <Prompt controller={controller} {...(connect === undefined ? {} : { connect })} />
          {answeredInPlace(controller) ? null : <Outcome controller={controller} />}
        </>
      )}
    </Root>
  );
}
