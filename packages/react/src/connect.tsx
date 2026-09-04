import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { Receipt, type DomainKit, type Plan, type Storage } from "domainkit";
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

import * as Cleanup from "./cleanup.tsx";
import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit, useReadOnly } from "./domain-kit.tsx";
import { Event } from "./events.ts";
import { useIcons } from "./icons.tsx";
import { outcome as describeOutcome } from "./messages.ts";
import * as OutcomeUi from "./outcome.tsx";
import * as Operations from "./operations.tsx";
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
        case "Connected":
          held.current = { discovery: null, domain, snapshot: result.snapshot };
          setEstablished((count) => count + 1);
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
    [domain, emit, navigate],
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
    domain,
    established,
    discovery:
      state._tag === "Disconnected" || state._tag === "Failure" || state._tag === "Submitting"
        ? state.discovery
        : null,
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
 * Whether the surface should read as connected: it is, or a command it started is in flight over a
 * connection that was. The card and the dialog it opened stay on screen for the length of the
 * command rather than vanishing under the customer half way through it.
 */
export const holdsConnection = (controller: Controller): boolean =>
  controller.state._tag === "Connected" ||
  (controller.state._tag === "Submitting" && controller.snapshot?.status === "connected");

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
  const attached = controller.snapshot?.provider ?? null;
  const provider = attached === null ? "" : displayName(controller, attached);
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
  /** Record one field's value with the form, which owns it across a rejection. */
  readonly onEnter: (name: string, value: string) => void;
  readonly values: Readonly<Record<string, string>>;
}

interface FieldProps {
  readonly controller: Controller;
  readonly docsUrl: string | null;
  readonly field: Field;
  readonly invalid: boolean;
  readonly onEnter: (value: string) => void;
  readonly value: string;
}

/**
 * One declared field in shadcn's `Field` anatomy: the label, the control, the note under it, and
 * the error the provider answered with. The docs link rides the field it explains. The value is
 * the form's, not the input's, so a rejection answers beside what the customer typed.
 */
