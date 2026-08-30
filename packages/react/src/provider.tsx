import { useState, type ComponentPropsWithoutRef, type ReactNode } from "react";

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

const logoHost = (providerId: string): string | undefined => {
  if (providerId === "cloudflare") return "cloudflare.com";
  if (providerId === "vercel") return "vercel.com";
  return undefined;
};

const letterMark = (provider: ProviderDescriptor): string =>
  provider.name.trim().charAt(0).toUpperCase() || "?";

function DefaultMark({ provider }: { readonly provider: ProviderDescriptor }) {
  const host = logoHost(provider.id);
  const [failed, setFailed] = useState(false);
  if (host === undefined || failed) return letterMark(provider);
  return (
    <img
      alt=""
      height={32}
      onError={() => setFailed(true)}
      referrerPolicy="no-referrer"
      src={`https://integrations.sh/logo/${host}?sz=64`}
      width={32}
    />
  );
}

export function Mark({ provider, ...props }: MarkProps) {
  const { marks } = useDomainKit();
  const replacement = marks[provider.id];
  const content =
    typeof replacement === "function"
      ? replacement(provider)
      : (replacement ?? <DefaultMark provider={provider} />);
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
