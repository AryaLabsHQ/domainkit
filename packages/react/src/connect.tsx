import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { DomainKitError, Storage } from "domainkit";
import { Transport } from "domainkit/client";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";

import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit } from "./domain-kit.tsx";
import { Event } from "./events.ts";
import { useIcons } from "./icons.tsx";
import { failure as describeFailure } from "./messages.ts";
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
  Loading: {};
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
  Failure: { readonly error: DomainKitError.DomainKitError };
}>;
export const State = Data.taggedEnum<State>();

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
}

const snapshotOf = (state: State): Snapshot | null => {
  switch (state._tag) {
    case "Connected":
    case "Reconnect":
    case "Disconnected":
      return state.snapshot;
    case "Submitting":
    case "SelectionRequired":
      return state.snapshot;
    case "Loading":
    case "Redirecting":
    case "Failure":
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
export function useController({ domain }: Options): Controller {
  const { emit, navigate, revision, transport } = useDomainKit();
  const connection = transport.connection;
  const runner = useRunner();
  const [state, setState] = useState<State>(State.Loading());
  const held = useRef<{ snapshot: Snapshot | null; discovery: Discovery | null }>({
    discovery: null,
    snapshot: null,
  });
  const lastCommand = useRef<(() => void) | null>(null);

  const onFailure = useCallback(
    (error: DomainKitError.DomainKitError) => {
      setState(State.Failure({ error }));
      emit(Event.Failed({ domain, error }));
    },
    [domain, emit],
  );

  const load = useCallback(() => {
    if (connection === undefined) return;
    lastCommand.current = null;
    setState(State.Loading());
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
          held.current = { discovery, snapshot };
          setState(settled(snapshot, discovery));
        },
      },
    );
  }, [connection, domain, onFailure, runner]);

  useEffect(load, [load, revision]);

  const started = useCallback(
    (result: Transport.Started) => {
      switch (result._tag) {
        case "Connected":
          held.current = { discovery: null, snapshot: result.snapshot };
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
    (effect: Effect.Effect<Transport.Started, DomainKitError.DomainKitError>) => {
      const command = () => {
        setState(State.Submitting({ snapshot: held.current.snapshot }));
        runner.run(effect, { onFailure, onSuccess: started });
      };
      lastCommand.current = command;
      command();
    },
    [onFailure, runner, started],
  );

  const connect = useCallback(
    (input: ConnectInput) => {
      if (connection === undefined) return;
      const returnTo = input.returnTo;
      const method =
        input.method === "token"
          ? Transport.Method.token(input.values ?? {})
          : input.method === "oauth"
            ? Transport.Method.oauth(returnTo === undefined ? {} : { returnTo })
            : Transport.Method.integration(returnTo === undefined ? {} : { returnTo });
      submit(connection.start({ domain, method, provider: input.provider }));
    },
    [connection, domain, submit],
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
    (effect: Effect.Effect<void, DomainKitError.DomainKitError>, event: Event) => {
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
      lastCommand.current = command;
      command();
    },
    [emit, load, onFailure, runner],
  );

  const detach = useCallback(() => {
    const attachmentId = held.current.snapshot?.attachmentId;
    if (connection === undefined || attachmentId === undefined || attachmentId === null) return;
    release(connection.detach(attachmentId), Event.Detached({ domain }));
  }, [connection, domain, release]);

  const disconnect = useCallback(() => {
    const connectionId = held.current.snapshot?.connectionId;
    if (connection === undefined || connectionId === undefined || connectionId === null) return;
    release(connection.disconnect(connectionId), Event.Disconnected({ connectionId, domain }));
  }, [connection, domain, release]);

  const retry = useCallback(() => {
    const command = lastCommand.current;
    if (command === null) load();
    else command();
  }, [load]);

  return {
    connect,
    detach,
    disconnect,
    discovery: state._tag === "Disconnected" ? state.discovery : held.current.discovery,
    providers: snapshotOf(state)?.providers ?? held.current.snapshot?.providers ?? [],
    refresh: load,
    retry,
    reuse,
    select,
    snapshot: snapshotOf(state) ?? held.current.snapshot,
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

export interface OutcomeProps extends PartProps<"p", RootState> {
  readonly controller: Controller;
}

/** The failure sentence, chosen by `DomainKitError.reason`, plus the retry the reason allows. */
export function Outcome({ controller, ...props }: OutcomeProps): ReactElement | null {
  const { messages } = useDomainKit();
  const state = controller.state;
  const element = usePart(
    "p",
    props,
    { status: state._tag },
    {
      children:
        state._tag === "Failure" ? (
          <>
            {describeFailure(state.error, messages)}{" "}
            <button data-domainkit-part="connection-retry" onClick={controller.retry} type="button">
              {messages.retry}
            </button>
          </>
        ) : null,
      "data-domainkit-part": "flow-outcome",
      "data-tone": "danger",
      role: "alert",
    },
  );
  return state._tag === "Failure" ? element : null;
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

interface MethodProps {
  readonly controller: Controller;
  readonly method: MethodDescriptor;
  readonly provider: Descriptor;
}

/**
 * One auth method, rendered from its descriptor. A token method draws an input per declared
 * field, so a provider that needs an account id alongside a token needs no code here.
 */
function Method({ controller, method, provider }: MethodProps): ReactElement {
  const { messages } = useDomainKit();
  const icons = useIcons();
  const busy = controller.state._tag === "Submitting";
  if (method.fields === null) {
    return (
      <button
        data-domainkit-part={method.kind === "oauth" ? "oauth-connect" : "integration-connect"}
        data-provider={provider.id}
        disabled={busy}
        onClick={() => controller.connect({ method: method.kind, provider: provider.id })}
        type="button"
      >
        {messages.connectWith(method.label)}
      </button>
    );
  }
  const fields = method.fields;
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
      {fields.map((field) => (
        <label data-domainkit-part="token-field" key={field.name}>
          <span data-domainkit-part="token-field-label">
            {messages.fieldLabel(field.name)}
            {field.required ? null : (
              <span data-domainkit-part="token-field-optional">{messages.optionalField}</span>
            )}
          </span>
          <input
            autoComplete="off"
            data-domainkit-part="token-field-input"
            name={field.name}
            required={field.required}
            type={field.secret ? "password" : "text"}
          />
        </label>
      ))}
      {method.docsUrl === null ? null : (
        <a data-domainkit-part="token-docs" href={method.docsUrl} rel="noreferrer" target="_blank">
          {messages.getToken}
          <span aria-hidden="true" data-icon="inline-end">
            {icons.external}
          </span>
        </a>
      )}
      <button data-domainkit-part="token-submit" disabled={busy} type="submit">
        {messages.connectWith(method.label)}
      </button>
    </form>
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
          ) : (
            providers.map((provider) => (
              <section data-domainkit-part="provider-authentication" key={provider.id}>
                <div data-domainkit-part="provider-heading">
                  <Provider.Mark provider={provider} />
                  <strong>{provider.name}</strong>
                </div>
                {provider.methods.map((method) => (
                  <Method
                    controller={controller}
                    key={`${provider.id}:${method.kind}`}
                    method={method}
                    provider={provider}
                  />
                ))}
              </section>
            ))
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
  const [open, setOpen] = useState(false);
  const busy = controller.state._tag === "Submitting";
  const snapshot = controller.snapshot;
  const provider = snapshot?.provider;
  const heading =
    title ??
    (provider === null || provider === undefined
      ? messages.connectAnyTitle
      : messages.connectTitle(provider));
  const body = children ?? <Form controller={controller} />;
  if (render !== undefined) {
    return (
      <>
        <button
          data-domainkit-part="connection-trigger"
          onClick={() => setOpen(!open)}
          type="button"
        >
          {trigger ?? messages.connect}
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
        {trigger ?? messages.connect}
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
            <Status controller={controller} />
            {body}
            <Outcome controller={controller} />
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

export interface CardProps extends PartProps<"div", RootState> {
  readonly controller: Controller;
}

/** A connected domain: which provider holds it, and how to let it go. */
export function Card({ controller, ...props }: CardProps): ReactElement {
  const { messages } = useDomainKit();
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
          <Outcome controller={controller} />
        </>
      ),
      "data-domainkit-part": "connected-card",
    },
  );
}

export interface FlowProps extends Omit<RootProps, "controller"> {
  readonly domain: string;
}

/** Connection on its own: the card once connected, the dialog until then. */
export function Flow({ domain, ...props }: FlowProps): ReactElement {
  const controller = useController({ domain });
  const state = controller.state;
  return (
    <Root controller={controller} {...props}>
      {state._tag === "Connected" ? (
        <Card controller={controller} />
      ) : (
        <>
          <Dialog controller={controller} />
          <Outcome controller={controller} />
        </>
      )}
    </Root>
  );
}
