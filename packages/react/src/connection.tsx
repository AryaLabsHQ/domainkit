import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type FormEvent,
} from "react";

import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit } from "./domain-kit.tsx";
import * as Provider from "./provider.tsx";
import type { AuthenticationMethod, Connected, ConnectionSnapshot, Failure } from "./transport.ts";

export type State =
  | { readonly _tag: "Loading" }
  | ConnectionSnapshot
  | { readonly _tag: "Submitting"; readonly snapshot: Disconnected }
  | { readonly _tag: "Redirecting"; readonly snapshot: Disconnected };

type Disconnected = Extract<ConnectionSnapshot, { readonly _tag: "Disconnected" }>;

export interface Controller {
  readonly connect: (
    method: "oauth" | "token",
    token?: string,
    parameters?: Readonly<Record<string, string>>,
  ) => Promise<void>;
  readonly retry: () => void;
  readonly reuse: () => Promise<void>;
  readonly state: State;
}

const failure = (cause: unknown): Failure => ({
  _tag: "Failure",
  message: cause instanceof Error ? cause.message : "The connection request failed",
  retry: "safe",
});

export function useController(domain: string): Controller {
  const { navigate, transport } = useDomainKit();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ _tag: "Loading" });
  const activeRequest = useRef(0);

  useEffect(() => {
    const request = ++activeRequest.current;
    setState({ _tag: "Loading" });
    void transport.connection.inspect({ domain }).then(
      (snapshot) => {
        if (activeRequest.current === request) setState(snapshot);
      },
      (cause: unknown) => {
        if (activeRequest.current === request) setState(failure(cause));
      },
    );
    return () => {
      if (activeRequest.current === request) activeRequest.current += 1;
    };
  }, [attempt, domain, transport]);

  const connect = useCallback(
    async (
      method: "oauth" | "token",
      token?: string,
      parameters?: Readonly<Record<string, string>>,
    ) => {
      if (state._tag !== "Disconnected") return;
      const request = ++activeRequest.current;
      const snapshot = state;
      setState({ _tag: "Submitting", snapshot });
      try {
        const result = await transport.connection.connect({
          domain,
          method,
          ...(parameters === undefined ? {} : { parameters }),
          providerId: snapshot.provider.id,
          ...(token === undefined ? {} : { token }),
        });
        if (activeRequest.current !== request) return;
        if (result._tag === "Redirect") {
          setState({ _tag: "Redirecting", snapshot });
          navigate(result.authorizationUrl);
          return;
        }
        setState(result);
      } catch (cause) {
        if (activeRequest.current === request) setState(failure(cause));
      }
    },
    [domain, navigate, state, transport],
  );

  const reuse = useCallback(async () => {
    if (state._tag !== "Disconnected" || state.reusableConnection === undefined) return;
    const request = ++activeRequest.current;
    const snapshot = state;
    const reusableConnection = state.reusableConnection;
    setState({ _tag: "Submitting", snapshot });
    try {
      const result = await transport.connection.reuse({
        connectionId: reusableConnection.connectionId,
        domain,
      });
      if (activeRequest.current === request) setState(result);
    } catch (cause) {
      if (activeRequest.current === request) setState(failure(cause));
    }
  }, [domain, state, transport]);

  return {
    connect,
    retry: () => setAttempt((current) => current + 1),
    reuse,
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

export function Status({ state, ...props }: StatusProps) {
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
                : `${state.provider.name} is available`;
  return usePart(
    "div",
    props,
    { status: state._tag },
    {
      children: text,
      "data-domainkit-part": "connection-status",
      "data-state": state._tag,
    },
  );
}

export interface TriggerProps extends ComponentPropsWithoutRef<typeof BaseDialog.Trigger> {
  readonly providerName: string;
}

export function Trigger({ providerName, ...props }: TriggerProps) {
  const { messages } = useDomainKit();
  return (
    <BaseDialog.Trigger data-domainkit-part="connection-trigger" {...props}>
      {messages.connectProvider(providerName)}
    </BaseDialog.Trigger>
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
      onClick: () => void controller.connect("oauth"),
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
  readonly method: Extract<AuthenticationMethod, { readonly _tag: "Token" }>;
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
      void controller.connect(
        "token",
        token,
        Object.keys(populated).length === 0 ? undefined : populated,
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
          <Trigger providerName={snapshot.provider.name} />
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

export type { Connected };
