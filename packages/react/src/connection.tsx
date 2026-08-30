import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Transport } from "domainkit";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Atom from "effect/unstable/reactivity/Atom";
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
import { failureFromCause } from "./atom.ts";

export type State =
  | { readonly _tag: "Loading" }
  | Transport.ConnectionSnapshot
  | Transport.Failure
  | { readonly _tag: "Submitting"; readonly snapshot: Disconnected }
  | { readonly _tag: "Redirecting"; readonly snapshot: Disconnected };

type Disconnected = Extract<Transport.ConnectionSnapshot, { readonly _tag: "Disconnected" }>;

export interface Controller {
  readonly connect: (method: Transport.Method) => void;
  readonly retry: () => void;
  readonly reuse: () => void;
  readonly state: State;
}

type Command = Data.TaggedEnum<{
  Connect: { readonly method: Transport.Method; readonly snapshot: Disconnected };
  Reuse: { readonly connectionId: string; readonly snapshot: Disconnected };
}>;
const Command = Data.taggedEnum<Command>();

export function useController(domain: string): Controller {
  const { navigate, runtime } = useDomainKit();
  const controller = useMemo(() => {
    const actionState = Atom.make<State | undefined>(undefined);
    const inspect = runtime.atom(
      Effect.flatMap(Transport.Service, (transport) => transport.connection.inspect({ domain })),
    );
    const execute = runtime.fn<Command>()((command, get) => {
      get.set(actionState, { _tag: "Submitting", snapshot: command.snapshot });
      const request = Effect.flatMap(Transport.Service, (transport) =>
        command._tag === "Connect"
          ? transport.connection.connect({
              domain,
              method: command.method,
              providerId: command.snapshot.provider.id,
            })
          : transport.connection.reuse({ connectionId: command.connectionId, domain }),
      );
      return request.pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (result._tag === "Redirect") {
              get.set(actionState, { _tag: "Redirecting", snapshot: command.snapshot });
              navigate(result.authorizationUrl);
            } else {
              get.set(actionState, result);
            }
          }),
        ),
        Effect.catchCause((cause) =>
          Effect.sync(() =>
            get.set(
              actionState,
              failureFromCause(
                cause,
                command._tag === "Connect" ? "connection.connect" : "connection.reuse",
                "The connection request failed",
              ),
            ),
          ),
        ),
        Effect.asVoid,
      );
    });
    return { actionState, execute, inspect };
  }, [domain, navigate, runtime]);
  const inspection = useAtomValue(controller.inspect);
  const actionState = useAtomValue(controller.actionState);
  const setActionState = useAtomSet(controller.actionState);
  const execute = useAtomSet(controller.execute);
  const refresh = useAtomRefresh(controller.inspect);
  const state: State =
    actionState ??
    (inspection._tag === "Success"
      ? inspection.value
      : inspection._tag === "Failure"
        ? failureFromCause(inspection.cause, "connection.inspect", "Provider detection failed")
        : { _tag: "Loading" });

  return {
    connect: (method) => {
      if (state._tag === "Disconnected") execute(Command.Connect({ method, snapshot: state }));
    },
    retry: () => {
      setActionState(undefined);
      refresh();
    },
    reuse: () => {
      if (state._tag === "Disconnected" && state.reusableConnection !== undefined)
        execute(
          Command.Reuse({
            connectionId: state.reusableConnection.connectionId,
            snapshot: state,
          }),
        );
    },
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

export type DisconnectState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Disconnecting" }
  | Transport.RemoveDomainResult
  | Transport.Failure;

export function useDisconnect(connection: Transport.Connected) {
  const { runtime } = useDomainKit();
  const controller = useMemo(() => {
    const state = Atom.make<DisconnectState>({ _tag: "Idle" });
    const disconnect = runtime.fn<void>()((_, get) => {
      get.set(state, { _tag: "Disconnecting" });
      return Effect.flatMap(Transport.Service, (transport) =>
        transport.connection.removeDomain({
          connectionId: connection.connectionId,
          domain: connection.domain,
          preserveDns: true,
        }),
      ).pipe(
        Effect.tap((result) => Effect.sync(() => get.set(state, result))),
        Effect.catchCause((cause) =>
          Effect.sync(() =>
            get.set(
              state,
              failureFromCause(cause, "connection.removeDomain", "Disconnecting failed"),
            ),
          ),
        ),
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
