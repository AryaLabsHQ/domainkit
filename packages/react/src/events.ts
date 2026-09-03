import type { DomainKitError, Receipt } from "domainkit";
import type { Transport } from "domainkit/client";
import * as Data from "effect/Data";

/** What a customer finished doing, for host notifications, analytics, and audit trails. */
export type Event = Data.TaggedEnum<{
  Connected: {
    readonly domain: string;
    readonly connectionId: string;
    readonly snapshot: Transport.Snapshot;
  };
  Detached: { readonly domain: string };
  Disconnected: { readonly domain: string; readonly connectionId: string };
  Applied: { readonly domain: string; readonly receipt: Receipt.Receipt };
  Cleaned: { readonly domain: string; readonly receipt: Receipt.Receipt };
  Declined: { readonly domain: string; readonly attempt: Transport.Attempt };
  Failed: { readonly domain: string; readonly error: DomainKitError.DomainKitError };
}>;
export const Event = Data.taggedEnum<Event>();

export type Listener = (event: Event) => void;
