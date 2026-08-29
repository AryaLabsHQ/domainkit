import { Context, Data, Effect, Schema } from "effect";

import type * as DomainName from "../domain/domain-name.ts";
import * as Domain from "../domain/domain-name.ts";
import * as DnsProvider from "../provider/provider.ts";
import * as Zones from "./zones.ts";

/** Display-safe identity and nameserver evidence for one provider-owned zone. */
export const Candidate = Schema.Struct({
  accountId: Schema.String,
  id: Schema.String,
  name: Domain.Schema,
  nameservers: Schema.Array(Domain.Schema),
  providerId: Schema.String,
  status: Schema.Literals(["active", "pending", "unknown"]),
});
export interface Candidate extends Schema.Schema.Type<typeof Candidate> {}

export interface Source {
  readonly listZones: (
    name: DomainName.DomainName,
  ) => Effect.Effect<ReadonlyArray<Omit<Candidate, "providerId">>, DnsProvider.Error>;
  readonly provider: DnsProvider.Interface;
}

export type Outcome = Data.TaggedEnum<{
  NotFound: { readonly domain: DomainName.DomainName };
  Resolved: { readonly candidate: Candidate; readonly provider: DnsProvider.Interface };
  SelectionRequired: { readonly candidates: ReadonlyArray<Candidate> };
}>;
export const Outcome = Data.taggedEnum<Outcome>();

export interface Interface {
  readonly discover: (domain: DomainName.DomainName) => Effect.Effect<Outcome, DnsProvider.Error>;
}

export class Service extends Context.Service<Service, Interface>()("@domainkit/ZoneDiscovery") {}

/** Compose provider-account discovery sources without expanding the record-provider contract. */
export function make(sources: ReadonlyArray<Source>): Interface {
  return Service.of({
    discover: Effect.fn("ZoneDiscovery.discover")(function* (domain) {
      for (const name of Zones.candidates(domain)) {
        const matches = deduplicate(
          (yield* Effect.forEach(
            sources,
            (source) =>
              source.listZones(name).pipe(
                Effect.map((zones) =>
                  zones.map((zone) => ({
                    candidate: { ...zone, providerId: source.provider.id },
                    provider: source.provider,
                  })),
                ),
              ),
            { concurrency: "unbounded" },
          )).flat(),
        );
        const match = matches[0];
        if (matches.length === 1 && match !== undefined) {
          return Outcome.Resolved(match);
        }
        if (matches.length > 1) {
          return Outcome.SelectionRequired({
            candidates: matches.map(({ candidate }) => candidate),
          });
        }
      }
      return Outcome.NotFound({ domain });
    }),
  });
}

function deduplicate(
  matches: ReadonlyArray<{
    readonly candidate: Candidate;
    readonly provider: DnsProvider.Interface;
  }>,
): ReadonlyArray<{
  readonly candidate: Candidate;
  readonly provider: DnsProvider.Interface;
}> {
  const unique = new Map<string, (typeof matches)[number]>();
  for (const match of matches) {
    const key = [
      match.candidate.providerId,
      match.candidate.accountId,
      match.candidate.id,
      match.candidate.name,
    ].join(":");
    const existing = unique.get(key);
    if (existing === undefined) unique.set(key, match);
  }
  return [...unique.values()].sort((left, right) =>
    candidateKey(left.candidate).localeCompare(candidateKey(right.candidate)),
  );
}

function candidateKey(candidate: Candidate): string {
  return [candidate.name, candidate.providerId, candidate.accountId, candidate.id].join(":");
}
