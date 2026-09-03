import { Transport } from "domainkit/client";
import * as Effect from "effect/Effect";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";

import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import type { Listener } from "./events.ts";
import type { Icons } from "./icons.tsx";
import { IconsProvider } from "./icons.tsx";
import type { Catalog } from "./messages.ts";
import { merge as mergeMessages } from "./messages.ts";
import type { Marks } from "./provider.tsx";
import type { Theme } from "./theme.ts";
import { toStyle } from "./theme.ts";

export interface RootState extends Record<string, unknown> {
  readonly colorScheme: "dark" | "inherit" | "light";
}

export interface RootProps extends Omit<PartProps<"div", RootState>, "children"> {
  readonly children: ReactNode;
  readonly colorScheme?: RootState["colorScheme"];
  readonly icons?: Partial<Icons>;
  readonly marks?: Marks;
  readonly messages?: Partial<Catalog>;
  /** Where an interactive provider flow sends the customer. Defaults to `window.location`. */
  readonly navigate?: (url: string) => void;
  readonly onEvent?: Listener;
  readonly portalContainer?: HTMLElement | null;
  /** Bump to re-inspect every mounted domain after a change the UI did not make. */
  readonly revision?: number;
  readonly theme?: Theme;
  /** The transport, by value. Rebuilding it inline on every render does not restart controllers. */
  readonly transport: Transport.Transport;
}

interface ContextValue {
  readonly capabilities: ReadonlyArray<Transport.Capability>;
  readonly colorScheme: RootState["colorScheme"];
  readonly emit: Listener;
  readonly marks: Marks;
  readonly messages: Catalog;
  readonly navigate: (url: string) => void;
  readonly portalContainer: RefObject<HTMLElement | null>;
  readonly revision: number;
  readonly themeStyle: ReturnType<typeof toStyle>;
  readonly transport: Transport.Transport;
}

const Context = createContext<ContextValue | null>(null);

const navigateInBrowser = (url: string): void => {
  if (typeof window === "undefined") {
    throw new Error("DomainKit provider authorization requires a browser or a `navigate` prop");
  }
  window.location.assign(url);
};

export interface StableTransport {
  readonly transport: Transport.Transport;
  readonly capabilities: ReadonlyArray<Transport.Capability>;
}

type Method = (...args: ReadonlyArray<never>) => Effect.Effect<unknown, unknown>;

/**
 * A transport whose identity survives re-renders. Each method reads the newest transport when it
 * runs, so a host may write `<DomainKit.Root transport={Transport.fromFetch("/api/domainkit")}>`
 * inline and controllers still see one transport for the whole mount. Swapping in a transport
 * that declares different capability groups rebuilds it, and every controller re-runs.
 */
const useStableTransport = (transport: Transport.Transport): StableTransport => {
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
    ) as Transport.Transport;
    return { capabilities, transport: stable };
  }, [signature]);
};

const resolvePortalContainer = (
  container: HTMLElement | null,
  ownerDocument: Document | null,
): HTMLElement | null => {
  if (container === null || ownerDocument === null) return null;
  return container.ownerDocument === ownerDocument && container.getRootNode() === ownerDocument
    ? container
    : null;
};

const usePortalContainer = (container: HTMLElement | null): HTMLElement | null => {
  const ownerDocument = useMemo(() => container?.ownerDocument ?? null, [container]);
  const subscribe = useCallback(
    (notify: () => void) => {
      if (ownerDocument === null || typeof MutationObserver === "undefined") return () => {};
      const observer = new MutationObserver(notify);
      observer.observe(ownerDocument, { childList: true, subtree: true });
      return () => observer.disconnect();
    },
    [ownerDocument],
  );
  const getSnapshot = useCallback(
    () => resolvePortalContainer(container, ownerDocument),
    [container, ownerDocument],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
};

export function Root({
  children,
  colorScheme = "inherit",
  icons,
  marks = {},
  messages,
  navigate = navigateInBrowser,
  onEvent,
  portalContainer = null,
  revision = 0,
  theme,
  transport,
  ...props
}: RootProps) {
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
  const themeStyle = toStyle(theme);
  const resolvedPortalContainer = usePortalContainer(portalContainer);
  const portalContainerRef = useMemo<RefObject<HTMLElement | null>>(
    () => ({ current: resolvedPortalContainer }),
    [resolvedPortalContainer],
  );
  const value: ContextValue = {
    capabilities,
    colorScheme,
    emit,
    marks,
    messages: mergeMessages(messages),
    navigate,
    portalContainer: portalContainerRef,
    revision,
    themeStyle,
    transport: stable,
  };
  const content = usePart(
    "div",
    props,
    { colorScheme },
    {
      children,
      "data-color-scheme": colorScheme,
      "data-domainkit-root": "",
      style: themeStyle,
    },
  );
  return (
    <Context.Provider value={value}>
      <IconsProvider {...(icons === undefined ? {} : { icons })}>{content}</IconsProvider>
    </Context.Provider>
  );
}

export function useDomainKit(): ContextValue {
  const value = useContext(Context);
  if (value === null) {
    throw new Error("DomainKit components must be rendered inside DomainKit.Root");
  }
  return value;
}

/** The transport `DomainKit.Root` holds, with the identity it keeps for the whole mount. */
export function useTransport(): Transport.Transport {
  return useDomainKit().transport;
}

/** Which capability groups the host's transport declares, for gating a custom part. */
export function useCapabilities(): ReadonlyArray<Transport.Capability> {
  return useDomainKit().capabilities;
}
