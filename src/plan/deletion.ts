import { Clock, Crypto, Effect, Schema as S } from "effect";

import * as DomainName from "../domain/domain-name.ts";
import * as DnsRecord from "../domain/dns-record.ts";
import { Error as InvalidInputError } from "../invalid-input.ts";
import * as DnsProvider from "../provider/provider.ts";
import { CryptoError, sha256Encoded } from "./canonical-json.ts";
import * as Provisioning from "./plan.ts";
import * as DnsPlan from "./types.ts";

export const Operation = S.Struct({
  id: S.String,
  providerRecordId: S.String,
  record: DnsRecord.Schema,
});
export interface Operation extends S.Schema.Type<typeof Operation> {}

const UnsignedPlan = S.Struct({
  createdAt: S.DateFromString,
  expiresAt: S.DateFromString,
  operations: S.Array(Operation),
  providerId: S.String,
  sourcePlanDigest: S.String,
  version: S.Literal("domainkit.deletion-plan.v1"),
  zone: DomainName.Schema,
});

export const Plan = S.Struct({ ...UnsignedPlan.fields, digest: S.String });
export interface Plan extends S.Schema.Type<typeof Plan> {}

export const Authorization = S.Struct({
  operationIds: S.Array(S.String),
  planDigest: S.String,
  version: S.Literal("domainkit.deletion-authorization.v1"),
});
export interface Authorization extends S.Schema.Type<typeof Authorization> {}

export const Receipt = S.Struct({
  deletedAt: S.DateFromString,
  operations: S.Array(S.Struct({ operationId: S.String, providerRecordId: S.String })),
  planDigest: S.String,
  providerId: S.String,
  status: S.Literals(["complete", "partial"]),
  version: S.Literal("domainkit.deletion-receipt.v1"),
  zone: DomainName.Schema,
});
export interface Receipt extends S.Schema.Type<typeof Receipt> {}

export class Error extends S.TaggedError<Error>()("UnsafeDeletionError", {
  message: S.String,
  operationId: S.optionalKey(S.String),
}) {}

export class PartialError extends S.TaggedError<PartialError>()("PartialDeletionError", {
  failedOperationId: S.String,
  message: S.String,
  receipt: Receipt,
}) {}

export interface CreateInput {
  readonly plan: DnsPlan.DnsPlan;
  readonly receipt: DnsPlan.ApplyReceipt;
  readonly ttlMs?: number;
}

/** Build a fresh deletion plan only from records proven by a prior create receipt. */
export const create = Effect.fn("Deletion.create")(function* (input: CreateInput) {
  const provider = yield* DnsProvider.Service;
  yield* Provisioning.validate(input.plan);
  if (
    input.receipt.planDigest !== input.plan.digest ||
    input.receipt.providerId !== input.plan.providerId ||
    input.receipt.zone !== input.plan.zone
  ) {
    return yield* new Error({ message: "Create receipt does not belong to the source plan" });
  }
  if (provider.id !== input.plan.providerId) {
    return yield* new Error({ message: "Provider does not match the source receipt" });
  }
  const operations = yield* Effect.forEach(input.receipt.operations, (applied) =>
    Effect.gen(function* () {
      const source = input.plan.operations.find(
        (operation) => operation._tag === "create" && operation.id === applied.operationId,
      );
      if (source === undefined || source._tag !== "create") {
        return yield* new Error({
          message: "Receipt operation is not a created source record",
          operationId: applied.operationId,
        });
      }
      if (applied.providerRecordId === null) {
        return yield* new Error({
          message: "Provider record ID is required for safe deletion",
          operationId: applied.operationId,
        });
      }
      yield* assertExact(
        provider,
        input.plan.zone,
        applied.providerRecordId,
        source.requirement,
        source.id,
      );
      return {
        id: source.id,
        providerRecordId: applied.providerRecordId,
        record: source.requirement,
      };
    }),
  );
  const now = yield* Clock.currentTimeMillis;
  const unsigned: S.Schema.Type<typeof UnsignedPlan> = {
    createdAt: new Date(now),
    expiresAt: new Date(now + (input.ttlMs ?? 15 * 60_000)),
    operations,
    providerId: input.plan.providerId,
    sourcePlanDigest: input.plan.digest,
    version: "domainkit.deletion-plan.v1",
    zone: input.plan.zone,
  };
  return { ...unsigned, digest: yield* sha256Encoded(UnsignedPlan, unsigned) };
});