function TokenField({
  controller,
  docsUrl,
  field,
  invalid,
  onEnter,
  value,
}: FieldProps): ReactElement {
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
        onChange={(event) => onEnter(event.target.value)}
        required={field.required}
        type={field.secret ? "password" : "text"}
        value={value}
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
function Method({ controller, method, onEnter, provider, values }: MethodProps): ReactElement {
  const { messages } = useDomainKit();
  const icons = useIcons();
  // The fields a provider does not need, and whether the customer asked for them.
  const [more, setMore] = useState(false);
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
  // A rejection about one of them opens the panel, so the answer is never behind a closed control.
  const showMore = more || optional.some((field) => field.name === answered);
  // The docs link explains the secret, so it rides that field rather than the form.
  const explains = (required.find((field) => field.secret) ?? required[0] ?? optional[0])?.name;
  const render = (field: Field) => (
    <TokenField
      controller={controller}
      docsUrl={field.name === explains ? method.docsUrl : null}
      field={field}
      invalid={field.name === answered}
      key={field.name}
      onEnter={(value) => onEnter(field.name, value)}
      value={values[field.name] ?? ""}
    />
  );
  return (
    <form
      data-domainkit-part="token-connect"
      data-provider={provider.id}
      onSubmit={(event) => {
        event.preventDefault();
        // The form's own values, not the inputs': they are what survives a rejection.
        const submitted: Record<string, string> = {};
        for (const field of fields) {
          const value = values[field.name] ?? "";
          if (value !== "" || field.required) submitted[field.name] = value;
        }
        controller.connect({ method: method.kind, provider: provider.id, values: submitted });
      }}
    >
      {required.map(render)}
      {optional.length === 0 ? null : (
        <BaseCollapsible.Root
          data-domainkit-part="more-options"
          data-state={showMore ? "open" : "closed"}
          onOpenChange={setMore}
          open={showMore}
        >
          <BaseCollapsible.Trigger data-domainkit-part="more-options-trigger">
            {messages.moreOptions}
            <span aria-hidden="true" data-icon="inline-end">
              {icons.chevron}
            </span>
          </BaseCollapsible.Trigger>
          <BaseCollapsible.Panel data-domainkit-part="more-options-panel">
            {optional.map(render)}
          </BaseCollapsible.Panel>
        </BaseCollapsible.Root>
      )}
      {failed && answered === null ? <Outcome controller={controller} layout="inline" /> : null}
      <button data-domainkit-part="token-submit" disabled={busy} type="submit">
        {messages.methodToken}
      </button>
    </form>
  );
}

interface AuthenticationProps extends Pick<MethodProps, "onEnter" | "values"> {
  readonly controller: Controller;
  readonly provider: Descriptor;
  /** Whether this provider's methods are showing. A narrowed dialog has one, always open. */
  readonly open: boolean;
  readonly onOpen?: () => void;
  /** Show the token form alone: the customer asked for it and the surface navigated there. */
  readonly typing: boolean;
  /** Ask for the token form. Absent when this surface cannot navigate to one. */
  readonly onType?: () => void;
}

/**
 * One provider's methods, in the order the descriptor declares them: the interactive ones a
 * customer clicks through, then the token. Where a provider offers both, the interactive method is
 * the offer and a plain button opens the token form in its place, so the dialog asks for one
 * decision at a time. With a heading the whole provider is a disclosure the customer opens; the
 * provider a narrowed dialog is about carries no heading, because the dialog title already names
 * it.
 */
function Authentication({
  controller,
  onEnter,
  onOpen,
  onType,
  open,
  provider,
  typing,
  values,
}: AuthenticationProps): ReactElement {
  const { messages } = useDomainKit();
  const state = controller.state;
  const render = (method: MethodDescriptor) => (
    <Method
      controller={controller}
      key={`${provider.id}:${method.kind}`}
      method={method}
      onEnter={onEnter}
      provider={provider}
      values={values}
    />
  );
  const interactive = provider.methods.filter((method) => method.fields === null);
  const typed = provider.methods.filter((method) => method.fields !== null);
  const alternate = interactive.length > 0 && typed.length > 0;
  const methods = !alternate ? (
    provider.methods.map(render)
  ) : typing ? (
    typed.map(render)
  ) : (
    <>
      {interactive.map(render)}
      <button
        data-domainkit-part="method-alternate"
        data-provider={provider.id}
        disabled={state._tag === "Submitting"}
        onClick={onType}
        type="button"
      >
        {messages.useTokenInstead}
      </button>
    </>
  );
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
  /**
   * Narrow to this provider whatever discovery found. The dialog's header menu sets it, so a
   * customer who picks another provider gets the same one-decision surface for it.
   */
  readonly provider?: string;
}

/**
 * Everything a disconnected domain can do: a connection discovery already found, the connections
 * this owner already has, then each provider's declared methods.
 */
export function Form({ controller, provider: narrowed, ...props }: FormProps): ReactElement {
  const { messages } = useDomainKit();
  // One provider open at a time, so a dialog listing every provider is a list rather than a wall.
  // `null` is the customer choosing nothing yet; `""` is them closing what was open.
  const [opened, setOpened] = useState<string | null>(null);
  // What the customer typed, for the one domain and provider they typed it into. A rejection keeps
  // it, so "try again" starts from the value rather than from nothing. Another provider's form is
  // its own, a connection that lands is a form nobody needs again, and a credential never follows
  // the flow to another domain.
  const [entered, setEntered] = useState<{
    readonly domain: string;
    readonly provider: string;
    readonly values: Readonly<Record<string, string>>;
  } | null>(null);
  const state = controller.state;
  const owner = controller.domain;
  // Dropped while rendering, not one effect later, so no frame ever shows one domain's token in
  // another's form.
  if (entered !== null && (entered.domain !== owner || state._tag === "Connected")) {
    setEntered(null);
  }
  const kept = entered?.domain === owner ? entered : null;
  const enter = (provider: string, name: string, value: string) =>
    setEntered((previous) => {
      const held = previous?.domain === owner && previous.provider === provider ? previous : null;
      return {
        domain: owner,
        provider,
        values: held === null ? { [name]: value } : { ...held.values, [name]: value },
      };
    });
  const valuesFor = (provider: string): Readonly<Record<string, string>> =>
    kept?.provider === provider ? kept.values : {};
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
  // The provider the surface is about: the one a header menu chose, else the one that serves the
  // zone. A known host is the whole offer; without one every provider is listed.
  const host = providers.find((entry) => entry.id === narrowed) ?? hostProvider(controller);
  // Which provider's token form the customer navigated to, so the body is one decision at a time.
  const [typing, setTyping] = useState<string | null>(null);
  const authentication = (provider: Descriptor, open: boolean) => (
    <Authentication
      controller={controller}
      key={provider.id}
      onEnter={(name, value) => enter(provider.id, name, value)}
      onOpen={() => setOpened(open ? "" : provider.id)}
      onType={() => setTyping(provider.id)}
      open={open}
      provider={provider}
      typing={typing === provider.id}
      values={valuesFor(provider.id)}
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
            providers.map((provider) =>
              authentication(
                provider,
                opened === null ? provider.id === providers[0]?.id : opened === provider.id,
              ),
            )
          ) : (
            <>
              {typing === host.id ? (
                <button
                  data-domainkit-part="dialog-back"
                  onClick={() => setTyping(null)}
                  type="button"
                >
                  {messages.back}
                </button>
              ) : null}
              <Authentication
                controller={controller}
                onEnter={(name, value) => enter(host.id, name, value)}
                onType={() => setTyping(host.id)}
                open
                provider={host}
                typing={typing === host.id}
                values={valuesFor(host.id)}
              />
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
  const icons = useIcons();
  const readOnly = useReadOnly();
  const [open, setOpen] = useState(false);
  const state = controller.state;
  const busy = state._tag === "Submitting";
  // A failure a method already answers is not repeated at the foot of the dialog.
  const unattributed = state._tag === "Failure" && !answeredInPlace(controller);
  const snapshot = controller.snapshot;
  // The provider the dialog is about: one the customer picked from the header, else the one
  // already attached, else the one that serves the zone.
  const [chosen, setChosen] = useState<string | null>(null);
  const attached = snapshot?.provider ?? null;
  const host = hostProvider(controller);
  const narrowed = controller.providers.find((entry) => entry.id === (chosen ?? attached)) ?? host;
  const named = narrowed?.name ?? null;
  const heading =
    title ?? (named === null ? messages.connectAnyTitle : messages.connectTitle(named));
  // Every other provider the owner could use instead. With none there is nothing to choose from.
  const alternatives =
    narrowed === null ? [] : controller.providers.filter((entry) => entry.id !== narrowed.id);
  const running =
    state._tag === "Loading" ||
    state._tag === "Submitting" ||
    state._tag === "Redirecting" ||
    state._tag === "SelectionRequired";
  // A named provider makes the trigger a short "Connect"; without one it says what it opens.
  const label = named === null ? messages.connectAnyTitle : messages.connect;
  const body = children ?? (
    <Form controller={controller} {...(chosen === null ? {} : { provider: chosen })} />
  );
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
            {narrowed === null ? null : (
              <div data-domainkit-part="dialog-media">
                <Provider.Mark provider={narrowed} />
              </div>
            )}
            <div data-domainkit-part="dialog-heading">
              <BaseDialog.Title data-domainkit-part="dialog-title">
                {alternatives.length === 0 || title !== undefined ? (
                  heading
                ) : (
                  <BaseMenu.Root>
                    <BaseMenu.Trigger data-domainkit-part="dialog-provider-menu" disabled={busy}>
                      {heading}
                      <span aria-hidden="true" data-icon="inline-end">
                        {icons.chevron}
                      </span>
                    </BaseMenu.Trigger>
                    <BaseMenu.Portal container={portalContainer}>
                      <BaseMenu.Positioner
                        align="start"
                        data-domainkit-part="provider-menu-positioner"
                        sideOffset={6}
                      >
                        <BaseMenu.Popup
                          aria-label={messages.useAnotherProvider}
                          data-color-scheme={colorScheme}
                          data-domainkit-part="provider-menu"
                          data-domainkit-root=""
                          style={themeStyle}
                        >
                          {alternatives.map((entry) => (
                            <BaseMenu.Item
                              data-domainkit-part="provider-menu-item"
                              data-provider={entry.id}
                              key={entry.id}
                              onClick={() => setChosen(entry.id)}
                            >
                              <Provider.Mark provider={entry} />
                              {entry.name}
                            </BaseMenu.Item>
                          ))}
                        </BaseMenu.Popup>
                      </BaseMenu.Positioner>
                    </BaseMenu.Portal>
                  </BaseMenu.Root>
                )}
              </BaseDialog.Title>
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

/**
 * Whether the flow offers a connect surface: only when discovery names a host, always, or never.
 * `never` is a host that decides for itself, such as a domain already ready without DomainKit; a
 * connected domain keeps its status and its disconnect either way.
 */
export type Invitation = "always" | "detected" | "never";

/**
 * Whether the connect surface has anything to offer for this domain: a provider that serves the
 * zone, a connection discovery already found, one the owner already holds, or a command already
 * running. Never while a connection is held, which is what `holdsConnection` answers. `Prompt`
 * renders on this, and `Domain.Flow` reports it so a host can order its own offers beside
 * DomainKit's rather than competing with them.
 */
export const offering = (controller: Controller, connect: Invitation = "detected"): boolean => {
  // A surface that holds a connection is not offering one: the card is what renders, and a host
  // reading both must never see them claim different things about the same domain.
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

export interface PromptProps extends PartProps<"div", RootState> {
  readonly controller: Controller;
  /**
   * `detected` offers nothing when discovery names no host, which is the honest answer for a
   * domain DomainKit cannot write to. `always` offers the all-providers dialog anyway, and
   * `never` offers none.
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
  if (!offering(controller, connect)) return null;
  // Read-only keeps the statement and drops the trigger, like every other write surface.
  if (readOnly && host === null) return null;
  return element;
}

/** The plan an attempt holds, whatever step it is on; `null` before there is one. */
const planOf = (state: Cleanup.State): Plan.Model | null => {
  switch (state._tag) {
    case "Planned":
    case "Approving":
    case "Applying":
    case "Rejecting":
    case "Rejected":
      return state.plan;
    case "Applied":
      return state.plan;
    case "Idle":
    case "Planning":
    case "Failure":
      return null;
  }
};

export interface DisconnectDialogProps {
  readonly controller: Controller;
  /** The receipt the cleanup this dialog ran produced, for a host that tracks its own state. */
  readonly onCleaned?: (receipt: Receipt.Model) => void;
  readonly trigger?: ReactNode;
}

/**
 * Letting a provider go, with the records DomainKit added as one decision rather than two.
 * Confirming removes what the domain's apply receipt proves DomainKit created, then releases the
 * connection; a plan with nothing in it is not a failure, so it goes straight to the release.
 *
 * The cleanup is this dialog's own, so nothing re-reads the snapshot in between: the disconnect
 * needs the connection the cleanup just used.
 */
export function DisconnectDialog({
  controller,
  onCleaned,
  trigger,
}: DisconnectDialogProps): ReactElement {
  const { capabilities, colorScheme, messages, portalContainer, themeStyle } = useDomainKit();
  const readOnly = useReadOnly();
  const [open, setOpen] = useState(false);
  const [alsoRemove, setAlsoRemove] = useState(true);
  // The first of the two commands the confirm runs. The second is the controller's own.
  const [removing, setRemoving] = useState(false);
  const snapshot = controller.snapshot;
  const receiptId = snapshot?.lastReceiptId ?? null;
  // Only an apply receipt proves DomainKit created anything, so only then is there a choice. The
  // receipt is this domain's, so releasing a shared connection leaves the other domains' records
  // where they are; the option says so rather than promising more than it can do.
  const removable = capabilities.includes("cleanup") && receiptId !== null;
  // Releasing a connection takes every domain on it, so a shared one asks which the customer meant.
  const shared = (snapshot?.connectionDomains ?? 0) > 1;
  const [everyDomain, setEveryDomain] = useState(false);
  const cleanup = Cleanup.useController({
    domain: controller.domain,
    ...(onCleaned === undefined ? {} : { onCleaned }),
    ...(receiptId === null ? {} : { receiptId: Receipt.ReceiptId.make(receiptId) }),
  });
  const { approve, plan, state: cleaning } = cleanup;
  // The plan is built when the dialog opens, not when the customer confirms, so what would be
  // removed is on screen while they decide rather than after.
  const removals = planOf(cleaning);
  useEffect(() => {
    if (open && removable && cleaning._tag === "Idle") plan();
  }, [cleaning, open, plan, removable]);
  const detach = controller.detach;
  const release = controller.disconnect;
  // A shared connection detaches this domain by default; only "all domains" ends the connection.
  const disconnect = useCallback(
    () => (shared && !everyDomain ? detach() : release()),
    [detach, everyDomain, release, shared],
  );
  // The release is the controller's own command, so its state says whether one is in flight; a
  // failure ends it and hands the button back with no bookkeeping here.
  const releasing = controller.state._tag === "Submitting";

  useEffect(() => {
    if (!removing) return;
    if (cleaning._tag === "Applied") {
      setRemoving(false);
      disconnect();
      return;
    }
    if (cleaning._tag === "Failure" || cleaning._tag === "Rejected") setRemoving(false);
  }, [cleaning, disconnect, removing]);

  const busy = removing || releasing;
  // Until the plan lands there is nothing to decide over, and a confirm taken now would release
  // the connection without the removal the option defaults to.
  const settling = removable && (cleaning._tag === "Idle" || cleaning._tag === "Planning");
  const provider = snapshot?.provider ?? null;
  const named = provider === null ? "" : displayName(controller, provider);
  const heading = provider === null ? messages.disconnect : messages.disconnectTitle(named);
  // Nothing to remove is not a choice: the switch appears over records, or not at all.
  const count = removals?.operations.length ?? 0;
  const choosable = removable && count > 0;
  if (readOnly) return <></>;
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
      <BaseDialog.Trigger data-domainkit-part="disconnect-action">
        {trigger ?? messages.disconnect}
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
          data-domainkit-part="disconnect-dialog"
          data-domainkit-root=""
          style={themeStyle}
        >
          <div data-domainkit-part="dialog-header">
            <div data-domainkit-part="dialog-heading">
              <BaseDialog.Title data-domainkit-part="dialog-title">{heading}</BaseDialog.Title>
              <BaseDialog.Description data-domainkit-part="dialog-description">
                {messages.disconnectConsent(snapshot?.domain ?? "", named)}
              </BaseDialog.Description>
            </div>
            {busy ? null : (
              <BaseDialog.Close aria-label={messages.close} data-domainkit-part="dialog-close">
                ×
              </BaseDialog.Close>
            )}
          </div>
          <div data-domainkit-part="dialog-body">
            {shared ? (
              <fieldset data-domainkit-part="disconnect-scope">
                <legend>{messages.disconnectScope}</legend>
                <label>
                  <input
                    checked={!everyDomain}
                    disabled={busy}
                    name="disconnect-scope"
                    onChange={() => setEveryDomain(false)}
                    type="radio"
                  />
                  {messages.disconnectThisDomain}
                </label>
                <label>
                  <input
                    checked={everyDomain}
                    disabled={busy}
                    name="disconnect-scope"
                    onChange={() => setEveryDomain(true)}
                    type="radio"
                  />
                  {messages.disconnectEveryDomain(snapshot?.connectionDomains ?? 0)}
                </label>
              </fieldset>
            ) : null}
            {choosable ? (
              <div data-domainkit-part="disconnect-cleanup" data-state={alsoRemove ? "on" : "off"}>
                <label data-domainkit-part="disconnect-cleanup-label">
                  <BaseSwitch.Root
                    checked={alsoRemove}
                    data-domainkit-part="disconnect-cleanup-switch"
                    disabled={busy}
                    onCheckedChange={setAlsoRemove}
                  >
                    <BaseSwitch.Thumb data-domainkit-part="disconnect-cleanup-thumb" />
                  </BaseSwitch.Root>
                  {messages.disconnectWithCleanup(count)}
                </label>
                <div data-domainkit-part="disconnect-cleanup-panel">
                  {removals === null ? null : <Operations.List plan={removals} />}
                  {alsoRemove ? null : (
                    <p data-domainkit-part="disconnect-cleanup-note">
                      {messages.disconnectKeepsRecords(named)}
                    </p>
                  )}
                </div>
              </div>
            ) : null}
            <Cleanup.Status controller={cleanup} />
            {releasing ? (
              <p data-domainkit-part="disconnect-status" role="status">
                {messages.disconnecting}
              </p>
            ) : null}
            <Cleanup.Outcome controller={cleanup} />
            <Outcome controller={controller} />
          </div>
          <div data-domainkit-part="dialog-footer">
            <button
              data-domainkit-part="disconnect-confirm"
              disabled={busy || settling}
              onClick={() => {
                if (choosable && alsoRemove) {
                  setRemoving(true);
                  approve();
                  return;
                }
                disconnect();
              }}
              type="button"
            >
              {messages.disconnect}
            </button>
            {busy ? null : (
              <BaseDialog.Close data-domainkit-part="dialog-cancel">
                {messages.cancel}
              </BaseDialog.Close>
            )}
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export interface CardProps extends PartProps<"div", RootState> {
  readonly controller: Controller;
  /** The receipt a cleanup run from the disconnect dialog produced. */
  readonly onCleaned?: (receipt: Receipt.Model) => void;
}

/**
 * A connected domain, with the prompt card's anatomy: the provider's mark, the name the customer
 * knows it by, where the connection stands, and the one action that ends it.
 */
export function Card({ controller, onCleaned, ...props }: CardProps): ReactElement {
  const { messages } = useDomainKit();
  const readOnly = useReadOnly();
  const state = controller.state;
  const snapshot = controller.snapshot;
  const provider = controller.providers.find((entry) => entry.id === snapshot?.provider);
  const standing = state._tag === "Reconnect" ? messages.needsReconnect : messages.connected;
  return usePart(
    "div",
    props,
    { status: state._tag },
    {
      children: (
        <>
          <div data-domainkit-part="connected-identity">
            {provider === undefined ? null : <Provider.Mark provider={provider} />}
            <span data-domainkit-part="host-name">
              {provider?.name ?? snapshot?.provider ?? ""}
            </span>
            <span data-domainkit-part="host-statement">{standing}</span>
          </div>
          {readOnly ? null : (
            <div data-domainkit-part="connected-actions">
              <DisconnectDialog
                controller={controller}
                {...(onCleaned === undefined ? {} : { onCleaned })}
              />
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
  /** The receipt a cleanup run from the disconnect dialog produced. */
  readonly onCleaned?: (receipt: Receipt.Model) => void;
}

/** Connection on its own: the card once connected, the prompt until then. */
export function Flow({ connect, domain, onCleaned, returnTo, ...props }: FlowProps): ReactElement {
  const controller = useController({ domain, ...(returnTo === undefined ? {} : { returnTo }) });
  return (
    <Root controller={controller} {...props}>
      {holdsConnection(controller) ? (
        <Card controller={controller} {...(onCleaned === undefined ? {} : { onCleaned })} />
      ) : (
        <>
          <Prompt controller={controller} {...(connect === undefined ? {} : { connect })} />
          {answeredInPlace(controller) ? null : <Outcome controller={controller} />}
        </>
      )}
    </Root>
  );
}
