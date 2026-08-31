import { useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
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

const logoHosts: Readonly<Record<string, string>> = {
  amazonroute53: "route53.com",
  aws: "amazonaws.com",
  bluehost: "bluehost.com",
  cloudflare: "cloudflare.com",
  digitalocean: "digitalocean.com",
  dnsimple: "dnsimple.com",
  dreamhost: "dreamhost.com",
  dynadot: "dynadot.com",
  gandi: "gandi.net",
  godaddy: "godaddy.com",
  google: "cloud.google.com",
  googlecloud: "cloud.google.com",
  googleclouddns: "cloud.google.com",
  hostgator: "hostgator.com",
  hostinger: "hostinger.com",
  hover: "hover.com",
  ionos: "ionos.com",
  namecheap: "namecheap.com",
  namecom: "name.com",
  netlify: "netlify.com",
  ns1: "ns1.com",
  ovh: "ovh.com",
  porkbun: "porkbun.com",
  route53: "route53.com",
  spaceship: "spaceship.com",
  squarespace: "squarespace.com",
  vercel: "vercel.com",
};

const logoKey = (providerId: string): string =>
  providerId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const logoHost = (providerId: string): string | undefined => logoHosts[logoKey(providerId)];

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
      : (replacement ?? <DefaultMark key={provider.id} provider={provider} />);
  return usePart(
    "span",
    props,
    { providerId: provider.id },
    {
      "aria-label": provider.name,
      children: content,
      "data-domainkit-part": "provider-mark",
      "data-domainkit-provider": logoKey(provider.id),
      role: "img",
    },
  );
}

export type { ProviderDescriptor as Provider };
export type MarkElementProps = ComponentPropsWithoutRef<"span">;
