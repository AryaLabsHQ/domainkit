import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
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
  type ReactElement,
  type ReactNode,
} from "react";

import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit } from "./domain-kit.tsx";
import * as Provider from "./provider.tsx";
import { Event as LifecycleEvent } from "./lifecycle.ts";
import { failureFromDefect, failureFromError, type Failure } from "./atom.ts";

type LocalState = Data.TaggedEnum<{
  Detaching: { readonly snapshot: Transport.Connected };
  Loading: {};
  Redirecting: { readonly snapshot: Disconnected };
  Submitting: { readonly snapshot: Disconnected };
}>;
export const State = Data.taggedEnum<LocalState>();
export type State = LocalState | Transport.ConnectionSnapshot | Failure;

type Disconnected = Extract<Transport.ConnectionSnapshot, { readonly _tag: "Disconnected" }>;

const sameTarget = (left: Transport.ProviderTarget, right: Transport.ProviderTarget): boolean =>
  left.accountId === right.accountId &&
  left.accountKind === right.accountKind &&
  left.zoneId === right.zoneId &&
  left.zoneName === right.zoneName;

export interface Controller {
  readonly attach: (
    connection: Transport.ReusableConnection,
    target: Transport.ProviderTarget,
  ) => void;
  readonly connect: (method: Transport.Method) => void;
  readonly detach: () => void;
  readonly retry: () => void;
  readonly state: State;
}

export type Command = Data.TaggedEnum<{
  Attach: { readonly connectionId: string; readonly target: Transport.ProviderTarget };
  Connect: { readonly method: Transport.Method };
  Detach: {};
  Retry: {};
}>;
export const Command = Data.taggedEnum<Command>();

export interface Model {
  readonly command: Atom.AtomResultFn<Command, void>;
  readonly state: Atom.Atom<State>;
}

export function useModel(domain: string): Model {
  const { emit, navigate, runtime } = useDomainKit();
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
      if (input._tag === "Detach") {
        if (snapshot._tag !== "Connected") return Effect.void;
        get.set(actionState, State.Detaching({ snapshot }));
        return Effect.flatMap(Transport.Service, (transport) =>
          Effect.flatMap(
            transport.connection.detach({
              attachmentId: snapshot.attachment.id,
              preserveDns: true,
            }),
            (result) =>
              Effect.map(transport.connection.inspect({ domain }), (refreshed) => ({
                refreshed,
                result,
              })),
          ),
        ).pipe(
          Effect.tap(({ refreshed, result }) =>
            Effect.sync(() => {
              get.set(actionState, refreshed);
              emit(
                LifecycleEvent.DomainDetached({
                  connection: snapshot,
                  result,
                }),
              );
            }),
          ),
          Effect.catch((error) => Effect.sync(() => get.set(actionState, failureFromError(error)))),
          Effect.asVoid,
        );
      }
      if (snapshot._tag !== "Disconnected") return Effect.void;
      const complete = (
        request: Effect.Effect<Transport.ConnectionResult, Transport.Failure, Transport.Service>,
        source: "connect" | "attach",
      ) =>
        request.pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              if (result._tag === "Redirect") {
                get.set(actionState, State.Redirecting({ snapshot }));
                navigate(result.authorizationUrl);
              } else {
                get.set(actionState, result);
                emit(
                  LifecycleEvent.ConnectionEstablished({
                    connection: result,
                    source,
                  }),
                );
              }
            }),
          ),
          Effect.catch((error) => Effect.sync(() => get.set(actionState, failureFromError(error)))),
          Effect.asVoid,
        );
      if (input._tag === "Attach") {
        const reusableConnection = snapshot.reusableConnections.find(
          ({ connection }) => connection.id === input.connectionId,
        );
        if (reusableConnection === undefined) return Effect.void;
        const target = reusableConnection.targets.find((candidate) =>
          sameTarget(candidate, input.target),
        );
        if (target === undefined) return Effect.void;
        get.set(actionState, State.Submitting({ snapshot }));
        return complete(
          Effect.flatMap(Transport.Service, (transport) =>
            transport.connection.attach({
              connectionId: input.connectionId,
              domain,
              target,
            }),
          ),
          "attach",
        );
      }
      get.set(actionState, State.Submitting({ snapshot }));
      if (input._tag === "Connect") {
        return complete(
          Effect.flatMap(Transport.Service, (transport) =>
            transport.connection.connect({
              domain,
              method: input.method,
              providerId: snapshot.provider.id,
            }),
          ),
          "connect",
        );
      }
      return Effect.void;
    });
    return { command, state };
  }, [domain, emit, navigate, runtime]);
}

