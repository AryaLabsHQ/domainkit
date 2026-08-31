import type { Transport } from "domainkit";
import * as Data from "effect/Data";

/** User-action lifecycle events suitable for host notifications and telemetry. */
export type Event = Data.TaggedEnum<{
  ConnectionEstablished: {
    readonly connection: Transport.Connected;
    readonly source: "attach" | "connect";
  };
  DomainDetached: {
    readonly connection: Transport.Connected;
    readonly result: Transport.DetachResult;
  };
  RecordsApplied: {
    readonly connection: Transport.Connected;
    readonly result: Extract<Transport.ApplyResult, { readonly _tag: "Applied" }>;
  };
  RecordsCleaned: {
    readonly connection: Transport.Connected;
    readonly result: Extract<Transport.CleanupResult, { readonly _tag: "Cleaned" }>;
  };
  RecordsPartiallyApplied: {
    readonly connection: Transport.Connected;
    readonly result: Extract<Transport.ApplyResult, { readonly _tag: "Partial" }>;
  };
  RecordsPartiallyCleaned: {
    readonly connection: Transport.Connected;
    readonly result: Extract<Transport.CleanupResult, { readonly _tag: "Partial" }>;
  };
}>;

export const Event = Data.taggedEnum<Event>();

export type Listener = (event: Event) => void;
