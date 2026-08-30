import { createContext, useContext, useMemo, type ReactNode, type RefObject } from "react";

import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import type { Catalog } from "./messages.ts";
import { merge as mergeMessages } from "./messages.ts";
import type { Marks } from "./provider.tsx";
import type { Theme } from "./theme.ts";
import { toStyle } from "./theme.ts";
import type { DomainKitTransport } from "./transport.ts";

export interface RootState extends Record<string, unknown> {
  readonly colorScheme: "dark" | "inherit" | "light";
}

export interface RootProps extends Omit<PartProps<"div", RootState>, "children"> {
  readonly children: ReactNode;
  readonly colorScheme?: RootState["colorScheme"];
  readonly messages?: Partial<Catalog>;
  readonly marks?: Marks;
  readonly navigate?: (url: string) => void;
  readonly portalContainer?: HTMLElement | null;
  readonly theme?: Theme;
  readonly transport: DomainKitTransport;
}

interface ContextValue {
  readonly colorScheme: RootState["colorScheme"];
  readonly navigate: (url: string) => void;
  readonly marks: Marks;
  readonly messages: Catalog;
  readonly portalContainer: RefObject<HTMLElement | null>;
  readonly themeStyle: ReturnType<typeof toStyle>;
  readonly transport: DomainKitTransport;
}

const Context = createContext<ContextValue | null>(null);

const navigateInBrowser = (url: string): void => {
  if (typeof window === "undefined") {
    throw new Error("DomainKit OAuth navigation requires a browser or a custom navigate function");
  }
  window.location.assign(url);
};

const validatePortalContainer = (container: HTMLElement | null): HTMLElement | null => {
  if (container === null) return null;
  const root = container.getRootNode();
  if (typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot) {
    throw new Error(
      "DomainKit portalContainer must belong to the document tree; ShadowRoot portals cannot receive the package stylesheet",
    );
  }
  return container;
};

export function Root({
  children,
  colorScheme = "inherit",
  marks = {},
  messages,
  navigate = navigateInBrowser,
  portalContainer = null,
  theme,
  transport,
  ...props
}: RootProps) {
  const themeStyle = toStyle(theme);
  const portalContainerRef = useMemo<RefObject<HTMLElement | null>>(
    () => ({
      get current() {
        return validatePortalContainer(portalContainer);
      },
    }),
    [portalContainer],
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
    <Context
      value={{
        colorScheme,
        marks,
        messages: mergeMessages(messages),
        navigate,
        portalContainer: portalContainerRef,
        themeStyle,
        transport,
      }}
    >
      {content}
    </Context>
  );
}

export function useDomainKit(): ContextValue {
  const value = useContext(Context);
  if (value === null)
    throw new Error("DomainKit components must be rendered inside DomainKit.Root");
  return value;
}
