import { Effect, Schema as S } from "effect";

import * as DomainName from "../domain/domain-name.ts";
import * as DnsRecord from "../domain/dns-record.ts";
import { Error as InvalidInputError } from "../invalid-input.ts";

export const Operation = S.TaggedUnion({
  create: {
    id: S.String,
    requirement: DnsRecord.Schema,
  },
  noop: {
    id: S.String,
    requirement: DnsRecord.Schema,
    ttlDrift: S.Boolean,
  },
  conflict: {
    existing: S.Array(DnsRecord.Schema),
    id: S.String,
    reason: S.String,
    requirement: DnsRecord.Schema,
  },
});
export type Operation = typeof Operation.Type;

export const Schema = S.Struct({
  digest: S.String,
  operations: S.Array(Operation),
  providerId: S.String,
  version: S.Literal("domainkit.dns-plan.v1"),
  zone: DomainName.Schema,
});
export interface DnsPlan extends S.Schema.Type<typeof Schema> {}

export const Authorization = S.Struct({
  allowPartial: S.Boolean,
  operationIds: S.Array(S.String),
  planDigest: S.String,
  version: S.Literal("domainkit.plan-authorization.v1"),
});
export interface PlanAuthorization extends S.Schema.Type<typeof Authorization> {}

export const Receipt = S.Struct({
  appliedAt: S.DateFromString,
  operations: S.Array(
    S.Struct({
      operationId: S.String,
      providerRecordId: S.NullOr(S.String),
    }),
  ),
  planDigest: S.String,
  providerId: S.String,
  status: S.Literals(["complete", "partial"]),
  version: S.Literal("domainkit.apply-receipt.v1"),
  zone: DomainName.Schema,
});
export interface ApplyReceipt extends S.Schema.Type<typeof Receipt> {}

export const decode = Effect.fn("DnsPlan.decode")((input: unknown) =>
  S.decodeUnknownEffect(Schema)(input).pipe(
    Effect.mapError((cause) => new InvalidInputError({ message: cause.message })),
  ),
);

export const encode = S.encodeSync(Schema);
export const decodeReceipt = Effect.fn("DnsPlan.decodeReceipt")((input: unknown) =>
  S.decodeUnknownEffect(Receipt)(input).pipe(
    Effect.mapError((cause) => new InvalidInputError({ message: cause.message })),
  ),
);
export const encodeReceipt = S.encodeSync(Receipt);
