import { Effect } from "effect";

import type * as DomainName from "../domain/domain-name.ts";
import type * as DnsProvider from "../provider/provider.ts";
import * as Provider from "../provider/provider.ts";
import * as Discovery from "../discovery/zone-discovery.ts";

export interface Source {
  readonly listZones: (
    name: DomainName.DomainName,
  ) => Promise<ReadonlyArray<Omit<Discovery.Candidate, "providerId">>>;
  readonly provider: DnsProvider.AsyncInterface;
}

export type Outcome =
  | { readonly _tag: "NotFound"; readonly domain: DomainName.DomainName }
  | { readonly _tag: "Resolved"; readonly candidate: Discovery.Candidate }
  | { readonly _tag: "SelectionRequired"; readonly candidates: ReadonlyArray<Discovery.Candidate> };

export function discover(input: {
  readonly domain: DomainName.DomainName;
  readonly sources: ReadonlyArray<Source>;
}): Promise<Outcome> {
  return Effect.runPromise(
    Discovery.make(input.sources.map(toEffectSource))
      .discover(input.domain)
      .pipe(Effect.map(projectOutcome)),
  );
}

export function toEffectSource(source: Source): Discovery.Source {
  return {
    listZones: (name) =>
      Effect.tryPromise({
        try: () => source.listZones(name),
        catch: (cause) =>
          new Provider.Error({
            cause,
            message: cause instanceof globalThis.Error ? cause.message : String(cause),
            operation: "ZoneDiscovery.listZones",
            providerId: source.provider.id,
            reason: "transport",
          }),
      }),
    provider: Provider.Service.of({
      id: source.provider.id,
      createRecord: (zone, record) =>
        Effect.tryPromise({
          try: () => source.provider.createRecord(zone, record),
          catch: (cause) => providerFailure(source.provider.id, "createRecord", cause),
        }),
      deleteRecord: (zone, providerRecordId) =>
        Effect.tryPromise({
          try: () => source.provider.deleteRecord(zone, providerRecordId),
          catch: (cause) => providerFailure(source.provider.id, "deleteRecord", cause),
        }),
      getRecord: (zone, providerRecordId) =>
        Effect.tryPromise({
          try: () => source.provider.getRecord(zone, providerRecordId),
          catch: (cause) => providerFailure(source.provider.id, "getRecord", cause),
        }),
      listRecords: (zone) =>
        Effect.tryPromise({
          try: () => source.provider.listRecords(zone),
          catch: (cause) => providerFailure(source.provider.id, "listRecords", cause),
        }),
    }),
  };
}

function projectOutcome(outcome: Discovery.Outcome): Outcome {
  switch (outcome._tag) {
    case "NotFound":
      return outcome;
    case "Resolved":
      return { _tag: "Resolved", candidate: outcome.candidate };
    case "SelectionRequired":
      return outcome;
  }
}

function providerFailure(providerId: string, operation: string, cause: unknown): Provider.Error {
  return cause instanceof Provider.Error
    ? cause
    : new Provider.Error({
        cause,
        message: cause instanceof globalThis.Error ? cause.message : String(cause),
        operation,
        providerId,
      });
}

export { Candidate } from "../discovery/zone-discovery.ts";
