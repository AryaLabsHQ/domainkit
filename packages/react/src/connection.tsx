import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Transport } from "domainkit";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import {
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type FormEvent,
  type ReactNode,
} from "react";

import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit } from "./domain-kit.tsx";
import * as Provider from "./provider.tsx";
import { failureFromDefect, failureFromError, type Failure } from "./atom.ts";

type LocalState = Data.TaggedEnum<{
  Loading: {};
  Redirecting: { readonly snapshot: Disconnected };
  Submitting: { readonly snapshot: Disconnected };
}>;
export const State = Data.taggedEnum<LocalState>();
export type State = LocalState | Transport.ConnectionSnapshot | Failure;

type Disconnected = Extract<Transport.ConnectionSnapshot, { readonly _tag: "Disconnected" }>;

export interface Controller {
  readonly connect: (method: Transport.Method) => void;
  readonly retry: () => void;
  readonly reuse: () => void;
  readonly state: State;
}

export type Command = Data.TaggedEnum<{
  Connect: { readonly method: Transport.Method };
  Retry: {};
  Reuse: {};
}>;
export const Command = Data.taggedEnum<Command>();

export interface Model {
  readonly command: Atom.AtomResultFn<Command, void>;
  readonly state: Atom.Atom<State>;
}

export function useModel(domain: string): Model {
  const { navigate, runtime } = useDomainKit();
  return useMemo(() => {
    const actionState = Atom.make<State | undefined>(undefined);
    const inspect = runtime.atom(
      Effect.flatMap(Transport.Service, (transport) => transport.connection.inspect({ domain })),
    );
    const state = Atom.make((get): State => {
      const action = get(actionState);
      if (action !== undefined) return action;
      const inspection = get(inspect);
      return AsyncResult.matchWithError(inspection, {
        onDefect: () => failureFromDefect("connection.inspect", "Provider detection failed"),
        onError: failureFromError,
        onInitial: () => State.Loading(),
        onSuccess: ({ value }) => value,
      });
    });
    const command = runtime.fn<Command>()((input, get) => {
      if (input._tag === "Retry") {
        get.set(actionState, undefined);
        get.refresh(inspect);
        return Effect.void;
      }
      const snapshot = get(state);
      if (snapshot._tag !== "Disconnected") return Effect.void;
      const reusableConnection = snapshot.reusableConnection;
      if (input._tag === "Reuse" && reusableConnection === undefined) return Effect.void;
      get.set(actionState, State.Submitting({ snapshot }));
      const complete = (
        request: Effect.Effect<Transport.ConnectionResult, Transport.Failure, Transport.Service>,
      ) =>
        request.pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              if (result._tag === "Redirect") {
                get.set(actionState, State.Redirecting({ snapshot }));
                navigate(result.authorizationUrl);
              } else {
                get.set(actionState, result);
              }
            }),
          ),
          Effect.catch((error) => Effect.sync(() => get.set(actionState, failureFromError(error)))),
          Effect.asVoid,
        );
      if (input._tag === "Connect") {
        return complete(
          Effect.flatMap(Transport.Service, (transport) =>
            transport.connection.connect({
              domain,
              method: input.method,
              providerId: snapshot.provider.id,
            }),
          ),
        );
      }
      if (reusableConnection === undefined) return Effect.void;
      return complete(
        Effect.flatMap(Transport.Service, (transport) =>
          transport.connection.reuse({ connectionId: reusableConnection.connectionId, domain }),
        ),
      );
    });
    return { command, state };
  }, [domain, navigate, runtime]);
}

export function useController(domain: string): Controller {
  const model = useModel(domain);
  const state = useAtomValue(model.state);
  const execute = useAtomSet(model.command);

  return {
    connect: (method) => execute(Command.Connect({ method })),
    retry: () => execute(Command.Retry()),
    reuse: () => execute(Command.Reuse()),
    state,
  };
}

export interface RootState extends Record<string, unknown> {
  readonly status: State["_tag"];
}

export interface RootProps extends PartProps<"div", RootState> {
  readonly status?: State["_tag"];
}

export function Root({ children, status = "Loading", ...props }: RootProps) {
  return usePart(
    "div",
    props,
    { status },
    {
      children,
      "data-domainkit-part": "connection-root",
    },
  );
}

export interface StatusState extends Record<string, unknown> {
  readonly status: State["_tag"];
}

export interface StatusProps extends PartProps<"div", StatusState> {
  readonly state: State;
}

export function Status({ children, state, ...props }: StatusProps) {
  const { messages } = useDomainKit();
  const text =
    state._tag === "Loading"
      ? messages.detectingProvider
      : state._tag === "Connected"
        ? messages.connected(state.provider.name)
        : state._tag === "Unsupported"
          ? messages.automaticUnavailable
          : state._tag === "Failure"
            ? state.message
            : state._tag === "Redirecting"
              ? messages.openingAuthorization
              : state._tag === "Submitting"
                ? messages.connecting
                : messages.providerAvailable(state.provider.name);
  return usePart(
    "div",
    props,
    { status: state._tag },
    {
      children: children ?? text,
      "data-domainkit-part": "connection-status",
      "data-state": state._tag,
    },
  );
}

