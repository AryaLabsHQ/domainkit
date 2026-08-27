import { Context, Effect, Layer } from "effect";

import type { DomainName } from "../domain/domain-name.ts";
import type { DnsRecord } from "../domain/dns-record.ts";
import { ProviderError } from "../errors.ts";

export interface ProviderCreateResult {
  readonly providerRecordId: string | null;
}

/** The canonical provider capability required by the additive v0.1 interpreter. */
export interface DnsProviderService {
  readonly id: string;
  /**
   * Creates one approved record. DomainKit does not assume this operation is conditional or part of
   * a provider transaction; callers receive a partial receipt if a later operation fails.
   */
  readonly createRecord: (
    zone: DomainName,
    record: DnsRecord,
  ) => Effect.Effect<ProviderCreateResult, ProviderError>;
  readonly listRecords: (
    zone: DomainName,
  ) => Effect.Effect<ReadonlyArray<DnsRecord>, ProviderError>;
}

export const DnsProvider = Context.Service<DnsProviderService>("domainkit/DnsProvider");

/** An ordinary async provider implementation accepted by the Promise facade. */
export interface PromiseDnsProvider {
  readonly id: string;
  readonly createRecord: (zone: DomainName, record: DnsRecord) => Promise<ProviderCreateResult>;
  readonly listRecords: (zone: DomainName) => Promise<ReadonlyArray<DnsRecord>>;
}

/** Bridges an ordinary async provider into the canonical Effect capability. */
export function layerDnsProviderFromPromise(
  provider: PromiseDnsProvider,
): Layer.Layer<DnsProviderService> {
  const providerError = (cause: unknown) =>
    cause instanceof ProviderError
      ? cause
      : new ProviderError({ message: messageOf(cause), providerId: provider.id });
  return Layer.succeed(DnsProvider)({
    id: provider.id,
    createRecord: (zone, record) =>
      Effect.tryPromise({
        try: () => provider.createRecord(zone, record),
        catch: providerError,
      }),
    listRecords: (zone) =>
      Effect.tryPromise({ try: () => provider.listRecords(zone), catch: providerError }),
  });
}

/** Adapts an Effect-native provider for a Promise-only host or test harness. */
export function toPromiseDnsProvider(provider: DnsProviderService): PromiseDnsProvider {
  return {
    id: provider.id,
    createRecord: (zone, record) => Effect.runPromise(provider.createRecord(zone, record)),
    listRecords: (zone) => Effect.runPromise(provider.listRecords(zone)),
  };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
