import { Effect } from "effect";

import type { DomainName } from "../domain/domain-name.ts";
import type { DnsRecord } from "../domain/dns-record.ts";
import { recordData, sameRecordData } from "../domain/dns-record.ts";
import type { ProviderError } from "../errors.ts";
import { DnsProvider, type DnsProviderService } from "../provider/provider.ts";
import { normalizeDnsData } from "./cloudflare-doh.ts";
import { DnsResolver, type DnsResolution, type DnsResolverService } from "./resolver.ts";

export type ProviderObservation =
  | { readonly _tag: "match" }
  | { readonly _tag: "missing" }
  | { readonly _tag: "mismatch"; readonly records: ReadonlyArray<DnsRecord> }
  | { readonly _tag: "failure"; readonly message: string };

export type PublicDnsObservation =
  | { readonly _tag: "propagated" }
  | { readonly _tag: "missing" }
  | { readonly _tag: "mismatch"; readonly answers: ReadonlyArray<string> }
  | { readonly _tag: "timeout" }
  | { readonly _tag: "failure"; readonly message: string };

export interface RecordVerification {
  readonly provider: ProviderObservation;
  readonly publicDns: PublicDnsObservation;
  readonly status: "verified" | "pending" | "mismatch" | "unavailable";
}

export function verifyRecord(input: {
  readonly record: DnsRecord;
  readonly zone: DomainName;
}): Effect.Effect<RecordVerification, never, DnsProviderService | DnsResolverService> {
  return Effect.gen(function* () {
    const providerService = yield* DnsProvider;
    const resolver = yield* DnsResolver;
    const [provider, resolution] = yield* Effect.all(
      [
        observeProvider(providerService, input.zone, input.record).pipe(
          Effect.catch((failure) =>
            Effect.succeed<ProviderObservation>({
              _tag: "failure",
              message: failure.message,
            }),
          ),
        ),
        resolver.resolve({ name: input.record.name, type: input.record._tag }).pipe(
          Effect.match({
            onFailure: (failure): PublicDnsObservation =>
              failure.reason === "timeout"
                ? { _tag: "timeout" }
                : { _tag: "failure", message: failure.message },
            onSuccess: (value) => observePublicDns(input.record, value),
          }),
        ),
      ] as const,
      { concurrency: "unbounded" },
    );
    const status =
      provider._tag === "match" && resolution._tag === "propagated"
        ? "verified"
        : provider._tag === "failure" ||
            resolution._tag === "failure" ||
            resolution._tag === "timeout"
          ? "unavailable"
          : provider._tag === "mismatch" || resolution._tag === "mismatch"
            ? "mismatch"
            : "pending";
    return { provider, publicDns: resolution, status };
  });
}

function observeProvider(
  provider: DnsProviderService,
  zone: DomainName,
  record: DnsRecord,
): Effect.Effect<ProviderObservation, ProviderError> {
  return provider.listRecords(zone).pipe(
    Effect.map((records): ProviderObservation => {
      if (records.some((existing) => sameRecordData(existing, record))) return { _tag: "match" };
      const sameSet = records.filter(
        (existing) => existing.name === record.name && existing._tag === record._tag,
      );
      return sameSet.length === 0 ? { _tag: "missing" } : { _tag: "mismatch", records: sameSet };
    }),
  );
}

function observePublicDns(record: DnsRecord, resolution: DnsResolution): PublicDnsObservation {
  if (resolution._tag === "nodata") return { _tag: "missing" };
  const expected = normalizeDnsData(record._tag, recordValue(record));
  return resolution.answers.some(
    (answer) =>
      answer.name === record.name &&
      answer.type === record._tag &&
      normalizeDnsData(answer.type, answer.data) === expected,
  )
    ? { _tag: "propagated" }
    : { _tag: "mismatch", answers: resolution.answers.map(({ data }) => data) };
}

function recordValue(record: DnsRecord): string {
  const data = recordData(record);
  switch (record._tag) {
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
