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
  code: Schema.optionalKey(Schema.Number),
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
  readonly listRecords: (
    zone: DomainName.DomainName,
  ) => Effect.Effect<ReadonlyArray<DnsRecord.DnsRecord>, Error>;
}

export class Service extends Context.Service<Service, Interface>()("@domainkit/DnsProvider") {}

/** Minimal Promise-shaped provider contract for hosts that do not use Effect directly. */
export interface AsyncInterface {
  readonly id: string;
  readonly createRecord: (
    zone: DomainName.DomainName,
    record: DnsRecord.DnsRecord,
  ) => Promise<CreateResult>;
  readonly listRecords: (
    zone: DomainName.DomainName,
  ) => Promise<ReadonlyArray<DnsRecord.DnsRecord>>;
}

export const layerFromAsync = (provider: AsyncInterface): Layer.Layer<Service> =>
  Layer.succeed(Service, {
    id: provider.id,
    createRecord: Effect.fn("DnsProvider.createRecord")((zone, record) =>
      Effect.tryPromise({
        try: () => provider.createRecord(zone, record),
        catch: (cause) => failure(provider, "createRecord", cause),
      }),
    ),
    listRecords: Effect.fn("DnsProvider.listRecords")((zone) =>
      Effect.tryPromise({
        try: () => provider.listRecords(zone),
        catch: (cause) => failure(provider, "listRecords", cause),
      }),
    ),
  });

export const toAsync = (provider: Interface): AsyncInterface => ({
  id: provider.id,
  createRecord: (zone, record) => Effect.runPromise(provider.createRecord(zone, record)),
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
