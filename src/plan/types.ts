import { Schema } from "effect";

import { DomainName } from "../domain/domain-name.ts";
import { DnsRecord } from "../domain/dns-record.ts";

export const PlanOperation = Schema.Union([
  Schema.TaggedStruct("create", {
    id: Schema.String,
    requirement: DnsRecord,
  }),
  Schema.TaggedStruct("noop", {
    id: Schema.String,
    requirement: DnsRecord,
    ttlDrift: Schema.Boolean,
  }),
  Schema.TaggedStruct("conflict", {
    existing: Schema.Array(DnsRecord),
    id: Schema.String,
    reason: Schema.String,
    requirement: DnsRecord,
  }),
]);
export type PlanOperation = typeof PlanOperation.Type;

export const DnsPlan = Schema.Struct({
  digest: Schema.String,
  operations: Schema.Array(PlanOperation),
  providerId: Schema.String,
  version: Schema.Literal("domainkit.dns-plan.v1"),
  zone: DomainName,
});
export type DnsPlan = typeof DnsPlan.Type;

export const PlanAuthorization = Schema.Struct({
  allowPartial: Schema.Boolean,
  operationIds: Schema.Array(Schema.String),
  planDigest: Schema.String,
  version: Schema.Literal("domainkit.plan-authorization.v1"),
});
export type PlanAuthorization = typeof PlanAuthorization.Type;

export const ApplyReceipt = Schema.Struct({
  appliedAt: Schema.String,
  operations: Schema.Array(
    Schema.Struct({
      operationId: Schema.String,
      providerRecordId: Schema.NullOr(Schema.String),
    }),
  ),
  planDigest: Schema.String,
  providerId: Schema.String,
  version: Schema.Literal("domainkit.apply-receipt.v1"),
  zone: DomainName,
});
export type ApplyReceipt = typeof ApplyReceipt.Type;

export const decodeDnsPlan = Schema.decodeUnknownSync(DnsPlan);
export const encodeDnsPlan = Schema.encodeSync(DnsPlan);
export const decodeApplyReceipt = Schema.decodeUnknownSync(ApplyReceipt);
export const encodeApplyReceipt = Schema.encodeSync(ApplyReceipt);
