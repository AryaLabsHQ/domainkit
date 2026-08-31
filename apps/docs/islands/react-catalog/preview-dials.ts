import type { DialConfig } from "dialkit";
import { DomainName } from "domainkit";

import type { PreviewState, StoryId } from "./preview-state.ts";

export interface PreviewDialValues {
  readonly domain?: string;
  readonly hasReceipt?: boolean;
  readonly provider?: string;
  readonly records?: {
    readonly primary?: {
      readonly name?: string;
      readonly priority?: number;
      readonly type?: string;
      readonly value?: string;
    };
    readonly secondary?: {
      readonly name?: string;
      readonly priority?: number;
      readonly type?: string;
      readonly value?: string;
    };
  };
  readonly targetState?: string;
}

const recordStories = new Set<StoryId>([
  "card",
  "domain",
  "host-lifecycle",
  "lifecycle",
  "records",
  "verification",
]);
const receiptStories = new Set<StoryId>(["domain", "host-lifecycle", "lifecycle"]);
const targetStories = new Set<StoryId>(["connection", "host-connection"]);

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

  if (state.story !== "provider") {
    config.domain = { default: state.domain, type: "text" };
  }
  if (targetStories.has(state.story)) {
    config.targetState = {
      default: state.targetState,
      options: [
        { label: "Unique zone", value: "unique" },
        { label: "Multiple zones", value: "ambiguous" },
        { label: "No zone", value: "unavailable" },
      ],
      type: "select",
    };
  }
  if (receiptStories.has(state.story)) {
    config.hasReceipt = state.receipt;
  }
  if (recordStories.has(state.story)) {
    const [primary, secondary] = state.records;
    config.records = {
      _collapsed: true,
      ...(primary === undefined
        ? {}
        : {
            primary: {
              name: primary.name,
              ...(primary.priority === undefined
                ? {}
                : { priority: [primary.priority, 0, 100, 1] }),
              type: primary.type,
              value: primary.value,
            },
          }),
      ...(secondary === undefined
        ? {}
        : {
            secondary: {
              name: secondary.name,
              type: secondary.type,
              value: secondary.value,
            },
          }),
    };
  }

  return config;
}

const validDomain = (candidate: string | undefined, fallback: string): string => {
  if (candidate === undefined) return fallback;
  try {
    DomainName.parse(candidate);
    return candidate;
  } catch {
    return fallback;
  }
};

export function stateFromDials(initial: PreviewState, values: PreviewDialValues): PreviewState {
  const providerId = values.provider === "vercel" ? "vercel" : "cloudflare";
  const targetState =
    values.targetState === "ambiguous" || values.targetState === "unavailable"
      ? values.targetState
      : "unique";
  const [primaryValues, secondaryValues] = [values.records?.primary, values.records?.secondary];
  const records = initial.records.map((record, index) => {
    const next = index === 0 ? primaryValues : index === 1 ? secondaryValues : undefined;
    if (next === undefined) return record;
    return {
      ...record,
      name: next.name ?? record.name,
      ...(next.priority === undefined ? {} : { priority: next.priority }),
      type: next.type ?? record.type,
      value: next.value ?? record.value,
    };
  });

  return {
    ...initial,
    domain: validDomain(values.domain, initial.domain),
    providerId,
    providerName: providerId === "vercel" ? "Vercel" : "Cloudflare",
    receipt: values.hasReceipt ?? initial.receipt,
    records,
    targetState,
  };
}
