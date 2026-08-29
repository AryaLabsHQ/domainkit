import { Context, Effect, Layer, Schema } from "effect";

import type * as DomainName from "../domain/domain-name.ts";
import type * as DnsRecord from "../domain/dns-record.ts";

export interface CreateResult {
  readonly providerRecordId: string | null;
}

export const ErrorReason = Schema.Literals([
  "authentication",
  "authorization",
  "conflict",
  "not_found",
  "rate_limit",
  "request",
  "response",
  "transport",
  "unsupported",
]);
export type ErrorReason = typeof ErrorReason.Type;

export class Error extends Schema.TaggedError<Error>()("ProviderError", {
  cause: Schema.optionalKey(Schema.Unknown),
  code: Schema.optionalKey(Schema.Union([Schema.Number, Schema.String])),
  message: Schema.String,
  operation: Schema.String,
  providerId: Schema.String,
  reason: Schema.optionalKey(ErrorReason),
  retryAfterMs: Schema.optionalKey(Schema.Number),
  status: Schema.optionalKey(Schema.Number),
}) {}

/** The provider capability used by DNS planning, application, and verification. */
export interface Interface {
  readonly id: string;
  readonly createRecord: (
    zone: DomainName.DomainName,
    record: DnsRecord.DnsRecord,
  ) => Effect.Effect<CreateResult, Error>;
  readonly deleteRecord: (
    zone: DomainName.DomainName,
    providerRecordId: string,
  ) => Effect.Effect<void, Error>;
  readonly getRecord: (
    zone: DomainName.DomainName,
    providerRecordId: string,
  ) => Effect.Effect<DnsRecord.Observed | null, Error>;
  readonly listRecords: (
    zone: DomainName.DomainName,
  ) => Effect.Effect<ReadonlyArray<DnsRecord.Observed>, Error>;
}

export class Service extends Context.Service<Service, Interface>()("@domainkit/DnsProvider") {}

/** Minimal Promise-shaped provider contract for hosts that do not use Effect directly. */
export interface AsyncInterface {
  readonly id: string;
  readonly createRecord: (
    zone: DomainName.DomainName,
    record: DnsRecord.DnsRecord,
  ) => Promise<CreateResult>;
  readonly deleteRecord: (zone: DomainName.DomainName, providerRecordId: string) => Promise<void>;
  readonly getRecord: (
    zone: DomainName.DomainName,
    providerRecordId: string,
  ) => Promise<DnsRecord.Observed | null>;
  readonly listRecords: (zone: DomainName.DomainName) => Promise<ReadonlyArray<DnsRecord.Observed>>;
}

export const fromAsync = (provider: AsyncInterface): Interface =>
  Service.of({
    id: provider.id,
    createRecord: Effect.fn("DnsProvider.createRecord")((zone, record) =>
      Effect.tryPromise({
        try: () => provider.createRecord(zone, record),
        catch: (cause) => failure(provider, "createRecord", cause),
      }),
    ),
    deleteRecord: Effect.fn("DnsProvider.deleteRecord")((zone, providerRecordId) =>
      Effect.tryPromise({
        try: () => provider.deleteRecord(zone, providerRecordId),
        catch: (cause) => failure(provider, "deleteRecord", cause),
      }),
    ),
    getRecord: Effect.fn("DnsProvider.getRecord")((zone, providerRecordId) =>
      Effect.tryPromise({
        try: () => provider.getRecord(zone, providerRecordId),
        catch: (cause) => failure(provider, "getRecord", cause),
      }),
    ),
    listRecords: Effect.fn("DnsProvider.listRecords")((zone) =>
      Effect.tryPromise({
        try: () => provider.listRecords(zone),
        catch: (cause) => failure(provider, "listRecords", cause),
      }),
    ),
  });

export const layerFromAsync = (provider: AsyncInterface): Layer.Layer<Service> =>
  Layer.succeed(Service, fromAsync(provider));

export const toAsync = (provider: Interface): AsyncInterface => ({
  id: provider.id,
  createRecord: (zone, record) => Effect.runPromise(provider.createRecord(zone, record)),
  deleteRecord: (zone, providerRecordId) =>
    Effect.runPromise(provider.deleteRecord(zone, providerRecordId)),
  getRecord: (zone, providerRecordId) =>
    Effect.runPromise(provider.getRecord(zone, providerRecordId)),
  listRecords: (zone) => Effect.runPromise(provider.listRecords(zone)),
});

function failure(provider: AsyncInterface, operation: string, cause: unknown): Error {
  return cause instanceof Error
    ? cause
    : new Error({
        cause,
        message: cause instanceof globalThis.Error ? cause.message : String(cause),
        operation,
        providerId: provider.id,
      });
}
