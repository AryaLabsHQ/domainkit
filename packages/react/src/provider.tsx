import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type { Transport } from "domainkit";

import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit } from "./domain-kit.tsx";

type ProviderDescriptor = Transport.Provider;

export type Marks = Readonly<
  Record<string, ReactNode | ((provider: ProviderDescriptor) => ReactNode)>
>;

export interface MarkState extends Record<string, unknown> {
  readonly providerId: string;
}

export interface MarkProps extends PartProps<"span", MarkState> {
  readonly provider: ProviderDescriptor;
}

const logoKey = (providerId: string): string =>
  providerId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const letterMark = (provider: ProviderDescriptor): string =>
  provider.name.trim().charAt(0).toUpperCase() || "?";

function CloudflareMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 32">
      <path
        d="M30.2 24.6H7.7a6.2 6.2 0 0 1 .5-12.4 9.7 9.7 0 0 1 18.5-2.8 7.7 7.7 0 0 1 3.5 15.2Z"
        fill="#f48120"
      />
      <path d="M33.1 16.2h1.3a5.2 5.2 0 0 1 .3 10.4H18.2l1.2-3.4h12.9l.8-7Z" fill="#faad3d" />
    </svg>
  );
}

function VercelMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32">
      <path d="m16 5 13 22H3L16 5Z" fill="currentColor" />
    </svg>
  );
}

const builtInMarks: Readonly<Record<string, () => ReactNode>> = {
  cloudflare: CloudflareMark,
  vercel: VercelMark,
};

function DefaultMark({ provider }: { readonly provider: ProviderDescriptor }) {
  const BuiltIn = builtInMarks[logoKey(provider.id)];
  return BuiltIn === undefined ? letterMark(provider) : <BuiltIn />;
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
