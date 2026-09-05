"use client";

import type { Connect } from "@domainkit/react";
import type { ReactNode } from "react";

import { ProviderMark } from "@/components/ui/provider-mark";
import { cn } from "@/lib/utils";

/**
 * Your artwork per provider id. Whatever you pass is the mark: nothing wraps it in a tile, so a
 * circular logo stays a circle and a square one stays square. Without an entry the mark is the
 * provider's initial, and nothing is fetched while the surface renders.
 */
export type ProviderArtwork = Readonly<
  Record<string, ReactNode | ((provider: Connect.Descriptor) => ReactNode)>
>;

export function providerArtwork(
  marks: ProviderArtwork | undefined,
  provider: Connect.Descriptor,
): ReactNode {
  const held = marks?.[provider.id];
  if (typeof held === "function") return held(provider);
  return held ?? provider.name.trim().charAt(0).toUpperCase();
}

/** One provider's mark with the name it carries for assistive technology. */
export function Mark({
  className,
  marks,
  provider,
}: {
  readonly className?: string;
  readonly marks?: ProviderArtwork;
  readonly provider: Connect.Descriptor;
}) {
  return (
    <ProviderMark
      className={cn("text-xs font-semibold text-muted-foreground", className)}
      label={provider.name}
    >
      {providerArtwork(marks, provider)}
    </ProviderMark>
  );
}
