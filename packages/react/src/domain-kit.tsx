import { RegistryProvider } from "@effect/atom-react";
import { Transport } from "domainkit";
import type * as Layer from "effect/Layer";
import * as Atom from "effect/unstable/reactivity/Atom";
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
import type { Icons } from "./icons.tsx";
import { IconsProvider } from "./icons.tsx";
import type * as Lifecycle from "./lifecycle.ts";
import type { Catalog } from "./messages.ts";
import { merge as mergeMessages } from "./messages.ts";
import type { Marks } from "./provider.tsx";
import type { Theme } from "./theme.ts";
import { toStyle } from "./theme.ts";
import type { Runtime } from "./atom.ts";

export interface RootState extends Record<string, unknown> {
  readonly colorScheme: "dark" | "inherit" | "light";
}

export interface RootProps extends Omit<PartProps<"div", RootState>, "children"> {
  readonly children: ReactNode;
  readonly colorScheme?: RootState["colorScheme"];
  readonly icons?: Partial<Icons>;
  readonly messages?: Partial<Catalog>;
  readonly marks?: Marks;
  readonly navigate?: (url: string) => void;
  readonly onEvent?: Lifecycle.Listener;
  readonly portalContainer?: HTMLElement | null;
  readonly theme?: Theme;
  readonly transport: Layer.Layer<Transport.Service>;
}

interface ContextValue {
  readonly colorScheme: RootState["colorScheme"];
  readonly navigate: (url: string) => void;
  readonly marks: Marks;
  readonly messages: Catalog;
  readonly emit: Lifecycle.Listener;
  readonly portalContainer: RefObject<HTMLElement | null>;
  readonly themeStyle: ReturnType<typeof toStyle>;
  readonly runtime: Runtime;
}

const Context = createContext<ContextValue | null>(null);

const navigateInBrowser = (url: string): void => {
  if (typeof window === "undefined") {
    throw new Error("DomainKit OAuth navigation requires a browser or a custom navigate function");
  }
  window.location.assign(url);
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
  theme,
  transport,
  ...props
}: RootProps) {
  const runtime = useMemo(() => Atom.runtime(transport), [transport]);
  const onEventRef = useRef(onEvent);
  useLayoutEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);
  const emit = useCallback<Lifecycle.Listener>((event) => {
    try {
      onEventRef.current?.(event);
    } catch {
      // Host observers are best-effort and cannot change a completed mutation's outcome.
    }
  }, []);
  const themeStyle = toStyle(theme);
  const resolvedPortalContainer = usePortalContainer(portalContainer);
  const portalContainerRef = useMemo<RefObject<HTMLElement | null>>(
    () => ({ current: resolvedPortalContainer }),
    [resolvedPortalContainer],
  );
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
    <RegistryProvider>
      <Context.Provider
        value={{
          colorScheme,
          emit,
          marks,
          messages: mergeMessages(messages),
          navigate,
          portalContainer: portalContainerRef,
          runtime,
          themeStyle,
        }}
      >
        <IconsProvider {...(icons === undefined ? {} : { icons })}>{content}</IconsProvider>
      </Context.Provider>
    </RegistryProvider>
  );
}

export function useDomainKit(): ContextValue {
  const value = useContext(Context);
  if (value === null)
    throw new Error("DomainKit components must be rendered inside DomainKit.Root");
  return value;
}
