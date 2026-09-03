import type { DialConfig } from "dialkit";
import { DnsRecord, DomainName } from "domainkit";

import { previewZone, type PreviewState, type StoryId } from "./preview-state.ts";

export interface PreviewDialValues {
  readonly domain?: string;
  readonly oauth?: boolean;
  readonly provider?: string;
  readonly readOnly?: boolean;
  readonly records?: {
    readonly cname?: { readonly name?: string; readonly target?: string };
    readonly txt?: { readonly name?: string; readonly value?: string };
  };
  readonly seeded?: boolean;
}

const recordStories = new Set<StoryId>([
  "domain-flow",
  "provision",
  "record-card",
  "records",
  "slots",
  "verification",
]);
const connectStories = new Set<StoryId>(["connect", "domain-flow", "slots"]);
const readOnlyStories = new Set<StoryId>([
  "cleanup",
  "connect",
  "domain-flow",
  "provision",
  "slots",
]);
const zoneStories = new Set<StoryId>(["cleanup", "domain-flow", "provision", "slots"]);

const first = (records: PreviewState["requirements"]) => records[0];
const second = (records: PreviewState["requirements"]) => records[1];

export function previewDialConfig(state: PreviewState): DialConfig {
  const config: DialConfig = {
    provider: {
      default: state.providerId,
      options: [
        { label: "Cloudflare", value: "cloudflare" },
        { label: "Vercel", value: "vercel" },
      ],
      type: "select",
    },
  };

  if (state.story !== "provider-mark") {
    config.domain = { default: state.domain, type: "text" };
  }
  if (connectStories.has(state.story)) {
    config.oauth = state.oauth;
  }
  if (readOnlyStories.has(state.story)) {
    config.readOnly = state.readOnly;
  }
  if (zoneStories.has(state.story)) {
    config.seeded = state.seeded;
  }
  if (recordStories.has(state.story)) {
    const cname = first(state.requirements);
    const txt = second(state.requirements);
    config.records = {
      _collapsed: true,
      ...(cname === undefined || cname._tag !== "CNAME"
        ? {}
        : { cname: { name: cname.name, target: cname.target } }),
      ...(txt === undefined || txt._tag !== "TXT"
        ? {}
        : { txt: { name: txt.name, value: txt.value } }),
    };
  }

  return config;
}

const hostname = (candidate: string | undefined, fallback: string): string => {
  if (candidate === undefined) return fallback;
  const parsed = DomainName.fromString(candidate);
  return parsed._tag === "None" ? fallback : parsed.value;
};

/** The fake provider only serves `previewZone`, so a name outside it would never plan. */
const withinZone = (candidate: string | undefined, fallback: string): string => {
  const name = hostname(candidate, fallback);
  return DomainName.isWithin(name, previewZone) ? name : fallback;
};

/** Record schemas reject an empty value, so an emptied dial keeps the record it is editing. */
const text = (candidate: string | undefined, fallback: string): string =>
  candidate === undefined || candidate.trim() === "" ? fallback : candidate;

export function stateFromDials(initial: PreviewState, values: PreviewDialValues): PreviewState {
  const providerId = values.provider === "vercel" ? "vercel" : "cloudflare";
  const cname = first(initial.requirements);
  const txt = second(initial.requirements);
  const requirements = [
    ...(cname === undefined || cname._tag !== "CNAME"
      ? []
      : [
          DnsRecord.cname({
            name: withinZone(values.records?.cname?.name, cname.name),
            target: hostname(values.records?.cname?.target, cname.target),
            ...(cname.purpose === undefined ? {} : { purpose: cname.purpose }),
          }),
        ]),
    ...(txt === undefined || txt._tag !== "TXT"
      ? []
      : [
          DnsRecord.txt({
            name: withinZone(values.records?.txt?.name, txt.name),
            value: text(values.records?.txt?.value, txt.value),
            ...(txt.purpose === undefined ? {} : { purpose: txt.purpose }),
          }),
        ]),
  ];

  return {
    ...initial,
    domain: withinZone(values.domain, initial.domain),
    oauth: values.oauth ?? initial.oauth,
    providerId,
    readOnly: values.readOnly ?? initial.readOnly,
    requirements,
    seeded: values.seeded ?? initial.seeded,
  };
}
