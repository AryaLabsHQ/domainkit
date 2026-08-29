import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { useDomainKit } from "./domain-kit.tsx";
import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import type { Provider as ProviderDescriptor } from "./transport.ts";

export type Marks = Readonly<
  Record<string, ReactNode | ((provider: ProviderDescriptor) => ReactNode)>
>;

export interface MarkState extends Record<string, unknown> {
  readonly providerId: string;
}

export interface MarkProps extends PartProps<"span", MarkState> {
  readonly provider: ProviderDescriptor;
}

const defaultContent = (provider: ProviderDescriptor): ReactNode => {
  if (provider.id === "vercel") return "▲";
  if (provider.id === "cloudflare") return "Cloudflare";
  return provider.name.slice(0, 1).toUpperCase();
};

export function Mark({ provider, ...props }: MarkProps) {
  const { marks } = useDomainKit();
  const replacement = marks[provider.id];
  const content =
    typeof replacement === "function"
      ? replacement(provider)
      : (replacement ?? defaultContent(provider));
  return usePart(
    "span",
    props,
    { providerId: provider.id },
    {
      "aria-label": provider.name,
      children: content,
      "data-domainkit-part": "provider-mark",
      role: "img",
    },
  );
}

export type { ProviderDescriptor as Provider };
export type MarkElementProps = ComponentPropsWithoutRef<"span">;