export interface TriggerProps extends Omit<
  ComponentPropsWithoutRef<typeof BaseDialog.Trigger>,
  "children"
> {
  readonly children: ReactNode;
}

export interface ConnectTriggerProps extends Omit<TriggerProps, "children"> {
  readonly children?: ReactNode;
  readonly provider: Provider.Provider;
}

export function Trigger({ children, ...props }: TriggerProps) {
  return (
    <BaseDialog.Trigger data-domainkit-part="connection-trigger" {...props}>
      {children}
    </BaseDialog.Trigger>
  );
}

export function ConnectTrigger({ children, provider, ...props }: ConnectTriggerProps) {
  const { messages } = useDomainKit();
  return (
    <Trigger {...props} data-domainkit-recipe="connect">
      {children ?? (
        <>
          <Provider.Mark aria-hidden="true" provider={provider} />
          {messages.connectProvider(provider.name)}
        </>
      )}
    </Trigger>
  );
}

export interface ActionState extends Record<string, unknown> {
  readonly authentication: "oauth" | "reuse" | "token";
}

export interface OAuthActionProps extends PartProps<"button", ActionState> {
  readonly controller: Controller;
  readonly label: string;
}

export function OAuthAction({ controller, label, ...props }: OAuthActionProps) {
  return usePart(
    "button",
    props,
    { authentication: "oauth" },
    {
      children: label,
      "data-domainkit-part": "oauth-connect",
      onClick: () => controller.connect(Transport.Method.OAuth()),
      type: "button",
    },
  );
}

export interface ReuseActionProps extends PartProps<"button", ActionState> {
  readonly controller: Controller;
  readonly label: string;
}

export function ReuseAction({ controller, label, ...props }: ReuseActionProps) {
  return usePart(
    "button",
    props,
    { authentication: "reuse" },
    {
      children: label,
      "data-domainkit-part": "reuse-connection",
      onClick: () => void controller.reuse(),
      type: "button",
    },
  );
}

export interface TokenActionProps extends Omit<PartProps<"form", ActionState>, "method"> {
  readonly controller: Controller;
  readonly method: Extract<Transport.AuthenticationMethod, { readonly _tag: "Token" }>;
}

export function TokenAction({ controller, method, ...props }: TokenActionProps) {
  const { messages } = useDomainKit();
  const [token, setToken] = useState("");
  const [parameters, setParameters] = useState<Readonly<Record<string, string>>>({});
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (token.length > 0) {
      const populated = Object.fromEntries(
        Object.entries(parameters).filter(([, value]) => value.length > 0),
      );
      controller.connect(
        Transport.Method.Token({
          token,
          ...(Object.keys(populated).length === 0 ? {} : { parameters: populated }),
        }),
      );
    }
  };
  const missingRequiredParameter = method.parameters?.some(
    (parameter) => parameter.required === true && !parameters[parameter.key],
  );
  return usePart(
    "form",
    props,
    { authentication: "token" },
    {
      children: (
        <>
          {method.parameters?.map((parameter) => (
            <label key={parameter.key}>
              {parameter.label}
              <input
                name={parameter.key}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setParameters((current) => ({
                    ...current,
                    [parameter.key]: value,
                  }));
                }}
                placeholder={parameter.placeholder}
                required={parameter.required}
                type="text"
                value={parameters[parameter.key] ?? ""}
              />
              {parameter.description === undefined ? null : <small>{parameter.description}</small>}
            </label>
          ))}
          <label>
            {messages.tokenLabel}
            <input
              autoComplete="off"
              name="token"
              onChange={(event) => setToken(event.currentTarget.value)}
              placeholder={method.placeholder}
              type="password"
              value={token}
            />
          </label>
          <button disabled={token.length === 0 || missingRequiredParameter === true} type="submit">
            {method.label}
          </button>
        </>
      ),
      "data-domainkit-part": "token-connect",
      onSubmit: submit,
    },
  );
}

export interface DialogProps {
  readonly controller: Controller;
  readonly snapshot: Disconnected;
}

