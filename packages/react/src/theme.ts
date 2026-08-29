import type { CSSProperties } from "react";

export interface Theme {
  readonly accent?: string;
  readonly accentContrast?: string;
  readonly background?: string;
  readonly border?: string;
  readonly danger?: string;
  readonly fontFamily?: string;
  readonly muted?: string;
  readonly radius?: string;
  readonly shadow?: string;
  readonly text?: string;
}

const variables = {
  accent: "--domainkit-accent",
  accentContrast: "--domainkit-accent-contrast",
  background: "--domainkit-background",
  border: "--domainkit-border",
  danger: "--domainkit-danger",
  fontFamily: "--domainkit-font-family",
  muted: "--domainkit-muted",
  radius: "--domainkit-radius",
  shadow: "--domainkit-shadow",
  text: "--domainkit-text",
} as const satisfies Record<keyof Theme, string>;

export function toStyle(theme: Theme = {}): CSSProperties {
  return Object.fromEntries(
    Object.entries(theme).flatMap(([key, value]) =>
      value === undefined ? [] : [[variables[key as keyof Theme], value]],
    ),
  ) as CSSProperties;
}
