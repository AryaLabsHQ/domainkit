import type { CSSProperties } from "react";

export interface Theme {
  readonly accent?: string;
  readonly accentContrast?: string;
  readonly backdrop?: string;
  readonly background?: string;
  readonly border?: string;
  readonly danger?: string;
  readonly dangerContrast?: string;
  readonly fill?: string;
  readonly fontFamily?: string;
  readonly muted?: string;
  readonly radius?: string;
  readonly shadow?: string;
  readonly success?: string;
  readonly text?: string;
  readonly warning?: string;
}

const variables = {
  accent: "--domainkit-accent",
  accentContrast: "--domainkit-accent-contrast",
  backdrop: "--domainkit-backdrop",
  background: "--domainkit-background",
  border: "--domainkit-border",
  danger: "--domainkit-danger",
  dangerContrast: "--domainkit-danger-contrast",
  fill: "--domainkit-fill",
  fontFamily: "--domainkit-font-family",
  muted: "--domainkit-muted",
  radius: "--domainkit-radius",
  shadow: "--domainkit-shadow",
  success: "--domainkit-success",
  text: "--domainkit-text",
  warning: "--domainkit-warning",
} as const satisfies Record<keyof Theme, string>;

export function toStyle(theme: Theme = {}): CSSProperties {
  return Object.fromEntries(
    Object.entries(theme).flatMap(([key, value]) =>
      value === undefined ? [] : [[variables[key as keyof Theme], value]],
    ),
  ) as CSSProperties;
}
