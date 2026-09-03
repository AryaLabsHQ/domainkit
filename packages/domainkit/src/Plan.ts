/**
 * A reviewable, digest-bound set of DNS operations. Plans are additive and fail closed: matching
 * records are `Noop`, missing records are `Create`, incompatible state is `Conflict`. A
 * provisioning plan never updates or deletes; a cleanup plan carries `Delete` operations for
 * records a receipt proves DomainKit created.
 */
import { Effect, Schema } from "effect";

import * as DnsRecord from "./DnsRecord.ts";
import * as Errors from "./internal/error.ts";

export const PlanId = Schema.String.pipe(Schema.brand("@domainkit/PlanId"));
export type PlanId = typeof PlanId.Type;

export const Digest = Schema.String.pipe(Schema.brand("@domainkit/Digest"));
export type Digest = typeof Digest.Type;

export const OperationId = Schema.String.pipe(Schema.brand("@domainkit/OperationId"));
export type OperationId = typeof OperationId.Type;

export const Kind = Schema.Literals(["provisioning", "cleanup"]);
export type Kind = typeof Kind.Type;

export class Create extends Schema.TaggedClass<Create>("@domainkit/Plan/Create")("Create", {
  id: OperationId,
  record: DnsRecord.Model,
}) {}
export class Noop extends Schema.TaggedClass<Noop>("@domainkit/Plan/Noop")("Noop", {
  id: OperationId,
  record: DnsRecord.Model,
  existing: DnsRecord.Observed,
  ttlDrift: Schema.Boolean,
}) {}
export class Conflict extends Schema.TaggedClass<Conflict>("@domainkit/Plan/Conflict")("Conflict", {
  id: OperationId,
  record: DnsRecord.Model,
  existing: Schema.Array(DnsRecord.Observed),
  reason: Schema.Literals([
    "exclusive-name",
    "cname-collision",
    "value-mismatch",
    "opaque",
    "missing",
  ]),
}) {}
/** Cleanup only: remove the provider record a receipt proves DomainKit created. */
export class Delete extends Schema.TaggedClass<Delete>("@domainkit/Plan/Delete")("Delete", {
  id: OperationId,
  record: DnsRecord.Model,
  providerRecordId: Schema.String,
}) {}
export const Operation = Schema.Union([Create, Noop, Conflict, Delete]);
export type Operation = typeof Operation.Type;

export const Version = Schema.Literal("domainkit.plan.v2");

export class Model extends Schema.Class<Model>("@domainkit/Plan")({
  id: PlanId,
  version: Version,
  kind: Kind,
  digest: Digest,
  domain: Schema.String,
  zone: Schema.String,
  provider: Schema.String,
  attachmentId: Schema.String,
  operations: Schema.Array(Operation),
  createdAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
}) {}
export type Encoded = typeof Model.Encoded;

export const decode = (input: unknown): Effect.Effect<Model, Errors.DomainKitError> =>
  Errors.decode(Model, input);
export const encode: (plan: Model) => Encoded = Schema.encodeSync(Model);

/** `true` when the plan has no conflicts and at least one write (`Create` or `Delete`). */
export const isApplicable = (plan: Model): boolean =>
  conflicts(plan).length === 0 && writes(plan).length > 0;

export const conflicts = (plan: Model): ReadonlyArray<Conflict> =>
  plan.operations.filter((operation): operation is Conflict => operation._tag === "Conflict");

/** The operations that would touch the provider: creates for provisioning, deletes for cleanup. */
export const writes = (plan: Model): ReadonlyArray<Create | Delete> =>
  plan.operations.filter(
    (operation): operation is Create | Delete =>
      operation._tag === "Create" || operation._tag === "Delete",
  );

/** Manual instructions for hosts whose customers apply records by hand. */
export const renderInstructions = (plan: Model): string =>
  plan.operations
    .map((operation) => {
      const verb =
        operation._tag === "Create"
          ? "ADD"
          : operation._tag === "Delete"
            ? "REMOVE"
            : operation._tag === "Noop"
              ? "KEEP"
              : `CONFLICT (${operation.reason})`;
      const record = operation.record;
      const ttl = record.ttl === null ? "" : ` ttl=${record.ttl}`;
      return `${verb} ${record._tag} ${record.name} ${DnsRecord.data(record)}${ttl}`;
    })
    .join("\n");
