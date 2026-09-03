import type { Transport } from "domainkit/client";
import type { ReactNode } from "react";

import type { PartProps } from "./composition.tsx";
import { usePart } from "./composition.tsx";
import { useDomainKit } from "./domain-kit.tsx";

/** A provider as the snapshot describes it: an id, a display name, and its auth methods. */
export type Descriptor = Transport.Snapshot["providers"][number];

/** Host-supplied artwork per provider id. A function receives the descriptor it renders for. */
export type Marks = Readonly<Record<string, ReactNode | ((provider: Descriptor) => ReactNode)>>;

export interface MarkState extends Record<string, unknown> {
  readonly providerId: string;
}

export interface MarkProps extends PartProps<"span", MarkState> {
  readonly provider: Descriptor;
}

const key = (providerId: string): string =>
  providerId
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "");

/** No network call: the fallback is the provider's own initial, drawn with the theme's tokens. */
const monogram = (provider: Descriptor): string =>
  provider.name.trim().charAt(0).toUpperCase() || "?";

/**
 * A provider's artwork. `DomainKit.Root`'s `marks` decides what a provider looks like; without an
 * entry the mark is the provider's initial. Nothing is fetched at render time.
 */
export function Mark({ provider, ...props }: MarkProps) {
  const { marks } = useDomainKit();
  const replacement = marks[provider.id];
  const content =
    typeof replacement === "function" ? replacement(provider) : (replacement ?? monogram(provider));
  return usePart(
    "span",
    props,
    { providerId: provider.id },
    {
      "aria-label": provider.name,
      children: content,
      "data-domainkit-part": "provider-mark",
      "data-domainkit-provider": key(provider.id),
      role: "img",
    },
  );
}
