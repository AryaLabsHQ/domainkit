import { Data, Effect, Option } from "effect";

import type * as DomainName from "../domain/domain-name.ts";
import * as DnsRecord from "../domain/dns-record.ts";
import * as DnsProvider from "../provider/provider.ts";
import * as DnsData from "./dns-data.ts";
import * as DnsResolverPool from "./resolver-pool.ts";

export type PublicDns = Data.TaggedEnum<{
  Disabled: {};
  Enabled: { readonly policy?: DnsResolverPool.Policy };
}>;
export const PublicDns = Data.taggedEnum<PublicDns>();

export type Provider = Data.TaggedEnum<{
  Disabled: {};
  Enabled: { readonly zone: DomainName.DomainName };
}>;
export const Provider = Data.taggedEnum<Provider>();

type ProviderEnabled = Extract<Provider, { readonly _tag: "Enabled" }>;
type ProviderDisabled = Extract<Provider, { readonly _tag: "Disabled" }>;

export interface PublicOnlyConfig {
  readonly provider?: ProviderDisabled;
  readonly publicDns?: PublicDns;
  readonly record: DnsRecord.DnsRecord;
}

export interface ProviderConfig {
  readonly provider: ProviderEnabled;
  readonly publicDns?: PublicDns;
  readonly record: DnsRecord.DnsRecord;
}

export type Config = ProviderConfig | PublicOnlyConfig;

export type ProviderObservation = Data.TaggedEnum<{
  Matched: {};
  Mismatch: { readonly records: ReadonlyArray<DnsRecord.DnsRecord> };
  Pending: {};
  Unavailable: { readonly message: string };
}>;
export const ProviderObservation = Data.taggedEnum<ProviderObservation>();

export type PublicDnsObservation = Data.TaggedEnum<{
  Verified: {
    readonly evidence: ReadonlyArray<DnsResolverPool.Observation>;
    readonly matchedResolverIds: ReadonlyArray<string>;
  };
  Mismatch: { readonly evidence: ReadonlyArray<DnsResolverPool.Observation> };
  Pending: { readonly evidence: ReadonlyArray<DnsResolverPool.Observation> };
  Unavailable: { readonly evidence: ReadonlyArray<DnsResolverPool.Observation> };
}>;
export const PublicDnsObservation = Data.taggedEnum<PublicDnsObservation>();

interface Evidence {
  readonly provider: ProviderObservation | null;
  readonly publicDns: PublicDnsObservation | null;
}

export type Result = Data.TaggedEnum<{
  Mismatch: Evidence;
  NotObserved: Evidence;
  Pending: Evidence;
  Unavailable: Evidence;
  Verified: Evidence;
}>;
export const Result = Data.taggedEnum<Result>();

export function observe(input: PublicOnlyConfig): Effect.Effect<Result>;
export function observe(input: ProviderConfig): Effect.Effect<Result, never, DnsProvider.Service>;
export function observe(input: Config): Effect.Effect<Result, never, DnsProvider.Service>;
export function observe(input: Config): Effect.Effect<Result, never, DnsProvider.Service> {
  return observeEffect(input);
}

const observeEffect = Effect.fn("Verification.observe")(function* (input: Config) {
  const publicDns = input.publicDns ?? PublicDns.Enabled({});
  const provider = input.provider ?? Provider.Disabled();
  const publicEffect =
    publicDns._tag === "Disabled"
      ? Effect.succeed<PublicDnsObservation | null>(null)
      : observePublicDns(input.record, publicDns.policy ?? DnsResolverPool.Policy.AnyMatch());
  const providerEffect =
    provider._tag === "Disabled"
      ? Effect.succeed<ProviderObservation | null>(null)
      : Effect.flatMap(DnsProvider.Service, (service) =>
          observeProvider(service, provider.zone, input.record).pipe(
            Effect.catch((failure) =>
              Effect.succeed<ProviderObservation>(
                ProviderObservation.Unavailable({ message: failure.message }),
              ),
            ),
          ),
        );
  const [providerObservation, publicDnsObservation] = yield* Effect.all(
    [providerEffect, publicEffect] as const,
    { concurrency: "unbounded" },
  );
  return aggregate({ provider: providerObservation, publicDns: publicDnsObservation });
});

