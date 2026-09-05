import { Transport } from "domainkit/client";
import * as Effect from "effect/Effect";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";

import type { Listener } from "./events.ts";
import type { Catalog } from "./messages.ts";
import { merge as mergeMessages } from "./messages.ts";

export interface RootProps {
  readonly children: ReactNode;
  readonly messages?: Partial<Catalog>;
  /** Where an interactive provider flow sends the customer. Defaults to `window.location`. */
  readonly navigate?: (url: string) => void;
  readonly onEvent?: Listener;
  /**
   * Report the domain's state without the controls that change it, for a customer who may read
   * the domain but not write to it. Capability gating already hides a group the transport does
   * not declare; this covers authorization the transport cannot express, such as a member of an
   * organisation. Every flow carries it on `FlowState.readOnly`, so a surface can explain it.
   */
  readonly readOnly?: boolean;
  /** Bump to re-inspect every mounted domain after a change the UI did not make. */
  readonly revision?: number;
  /** The transport, by value. Rebuilding it inline on every render does not restart controllers. */
  readonly transport: Transport.Interface;
}

interface ContextValue {
  readonly capabilities: ReadonlyArray<Transport.Capability>;
  readonly emit: Listener;
  readonly messages: Catalog;
  readonly navigate: (url: string) => void;
  readonly readOnly: boolean;
  readonly revision: number;
  readonly transport: Transport.Interface;
}

const Context = createContext<ContextValue | null>(null);

const navigateInBrowser = (url: string): void => {
  if (typeof window === "undefined") {
    throw new Error("DomainKit provider authorization requires a browser or a `navigate` prop");
  }
  window.location.assign(url);
};

export interface StableTransport {
  readonly transport: Transport.Interface;
  readonly capabilities: ReadonlyArray<Transport.Capability>;
}

type Method = (...args: ReadonlyArray<never>) => Effect.Effect<unknown, unknown>;

/**
 * A transport whose identity survives re-renders. Each method reads the newest transport when it
 * runs, so a host may write `<DomainKit.Root transport={Transport.fromFetch("/api/domainkit")}>`
 * inline and controllers still see one transport for the whole mount. Swapping in a transport
 * that declares different capability groups rebuilds it, and every controller re-runs.
 */
const useStableTransport = (transport: Transport.Interface): StableTransport => {
  const latest = useRef(transport);
  useLayoutEffect(() => {
    latest.current = transport;
  });
  const signature = Transport.capabilities(transport).join(",");
  return useMemo(() => {
    const capabilities = Transport.capabilities(latest.current);
    const stable = Object.fromEntries(
      capabilities.map((capability) => {
        const group = latest.current[capability] as unknown as Record<string, Method>;
        return [
          capability,
          Object.fromEntries(
            Object.keys(group).map((name) => [
              name,
              (...args: ReadonlyArray<never>) =>
                Effect.suspend(() => {
                  const live = latest.current[capability] as unknown as Record<string, Method>;
                  const method = live[name];
                  if (method === undefined) {
                    throw new Error(`The transport no longer declares ${capability}.${name}`);
                  }
                  return method(...args);
                }),
            ]),
          ),
        ];
      }),
    ) as Transport.Interface;
    return { capabilities, transport: stable };
  }, [signature]);
};

/**
 * The transport, the catalog, and the two host callbacks every hook below reads. It renders no
 * element of its own: `@domainkit/react` supplies behaviour, state, copy, and accessibility, and
 * the host application supplies the markup.
 */
export function Root({
  children,
  messages,
  navigate = navigateInBrowser,
  onEvent,
  readOnly = false,
  revision = 0,
  transport,
}: RootProps): ReactElement {
  const { capabilities, transport: stable } = useStableTransport(transport);
  const onEventRef = useRef(onEvent);
  useLayoutEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);
  const emit = useCallback<Listener>((event) => {
    try {
      onEventRef.current?.(event);
    } catch {
      // Host observers are best-effort and cannot change a completed operation's outcome.
    }
  }, []);
  const value: ContextValue = {
    capabilities,
    emit,
    messages: mergeMessages(messages),
    navigate,
    readOnly,
    revision,
    transport: stable,
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useDomainKit(): ContextValue {
  const value = useContext(Context);
  if (value === null) {
    throw new Error("DomainKit hooks must be called inside DomainKit.Root");
  }
  return value;
}

/** The catalog `DomainKit.Root` holds, with the host's overrides already merged in. */
export function useMessages(): Catalog {
  return useDomainKit().messages;
}

/** The transport `DomainKit.Root` holds, with the identity it keeps for the whole mount. */
export function useTransport(): Transport.Interface {
  return useDomainKit().transport;
}

const ReadOnlyContext = createContext<boolean | null>(null);

/** Narrow one subtree to read-only without touching the rest of the page. */
export function ReadOnly({
  children,
  value,
}: {
  readonly children: ReactNode;
  readonly value: boolean;
}) {
  return <ReadOnlyContext.Provider value={value}>{children}</ReadOnlyContext.Provider>;
}

/** Whether this surface may offer controls that change the domain. */
export function useReadOnly(): boolean {
  const scoped = useContext(ReadOnlyContext);
  const root = useDomainKit().readOnly;
  return scoped ?? root;
}

/** Which capability groups the host's transport declares, for gating a surface of your own. */
export function useCapabilities(): ReadonlyArray<Transport.Capability> {
  return useDomainKit().capabilities;
}
