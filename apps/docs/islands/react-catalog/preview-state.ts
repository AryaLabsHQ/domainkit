import type { Transport } from "domainkit";

import { isWorkshopThemeId, type WorkshopThemeId } from "./themes.ts";

export const defaultRecords: ReadonlyArray<Transport.DnsRecord> = [
  {
    id: "mx",
    name: "mail.example.com",
    priority: 10,
    type: "MX",
    value: "feedback-smtp.example.net",
  },
  {
    id: "spf",
    name: "mail.example.com",
    type: "TXT",
    value: "v=spf1 include:example.net ~all",
  },
];

export type StoryId =
  | "card"
  | "connection"
  | "domain"
  | "host-connection"
  | "host-lifecycle"
  | "lifecycle"
  | "provider"
  | "records"
  | "verification";

export interface PreviewState {
  readonly colorScheme: "dark" | "light";
  readonly domain: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly receipt: boolean;
  readonly records: ReadonlyArray<Transport.DnsRecord>;
  readonly story: StoryId;
  readonly targetState: "ambiguous" | "unavailable" | "unique";
  readonly theme: WorkshopThemeId;
}

const isStoryId = (value: string): value is StoryId =>
  [
    "card",
    "connection",
    "domain",
    "host-connection",
    "host-lifecycle",
    "lifecycle",
    "provider",
    "records",
    "verification",
  ].includes(value);

export function stateFromSearch(search: string): PreviewState {
  const parameters = new URLSearchParams(search);
  const story = parameters.get("story");
  const targetState = parameters.get("targets");
  const mode = parameters.get("mode");
  const theme = parameters.get("theme");
  const colorScheme =
    mode === "dark" ||
    (mode === null &&
      typeof document !== "undefined" &&
      document.documentElement.dataset.theme === "dark")
      ? "dark"
      : "light";
  return {
    colorScheme,
    domain: "mail.example.com",
    providerId: "cloudflare",
    providerName: "Cloudflare",
    receipt: true,
    records: defaultRecords,
    story: story !== null && isStoryId(story) ? story : "connection",
    targetState:
      targetState === "ambiguous" || targetState === "unavailable" ? targetState : "unique",
    theme: theme !== null && isWorkshopThemeId(theme) ? theme : "neutral",
  };
}
