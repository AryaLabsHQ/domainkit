import { createContext, useContext, type ReactNode } from "react";

import type { DomainKitTransport } from "./transport.ts";

export interface RootProps {
  readonly children: ReactNode;
  readonly navigate?: (url: string) => void;
  readonly transport: DomainKitTransport;
}

interface ContextValue {
  readonly navigate: (url: string) => void;
  readonly transport: DomainKitTransport;
}

const Context = createContext<ContextValue | null>(null);

const navigateInBrowser = (url: string): void => {
  if (typeof window === "undefined") {
    throw new Error("DomainKit OAuth navigation requires a browser or a custom navigate function");
  }
  window.location.assign(url);
};

export function Root({ children, navigate = navigateInBrowser, transport }: RootProps) {
  return <Context value={{ navigate, transport }}>{children}</Context>;
}

export function useDomainKit(): ContextValue {
  const value = useContext(Context);
  if (value === null)
    throw new Error("DomainKit components must be rendered inside DomainKit.Root");
  return value;
}
