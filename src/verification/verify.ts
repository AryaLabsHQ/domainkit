import { Effect, Schema } from "effect";

import type * as DomainName from "../domain/domain-name.ts";
import * as DnsRecord from "../domain/dns-record.ts";
import * as DnsProvider from "../provider/provider.ts";
import * as DnsData from "./dns-data.ts";
import * as DnsResolver from "./resolver.ts";

export const ProviderObservation = Schema.TaggedUnion({
  match: {},
  missing: {},
  mismatch: { records: Schema.Array(DnsRecord.Schema) },
  failure: { message: Schema.String },
});
export type ProviderObservation = typeof ProviderObservation.Type;

export const PublicDnsObservation = Schema.TaggedUnion({
  propagated: {},
  missing: {},
  mismatch: { answers: Schema.Array(Schema.String) },
  timeout: {},
  failure: { message: Schema.String },
});
export type PublicDnsObservation = typeof PublicDnsObservation.Type;

export const Result = Schema.Struct({
  provider: ProviderObservation,
  publicDns: PublicDnsObservation,
  status: Schema.Literals(["verified", "pending", "mismatch", "unavailable"]),
});
export interface Result extends Schema.Schema.Type<typeof Result> {}

export const record = Effect.fn("Verification.record")(function* (input: {
  readonly record: DnsRecord.DnsRecord;
  readonly zone: DomainName.DomainName;
}) {
  const provider = yield* DnsProvider.Service;
  const resolver = yield* DnsResolver.Service;
  const [providerObservation, publicDns] = yield* Effect.all(
    [
      observeProvider(provider, input.zone, input.record).pipe(
        Effect.catch((failure) =>
          Effect.succeed<ProviderObservation>({ _tag: "failure", message: failure.message }),
        ),
      ),
      resolver.resolve({ name: input.record.name, type: input.record._tag }).pipe(
        Effect.match({
          onFailure: (failure): PublicDnsObservation =>
            failure.reason === "timeout"
              ? { _tag: "timeout" }
              : { _tag: "failure", message: failure.message },
          onSuccess: (resolution) => observePublicDns(input.record, resolution),
        }),
      ),
    ] as const,
    { concurrency: "unbounded" },
  );
  const status: Result["status"] =
    providerObservation._tag === "match" && publicDns._tag === "propagated"
      ? "verified"
      : providerObservation._tag === "failure" ||
          publicDns._tag === "failure" ||
          publicDns._tag === "timeout"
        ? "unavailable"
        : providerObservation._tag === "mismatch" || publicDns._tag === "mismatch"
          ? "mismatch"
          : "pending";
  return { provider: providerObservation, publicDns, status };
});

function observeProvider(
  provider: DnsProvider.Interface,
  zone: DomainName.DomainName,
  requirement: DnsRecord.DnsRecord,
): Effect.Effect<ProviderObservation, DnsProvider.Error> {
  return provider.listRecords(zone).pipe(
    Effect.map((records): ProviderObservation => {
      if (records.some((existing) => DnsRecord.equals(existing, requirement))) {
        return { _tag: "match" };
      }
      const sameSet = records.filter(
        (existing) => existing.name === requirement.name && existing._tag === requirement._tag,
      );
      return sameSet.length === 0 ? { _tag: "missing" } : { _tag: "mismatch", records: sameSet };
    }),
  );
}

function observePublicDns(
  requirement: DnsRecord.DnsRecord,
  resolution: DnsResolver.Resolution,
): PublicDnsObservation {
  if (resolution._tag === "nodata") return { _tag: "missing" };
  const expected = DnsData.parse(requirement._tag, recordValue(requirement));
  return resolution.answers.some(
    (answer) =>
      answer.name === requirement.name &&
      answer.type === requirement._tag &&
      DnsData.parse(answer.type, answer.data) === expected,
  )
    ? { _tag: "propagated" }
    : { _tag: "mismatch", answers: resolution.answers.map(({ data }) => data) };
}

function recordValue(requirement: DnsRecord.DnsRecord): string {
  const data = DnsRecord.data(requirement);
  switch (requirement._tag) {
    case "A":
    case "AAAA":
      return String(data.address);
    case "CNAME":
    case "NS":
      return String(data.target);
    case "TXT":
      return String(data.value);
    case "MX":
      return `${data.priority} ${data.exchange}`;
    case "CAA":
      return `${data.flags} ${data.tag} ${data.value}`;
    case "SRV":
      return `${data.priority} ${data.weight} ${data.port} ${data.target}`;
  }
}
