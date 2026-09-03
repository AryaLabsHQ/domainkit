import { DnsRecord } from "domainkit";

import { isWorkshopThemeId, type WorkshopThemeId } from "./themes.ts";

/** The zone the fake provider serves. Every preview domain sits inside it. */
export const previewZone = "example.com";

export const defaultRequirements: ReadonlyArray<DnsRecord.Model> = [
  DnsRecord.cname({
    name: "app.example.com",
    purpose: "Serve your site",
    target: "edge.acme.dev",
  }),
  DnsRecord.txt({
    name: "_acme.app.example.com",
    purpose: "Prove ownership",
    value: "acme-verify=7f3a",
  }),
];

export const stories = [
  "cleanup",
  "connect",
  "domain-flow",
  "provider-mark",
  "provision",
  "record-card",
  "records",
  "slots",
  "verification",
] as const;
export type StoryId = (typeof stories)[number];

export interface PreviewState {
  readonly colorScheme: "dark" | "light";
  readonly domain: string;
  /** Offer OAuth beside the token method, so the connect dialog shows both. */
  readonly oauth: boolean;
  readonly providerId: string;
  readonly requirements: ReadonlyArray<DnsRecord.Model>;
  /** Seed the zone with the TXT requirement, so the plan shows one Create and one Noop. */
  readonly seeded: boolean;
  readonly story: StoryId;
  readonly theme: WorkshopThemeId;
}

const isStoryId = (value: string): value is StoryId =>
  (stories as ReadonlyArray<string>).includes(value);

export function stateFromSearch(search: string): PreviewState {
  const parameters = new URLSearchParams(search);
  const story = parameters.get("story");
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
    domain: "app.example.com",
    oauth: true,
    providerId: "cloudflare",
    requirements: defaultRequirements,
    seeded: true,
    story: story !== null && isStoryId(story) ? story : "domain-flow",
    theme: theme !== null && isWorkshopThemeId(theme) ? theme : "neutral",
  };
}

/** What the zone holds before the customer starts: the TXT requirements, when seeding is on. */
export const seedOf = (state: PreviewState): ReadonlyArray<DnsRecord.Model> =>
  state.seeded ? state.requirements.filter((record) => record._tag === "TXT") : [];

const identify = (record: DnsRecord.Model): string =>
  `${record._tag} ${record.name} ${DnsRecord.data(record)}`;

/**
 * Everything the story is about. Any edit invalidates what the controllers hold: a seeded record
 * changes what the provider already has, and any requirement changes the plan and the readiness
 * observed against it. Content, not array identity, so an unchanged edit box keeps the story.
 */
export const storyKey = (state: PreviewState): string =>
  [
    state.providerId,
    state.oauth ? "oauth" : "token",
    state.seeded ? "seeded" : "empty",
    ...state.requirements.map(identify),
  ].join("|");