export function Dialog({ controller, snapshot }: DialogProps) {
  const { colorScheme, messages, portalContainer, themeStyle } = useDomainKit();
  return (
    <BaseDialog.Portal container={portalContainer}>
      <BaseDialog.Backdrop data-domainkit-part="dialog-backdrop" />
      <BaseDialog.Popup
        data-domainkit-part="connection-dialog"
        data-domainkit-root=""
        data-color-scheme={colorScheme}
        style={themeStyle}
      >
        <div data-domainkit-part="dialog-header">
          <Provider.Mark provider={snapshot.provider} />
          <div data-domainkit-part="dialog-heading">
            <BaseDialog.Title data-domainkit-part="dialog-title">
              {messages.dialogTitle(snapshot.provider.name)}
            </BaseDialog.Title>
            <BaseDialog.Description data-domainkit-part="dialog-description">
              {messages.dialogDescription(snapshot.domain)}
            </BaseDialog.Description>
          </div>
          <BaseDialog.Close aria-label={messages.close} data-domainkit-part="dialog-close">
            ×
          </BaseDialog.Close>
        </div>
        <div data-domainkit-part="dialog-body">
          {snapshot.provider.authentication.map((method) =>
            method._tag === "OAuth" ? (
              <OAuthAction controller={controller} key={method._tag} label={method.label} />
            ) : null,
          )}
          {snapshot.reusableConnection === undefined ? null : (
            <ReuseAction
              controller={controller}
              label={messages.reuseConnection(snapshot.reusableConnection.label)}
            />
          )}
          {snapshot.provider.authentication.map((method) =>
            method._tag === "Token" ? (
              <TokenAction controller={controller} key={method._tag} method={method} />
            ) : null,
          )}
        </div>
        <div data-domainkit-part="dialog-footer">
          <BaseDialog.Close data-domainkit-part="dialog-cancel">{messages.cancel}</BaseDialog.Close>
        </div>
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

export interface FlowProps extends Omit<RootProps, "children"> {
  readonly domain: string;
}

export function Flow({ domain, ...props }: FlowProps) {
  const controller = useController(domain);
  const state = controller.state;
  const snapshot =
    state._tag === "Disconnected"
      ? state
      : state._tag === "Submitting" || state._tag === "Redirecting"
        ? state.snapshot
        : undefined;
  return (
    <Root {...props} status={state._tag}>
      <Status state={state} />
      {state._tag === "Failure" && state.retry !== "never" ? (
        <RetryAction
          controller={controller}
          kind={state.retry === "after-user-action" ? "after-user-action" : "retry"}
        />
      ) : null}
      {snapshot === undefined ? null : (
        <BaseDialog.Root>
          <ConnectTrigger provider={snapshot.provider} />
          <Dialog controller={controller} snapshot={snapshot} />
        </BaseDialog.Root>
      )}
    </Root>
  );
}

export interface RetryActionProps extends PartProps<"button", { readonly status: "Failure" }> {
  readonly controller: Controller;
  readonly kind?: "after-user-action" | "retry";
}

export function RetryAction({ controller, kind = "retry", ...props }: RetryActionProps) {
  const { messages } = useDomainKit();
  return usePart(
    "button",
    props,
    { status: "Failure" },
    {
      children: kind === "after-user-action" ? messages.checkAgain : messages.retry,
      "data-domainkit-part": "connection-retry",
      onClick: controller.retry,
      type: "button",
    },
  );
}

type LocalDisconnectState = Data.TaggedEnum<{
  Disconnecting: {};
  Idle: {};
}>;
export const DisconnectState = Data.taggedEnum<LocalDisconnectState>();
export type DisconnectState = LocalDisconnectState | Transport.RemoveDomainResult | Failure;

export function useDisconnect(connection: Transport.Connected) {
  const { runtime } = useDomainKit();
  const controller = useMemo(() => {
    const state = Atom.make<DisconnectState>(DisconnectState.Idle());
    const disconnect = runtime.fn<void>()((_, get) => {
      get.set(state, DisconnectState.Disconnecting());
      return Effect.flatMap(Transport.Service, (transport) =>
        transport.connection.removeDomain({
          connectionId: connection.connectionId,
          domain: connection.domain,
          preserveDns: true,
        }),
      ).pipe(
        Effect.tap((result) => Effect.sync(() => get.set(state, result))),
        Effect.catch((error) => Effect.sync(() => get.set(state, failureFromError(error)))),
        Effect.asVoid,
      );
    });
    return { disconnect, state };
  }, [connection.connectionId, connection.domain, runtime]);
  const state = useAtomValue(controller.state);
  const disconnect = useAtomSet(controller.disconnect);
  return { disconnect: () => disconnect(), state } as const;
}

export interface DisconnectActionProps extends PartProps<
  "div",
  { readonly status: DisconnectState["_tag"] }
> {
  readonly connection: Transport.Connected;
}

export function DisconnectAction({ connection, ...props }: DisconnectActionProps) {
  const controller = useDisconnect(connection);
  const { messages } = useDomainKit();
  const state = controller.state;
  return usePart(
    "div",
    props,
    { status: state._tag },
    {
      children: (
        <>
          {state._tag === "Removed" ? (
            <p data-domainkit-part="flow-outcome" data-tone="success">
              {messages.domainDisconnected}
            </p>
          ) : null}
          {state._tag === "Failure" ? (
            <p data-domainkit-part="flow-outcome" data-tone="danger" role="alert">
              {state.message}
            </p>
          ) : null}
          {state._tag === "Removed" ? null : (
            <button
              data-domainkit-part="disconnect-action"
              disabled={state._tag === "Disconnecting"}
              onClick={() => void controller.disconnect()}
              type="button"
            >
              {state._tag === "Disconnecting" ? messages.disconnecting : messages.disconnectDomain}
            </button>
          )}
        </>
      ),
      "data-domainkit-part": "disconnect",
    },
  );
}

export type Connected = Transport.Connected;
