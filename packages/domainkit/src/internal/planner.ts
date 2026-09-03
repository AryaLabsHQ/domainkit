import { Effect, Schema } from "effect";

import * as DnsRecord from "../DnsRecord.ts";
import * as Errors from "./error.ts";
import * as Reason from "../Reason.ts";
import * as Plan from "../Plan.ts";
import { sha256Hex, stringify } from "./digest.ts";

const Unsigned = Schema.Struct({
  version: Plan.Version,
  kind: Plan.Kind,
  domain: Schema.String,
  zone: Schema.String,
  provider: Schema.String,
  attachmentId: Schema.String,
  operations: Schema.Array(Plan.Operation),
});
export type Unsigned = typeof Unsigned.Type;

export const operationId = (
  record: DnsRecord.Model,
): Effect.Effect<Plan.OperationId, Errors.DomainKitError> =>
  sha256Hex(stringify({ record: strip(record) })).pipe(Effect.map(Plan.OperationId.make));

/** The digest covers every operation but not requirement labels, which are display metadata. */
export const digest = (unsigned: Unsigned): Effect.Effect<Plan.Digest, Errors.DomainKitError> =>
  Effect.try({
    try: () => {
      const encoded = Schema.encodeSync(Unsigned)(unsigned);
      return stringify({
        ...encoded,
        operations: encoded.operations.map((operation) => ({
          ...operation,
          record: withoutPurpose(operation.record),
        })),
      });
    },
    catch: () =>
      new Errors.DomainKitError({
        reason: new Reason.CryptoFailed({ operation: "digest" }),
      }),
  }).pipe(Effect.flatMap(sha256Hex), Effect.map(Plan.Digest.make));

const withoutPurpose = (record: DnsRecord.Encoded): DnsRecord.Encoded => {
  const { purpose: _purpose, ...rest } = record;
  return rest;
};

/** Additive, fail-closed reconciliation of requirements against what the provider holds. */
export const reconcile = (
  requirements: ReadonlyArray<DnsRecord.Model>,
  existing: ReadonlyArray<DnsRecord.Observed>,
): Effect.Effect<ReadonlyArray<Plan.Create | Plan.Noop | Plan.Conflict>, Errors.DomainKitError> =>
  Effect.gen(function* () {
    const sorted = [...requirements].sort(compare);
    const projected: Array<DnsRecord.Observed> = [...existing].sort(compare);
    const operations: Array<Plan.Create | Plan.Noop | Plan.Conflict> = [];
    for (const record of sorted) {
      const id = yield* operationId(record);
      const operation = reconcileOne(id, record, projected);
      operations.push(operation);
      if (operation._tag === "Create") projected.push(record);
    }
    return operations;
  });

const reconcileOne = (
  id: Plan.OperationId,
  record: DnsRecord.Model,
  existing: ReadonlyArray<DnsRecord.Observed>,
): Plan.Create | Plan.Noop | Plan.Conflict => {
  const sameName = existing.filter((candidate) => candidate.name === record.name);
  const exact = sameName.find((candidate) => DnsRecord.equals(candidate, record));
  if (exact !== undefined) {
    return new Plan.Noop({
      id,
      record,
      existing: exact,
      ttlDrift: exact._tag !== "Opaque" && exact.ttl !== record.ttl,
    });
  }
  const conflict = (reason: Plan.Conflict["reason"], culprits: ReadonlyArray<DnsRecord.Observed>) =>
    new Plan.Conflict({ id, record, existing: culprits, reason });
  if (
    sameName.length > 0 &&
    (record._tag === "CNAME" || sameName.some((candidate) => candidate._tag === "CNAME"))
  ) {
    return conflict("cname-collision", sameName);
  }
  const sameSet = sameName.filter((candidate) => DnsRecord.sameSet(candidate, record));
  if (sameSet.some((candidate) => candidate._tag === "Opaque")) return conflict("opaque", sameSet);
  if (record.policy === "exclusive" && sameSet.length > 0)
    return conflict("exclusive-name", sameSet);
  return new Plan.Create({ id, record });
};

/** Requirements a plan was built from, for re-planning at apply time. */
export const requirements = (plan: Plan.Model): ReadonlyArray<DnsRecord.Model> =>
  plan.operations.map((operation) => operation.record);

/** Operation ids hash the encoded requirement without its label, so relabeling never invalidates a plan. */
function strip(record: DnsRecord.Model): DnsRecord.Encoded {
  return withoutPurpose(Schema.encodeSync(DnsRecord.Model)(record));
}

function compare(left: DnsRecord.Observed, right: DnsRecord.Observed): number {
  const encode = Schema.encodeSync(DnsRecord.Observed);
  const leftKey = stringify(encode(left));
  const rightKey = stringify(encode(right));
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}
