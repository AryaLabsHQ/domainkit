import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type FormEvent,
  type ReactNode,
} from "react";

import { useDomainKit } from "./domain-kit.tsx";
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

export interface RootProps extends ComponentPropsWithoutRef<"div"> {
  readonly children: ReactNode;
}

export function Root({ children, ...props }: RootProps) {
  return (
    <div data-domainkit-part="connection-root" {...props}>
      {children}
    </div>
  );
}

export interface StatusProps extends ComponentPropsWithoutRef<"div"> {
  readonly state: State;
}

export function Status({ state, ...props }: StatusProps) {
  const text =
    state._tag === "Loading"
      ? "Detecting DNS provider…"
      : state._tag === "Connected"
        ? `${state.provider.name} connected`
        : state._tag === "Unsupported"
          ? "Automatic connection is not available for this domain"
          : state._tag === "Failure"
            ? state.message
            : state._tag === "Redirecting"
              ? "Opening provider authorization…"
              : state._tag === "Submitting"
                ? "Connecting…"
                : `${state.provider.name} is available`;
  return (
    <div data-domainkit-part="connection-status" data-state={state._tag} {...props}>
      {text}
    </div>
  );
}

export interface TriggerProps extends ComponentPropsWithoutRef<typeof BaseDialog.Trigger> {
  readonly providerName: string;
}

export function Trigger({ providerName, ...props }: TriggerProps) {
  return (
    <BaseDialog.Trigger data-domainkit-part="connection-trigger" {...props}>
      Connect {providerName}
    </BaseDialog.Trigger>
  );
}

interface MethodProps {
  readonly controller: Controller;
  readonly method: AuthenticationMethod;
}

function Method({ controller, method }: MethodProps) {
  const [token, setToken] = useState("");
  const [parameters, setParameters] = useState<Readonly<Record<string, string>>>({});
  if (method._tag === "OAuth") {
    return (
      <button data-domainkit-part="oauth-connect" onClick={() => void controller.connect("oauth")}>
        {method.label}
      </button>
    );
  }
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
  return (
    <form data-domainkit-part="token-connect" onSubmit={submit}>
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
        API token
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
    </form>
  );
}

export interface DialogProps {
  readonly controller: Controller;
  readonly snapshot: Disconnected;
}

export function Dialog({ controller, snapshot }: DialogProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop data-domainkit-part="dialog-backdrop" />
      <BaseDialog.Popup data-domainkit-part="connection-dialog">
        <BaseDialog.Title>Connect {snapshot.provider.name}</BaseDialog.Title>
        <BaseDialog.Description>
          Authorize DNS changes for {snapshot.domain}.
        </BaseDialog.Description>
        {snapshot.reusableConnection === undefined ? null : (
          <button data-domainkit-part="reuse-connection" onClick={() => void controller.reuse()}>
            Use {snapshot.reusableConnection.label}
          </button>
        )}
        {snapshot.provider.authentication.map((method) => (
          <Method controller={controller} key={method._tag} method={method} />
        ))}
        <BaseDialog.Close>Cancel</BaseDialog.Close>
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
    <Root {...props}>
      <Status state={state} />
      {state._tag === "Failure" && (state.retry === "safe" || state.retry === "unknown") ? (
        <button onClick={controller.retry}>Try again</button>
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

export type { Connected };