function observeProvider(
  provider: DnsProvider.Interface,
  zone: DomainName.DomainName,
  requirement: DnsRecord.DnsRecord,
): Effect.Effect<ProviderObservation, DnsProvider.Error> {
  return provider.listRecords(zone).pipe(
    Effect.map((records): ProviderObservation => {
      if (
        records.some(
          (existing) => existing._tag !== "Opaque" && DnsRecord.equals(existing, requirement),
        )
      ) {
        return ProviderObservation.Matched();
      }
      const sameSet = records.filter(
        (existing): existing is DnsRecord.DnsRecord =>
          existing._tag !== "Opaque" &&
          existing.name === requirement.name &&
          existing._tag === requirement._tag,
      );
      return sameSet.length === 0
        ? ProviderObservation.Pending()
        : ProviderObservation.Mismatch({ records: sameSet });
    }),
  );
}

function observePublicDns(
  requirement: DnsRecord.DnsRecord,
  policy: DnsResolverPool.Policy,
): Effect.Effect<PublicDnsObservation> {
  return Effect.gen(function* () {
    const configuredPool = yield* Effect.serviceOption(DnsResolverPool.Service);
    const pool = Option.getOrElse(configuredPool, () => DnsResolverPool.defaultMake());
    const evidence = yield* pool.observe({ name: requirement.name, type: requirement._tag });
    return evaluatePublicDns(requirement, policy, evidence);
  });
}

function evaluatePublicDns(
  requirement: DnsRecord.DnsRecord,
  policy: DnsResolverPool.Policy,
  evidence: ReadonlyArray<DnsResolverPool.Observation>,
): PublicDnsObservation {
  const matchedResolverIds = evidence.flatMap((observation) =>
    observation._tag === "Answer" && answersMatch(requirement, observation.answers)
      ? [observation.resolverId]
      : [],
  );
  const required =
    policy._tag === "AnyMatch" ? 1 : policy._tag === "AllMatch" ? evidence.length : policy.minimum;
  if (required > 0 && matchedResolverIds.length >= required) {
    return PublicDnsObservation.Verified({ evidence, matchedResolverIds });
  }
  const unavailable = evidence.filter(
    (observation) => observation._tag === "TimedOut" || observation._tag === "Failed",
  ).length;
  if (unavailable > 0 && matchedResolverIds.length + unavailable >= required) {
    return PublicDnsObservation.Unavailable({ evidence });
  }
  if (
    evidence.some(
      (observation) =>
        observation._tag === "Answer" && !answersMatch(requirement, observation.answers),
    )
  ) {
    return PublicDnsObservation.Mismatch({ evidence });
  }
  if (evidence.some((observation) => observation._tag === "NoData")) {
    return PublicDnsObservation.Pending({ evidence });
  }
  return PublicDnsObservation.Unavailable({ evidence });
}

function answersMatch(
  requirement: DnsRecord.DnsRecord,
  answers: ReadonlyArray<{ readonly data: string; readonly name: string; readonly type: string }>,
): boolean {
  const expected = DnsData.parse(requirement._tag, recordValue(requirement));
  return answers.some(
    (answer) =>
      answer.name === requirement.name &&
      answer.type === requirement._tag &&
      DnsData.parse(requirement._tag, answer.data) === expected,
  );
}

function aggregate(evidence: Evidence): Result {
  const requested = [evidence.provider, evidence.publicDns].filter(
    (observation): observation is ProviderObservation | PublicDnsObservation =>
      observation !== null,
  );
  if (requested.length === 0) return Result.NotObserved(evidence);
  if (
    requested.every(
      (observation) => observation._tag === "Matched" || observation._tag === "Verified",
    )
  ) {
    return Result.Verified(evidence);
  }
  if (requested.some((observation) => observation._tag === "Unavailable")) {
    return Result.Unavailable(evidence);
  }
  if (requested.some((observation) => observation._tag === "Mismatch")) {
    return Result.Mismatch(evidence);
  }
  return Result.Pending(evidence);
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