/** Produce a separate digest-bound consent artifact for destructive operations. */
export const authorize = Effect.fn("Deletion.authorize")(function* (
  plan: Plan,
  operationIds?: ReadonlyArray<string>,
) {
  yield* validate(plan);
  const selected = [...new Set(operationIds ?? plan.operations.map(({ id }) => id))].sort();
  const unknown = selected.filter(
    (id) => !plan.operations.some((operation) => operation.id === id),
  );
  if (unknown.length > 0) {
    return yield* new Error({ message: `Unknown deletion operation IDs: ${unknown.join(", ")}` });
  }
  return {
    operationIds: selected,
    planDigest: plan.digest,
    version: "domainkit.deletion-authorization.v1" as const,
  };
});

/** Re-read every approved record before the first delete, then delete by provider record ID. */
export const apply = Effect.fn("Deletion.apply")(function* (input: {
  readonly authorization: Authorization;
  readonly plan: Plan;
}) {
  const provider = yield* DnsProvider.Service;
  yield* validate(input.plan);
  if (input.authorization.planDigest !== input.plan.digest) {
    return yield* new Error({ message: "Deletion authorization belongs to a different plan" });
  }
  if (provider.id !== input.plan.providerId) {
    return yield* new Error({ message: "Provider does not match the deletion plan" });
  }
  const now = yield* Clock.currentTimeMillis;
  if (input.plan.expiresAt <= new Date(now)) {
    return yield* new Error({ message: "Deletion plan has expired" });
  }
  const selected = input.plan.operations.filter(({ id }) =>
    input.authorization.operationIds.includes(id),
  );
  if (selected.length !== input.authorization.operationIds.length) {
    return yield* new Error({ message: "Deletion authorization contains unknown operations" });
  }
  yield* Effect.forEach(selected, (operation) =>
    assertExact(
      provider,
      input.plan.zone,
      operation.providerRecordId,
      operation.record,
      operation.id,
    ),
  );

  const deleted: Array<{ operationId: string; providerRecordId: string }> = [];
  for (const operation of selected) {
    const failure = yield* Effect.gen(function* () {
      yield* assertExact(
        provider,
        input.plan.zone,
        operation.providerRecordId,
        operation.record,
        operation.id,
      );
      yield* provider.deleteRecord(input.plan.zone, operation.providerRecordId);
      deleted.push({ operationId: operation.id, providerRecordId: operation.providerRecordId });
    }).pipe(Effect.match({ onFailure: (cause) => cause, onSuccess: () => null }));
    if (failure !== null) {
      if (deleted.length === 0) return yield* failure;
      return yield* new PartialError({
        failedOperationId: operation.id,
        message: failure.message,
        receipt: yield* makeReceipt(input.plan, deleted, "partial"),
      });
    }
  }
  return yield* makeReceipt(input.plan, deleted, "complete");
});

export function validate(plan: Plan): Effect.Effect<void, Error | CryptoError, Crypto.Crypto> {
  const unsigned: S.Schema.Type<typeof UnsignedPlan> = {
    createdAt: plan.createdAt,
    expiresAt: plan.expiresAt,
    operations: plan.operations,
    providerId: plan.providerId,
    sourcePlanDigest: plan.sourcePlanDigest,
    version: plan.version,
    zone: plan.zone,
  };
  return sha256Encoded(UnsignedPlan, unsigned).pipe(
    Effect.flatMap((digest) =>
      digest === plan.digest
        ? Effect.void
        : Effect.fail(new Error({ message: "Deletion plan digest does not match its contents" })),
    ),
  );
}

function assertExact(
  provider: DnsProvider.Interface,
  zone: DomainName.DomainName,
  providerRecordId: string,
  expected: DnsRecord.DnsRecord,
  operationId: string,
): Effect.Effect<void, Error | DnsProvider.Error> {
  return provider.getRecord(zone, providerRecordId).pipe(
    Effect.flatMap((observed) =>
      observed !== null && observed._tag !== "Opaque" && DnsRecord.equals(observed, expected)
        ? Effect.void
        : Effect.fail(
            new Error({
              message:
                observed === null
                  ? "Created record no longer exists"
                  : "Created record content no longer matches its receipt",
              operationId,
            }),
          ),
    ),
  );
}

function makeReceipt(
  plan: Plan,
  operations: ReadonlyArray<{ readonly operationId: string; readonly providerRecordId: string }>,
  status: "complete" | "partial",
): Effect.Effect<Receipt> {
  return Clock.currentTimeMillis.pipe(
    Effect.map((now) => ({
      deletedAt: new Date(now),
      operations,
      planDigest: plan.digest,
      providerId: plan.providerId,
      status,
      version: "domainkit.deletion-receipt.v1" as const,
      zone: plan.zone,
    })),
  );
}

export type CreateError =
  | Error
  | InvalidInputError
  | Provisioning.AuthorizationError
  | DnsProvider.Error
  | CryptoError;
export type ApplyError = Error | PartialError | DnsProvider.Error | CryptoError;
export type Requirements = DnsProvider.Service | Crypto.Crypto;