export function useController(domain: string): Controller {
  const model = useModel(domain);
  const state = useAtomValue(model.state);
  const execute = useAtomSet(model.command);

  return {
    attach: (connection, target) =>
      execute(Command.Attach({ connectionId: connection.connection.id, target })),
    connect: (method) => execute(Command.Connect({ method })),
    detach: () => execute(Command.Detach()),
    retry: () => execute(Command.Retry()),
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
        : state._tag === "Detaching"
          ? messages.detaching
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
  readonly authentication: "attach" | "integration" | "oauth" | "token";
}

export interface OAuthActionProps extends PartProps<"button", ActionState> {
  readonly controller: Controller;
  readonly label: string;
}

export function OAuthAction({ controller, label, ...props }: OAuthActionProps) {
  const pending = controller.state._tag === "Submitting" || controller.state._tag === "Redirecting";
  return usePart(
    "button",
    props,
    { authentication: "oauth" },
    {
      children: label,
      "data-domainkit-part": "oauth-connect",
      disabled: pending,
      onClick: () => controller.connect(Transport.Method.OAuth()),
      type: "button",
    },
  );
}

export interface IntegrationActionProps extends PartProps<"button", ActionState> {
  readonly controller: Controller;
  readonly label: string;
}

export function IntegrationAction({ controller, label, ...props }: IntegrationActionProps) {
  const pending = controller.state._tag === "Submitting" || controller.state._tag === "Redirecting";
  return usePart(
    "button",
    props,
    { authentication: "integration" },
    {
      children: label,
      "data-domainkit-part": "integration-connect",
      disabled: pending,
      onClick: () => controller.connect(Transport.Method.Integration()),
      type: "button",
    },
  );
}

export interface AttachActionProps extends PartProps<"button", ActionState> {
  readonly connection: Transport.ReusableConnection;
  readonly controller: Controller;
  readonly label: string;
  readonly target: Transport.ProviderTarget;
}

export function AttachAction({
  connection,
  controller,
  label,
  target,
  ...props
}: AttachActionProps) {
  const pending = controller.state._tag === "Submitting" || controller.state._tag === "Redirecting";
  return usePart(
    "button",
    props,
    { authentication: "attach" },
    {
      children: label,
      "data-domainkit-part": "attach-target",
      disabled: pending,
      onClick: () => controller.attach(connection, target),
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
  const pending = controller.state._tag === "Submitting" || controller.state._tag === "Redirecting";
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
                disabled={pending}
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
              disabled={pending}
              name="token"
              onChange={(event) => setToken(event.currentTarget.value)}
              placeholder={method.placeholder}
              type="password"
              value={token}
            />
          </label>
          <button
            disabled={pending || token.length === 0 || missingRequiredParameter === true}
            type="submit"
          >
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

export const targetLabel = (target: Transport.ProviderTarget): string =>
  `${target.evidence?.accountName ?? target.accountId} · ${target.zoneName}`;

export function Dialog({ controller, snapshot }: DialogProps) {
  const { colorScheme, messages, portalContainer, themeStyle } = useDomainKit();
  const pending = controller.state._tag === "Submitting" || controller.state._tag === "Redirecting";
  const integrationMethods = snapshot.provider.authentication.filter(
    (method): method is Extract<Transport.AuthenticationMethod, { readonly _tag: "Integration" }> =>
      method._tag === "Integration",
  );
  const oauthMethods = snapshot.provider.authentication.filter(
    (method): method is Extract<Transport.AuthenticationMethod, { readonly _tag: "OAuth" }> =>
      method._tag === "OAuth",
  );
  const tokenMethods = snapshot.provider.authentication.filter(
    (method): method is Extract<Transport.AuthenticationMethod, { readonly _tag: "Token" }> =>
      method._tag === "Token",
  );
  const hasProviderAccountPath =
    integrationMethods.length > 0 ||
    oauthMethods.length > 0 ||
    snapshot.reusableConnections.length > 0;
  return (
    <BaseDialog.Portal container={portalContainer}>
      <BaseDialog.Backdrop
        data-color-scheme={colorScheme}
        data-domainkit-part="dialog-backdrop"
        data-domainkit-root=""
        style={themeStyle}
      />
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
          {pending ? null : (
            <BaseDialog.Close aria-label={messages.close} data-domainkit-part="dialog-close">
              ×
            </BaseDialog.Close>
          )}
        </div>
        <div data-domainkit-part="dialog-body">
          {hasProviderAccountPath ? (
            <div data-domainkit-part="provider-authentication">
              {integrationMethods.map((method) => (
                <IntegrationAction controller={controller} key={method._tag} label={method.label} />
              ))}
              {oauthMethods.map((method) => (
                <OAuthAction controller={controller} key={method._tag} label={method.label} />
              ))}
              {snapshot.reusableConnections.map((connection) => (
                <section
                  data-connection-id={connection.connection.id}
                  data-domainkit-part="reusable-connection"
                  key={connection.connection.id}
                >
                  <div data-domainkit-part="reusable-connection-heading">
                    <strong>{messages.existingConnection}</strong>
                    <span>{connection.connection.providerId}</span>
                  </div>
                  <div
                    data-domainkit-part="target-list"
                    data-state={
                      connection.targets.length === 0
                        ? "unavailable"
                        : connection.targets.length === 1
                          ? "unique"
                          : "ambiguous"
                    }
                  >
                    {connection.targets.length === 0 ? (
                      <p data-domainkit-part="target-unavailable">{messages.targetUnavailable}</p>
                    ) : (
                      connection.targets.map((target) => (
                        <AttachAction
                          connection={connection}
                          controller={controller}
                          key={`${target.accountId}:${target.zoneId}`}
                          label={messages.attachTarget(targetLabel(target))}
                          target={target}
                        />
                      ))
                    )}
                  </div>
                </section>
              ))}
            </div>
          ) : null}
          {hasProviderAccountPath && tokenMethods.length > 0 ? (
            <div
              aria-label={messages.authenticationAlternative}
              data-domainkit-part="authentication-separator"
              role="separator"
            >
              <span aria-hidden="true">{messages.authenticationAlternative}</span>
            </div>
          ) : null}
          {tokenMethods.map((method) => (
            <TokenAction controller={controller} key={method._tag} method={method} />
          ))}
        </div>
        {pending ? null : (
          <div data-domainkit-part="dialog-footer">
            <BaseDialog.Close data-domainkit-part="dialog-cancel">
              {messages.cancel}
            </BaseDialog.Close>
          </div>
        )}
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
        <BaseDialog.Root
          onOpenChange={(open, eventDetails) => {
            if (!open && (state._tag === "Submitting" || state._tag === "Redirecting")) {
              eventDetails.cancel();
            }
          }}
        >
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

export interface CardProps extends PartProps<"div", { readonly status: State["_tag"] }> {
  readonly status: State["_tag"];
}

export function Card({ status, ...props }: CardProps) {
  return usePart(
    "div",
    props,
    { status },
    { "data-domainkit-part": "connected-card", "data-state": status },
  );
}

export interface CardIdentityProps extends PartProps<"div", { readonly status: State["_tag"] }> {
  readonly status: State["_tag"];
}

export function CardIdentity({ status, ...props }: CardIdentityProps) {
  return usePart(
    "div",
    props,
    { status },
    { "data-domainkit-part": "connected-identity", "data-state": status },
  );
}

export interface CardActionsProps extends PartProps<"div", { readonly status: State["_tag"] }> {
  readonly status: State["_tag"];
}

export function CardActions({ status, ...props }: CardActionsProps) {
  return usePart(
    "div",
    props,
    { status },
    { "data-domainkit-part": "connected-actions", "data-state": status },
  );
}

export interface DisconnectDialogProps {
  readonly connection: Transport.Connected;
  readonly controller: Controller;
  readonly onOpenChange?: (open: boolean) => void;
  readonly open?: boolean;
  readonly trigger?: ReactElement | null;
}

export function DisconnectDialog({
  connection,
  controller,
  onOpenChange,
  open: openProp,
  trigger,
}: DisconnectDialogProps) {
  const { colorScheme, messages, portalContainer, themeStyle } = useDomainKit();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (nextOpen: boolean) => {
    if (openProp === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  const detaching = controller.state._tag === "Detaching";
  return (
    <BaseAlertDialog.Root
      onOpenChange={(nextOpen, eventDetails) => {
        if (!nextOpen && detaching) {
          eventDetails.cancel();
          return;
        }
        setOpen(nextOpen);
      }}
      open={open}
    >
      {trigger === null ? null : (
        <BaseAlertDialog.Trigger
          data-domainkit-part="disconnect-trigger"
          {...(trigger === undefined ? {} : { render: trigger })}
        >
          {messages.disconnectDomain}
        </BaseAlertDialog.Trigger>
      )}
      <BaseAlertDialog.Portal container={portalContainer}>
        <BaseAlertDialog.Backdrop
          data-color-scheme={colorScheme}
          data-domainkit-part="dialog-backdrop"
          data-domainkit-root=""
          style={themeStyle}
        />
        <BaseAlertDialog.Popup
          data-color-scheme={colorScheme}
          data-domainkit-part="disconnect-dialog"
          data-domainkit-root=""
          style={themeStyle}
        >
          <div data-domainkit-part="dialog-header">
            <div data-domainkit-part="dialog-heading">
              <BaseAlertDialog.Title data-domainkit-part="dialog-title">
                {messages.disconnectTitle(connection.provider.name)}
              </BaseAlertDialog.Title>
              <BaseAlertDialog.Description data-domainkit-part="dialog-description">
                {messages.disconnectConsent}
              </BaseAlertDialog.Description>
            </div>
            {detaching ? null : (
              <BaseAlertDialog.Close aria-label={messages.close} data-domainkit-part="dialog-close">
                ×
              </BaseAlertDialog.Close>
            )}
          </div>
          <div data-domainkit-part="dialog-footer">
            {detaching ? null : (
              <BaseAlertDialog.Close data-domainkit-part="dialog-cancel">
                {messages.cancel}
              </BaseAlertDialog.Close>
            )}
            <button
              data-domainkit-part="disconnect-action"
              disabled={detaching}
              onClick={() => controller.detach()}
              type="button"
            >
              {detaching ? messages.detaching : messages.disconnectDomain}
            </button>
          </div>
        </BaseAlertDialog.Popup>
      </BaseAlertDialog.Portal>
    </BaseAlertDialog.Root>
  );
}

export type Connected = Transport.Connected;
