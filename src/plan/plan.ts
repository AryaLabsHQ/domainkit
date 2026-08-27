import { Clock, Crypto, Effect, Schema } from "effect";

import { parseDomainName } from "../domain/domain-name.ts";
import type { DnsRecord, DnsRecordInput } from "../domain/dns-record.ts";
import { parseDnsRecord, sameRecordData } from "../domain/dns-record.ts";
import {
  AuthorizationError,
  type CryptoError,
  InvalidInputError,
  PartialApplyError,
  PlanConflictError,
  type ProviderError,
  StalePlanError,
} from "../errors.ts";
import { DnsProvider, type DnsProviderService } from "../provider/provider.ts";
import { canonicalJson, sha256 } from "./canonical-json.ts";
import { ApplyReceipt, type DnsPlan, type PlanAuthorization, type PlanOperation } from "./types.ts";

export interface CreatePlanInput {
  readonly requirements: ReadonlyArray<DnsRecord | DnsRecordInput>;
  readonly zone: string;
}

export type PlanError = InvalidInputError | ProviderError | CryptoError;
export type AuthorizationPlanError = AuthorizationError | CryptoError;
export type ApplyPlanError =
  | InvalidInputError
  | ProviderError
  | CryptoError
  | AuthorizationError
  | PlanConflictError
  | StalePlanError
  | PartialApplyError;

/** Builds a deterministic DNS plan through the provider in the Effect environment. */
export function createPlan(
  input: CreatePlanInput,
): Effect.Effect<DnsPlan, PlanError, DnsProviderService | Crypto.Crypto> {
  return Effect.gen(function* () {
    const provider = yield* DnsProvider;
    const zone = yield* attemptInput(() => parseDomainName(input.zone));
    const requirements = yield* attemptInput(() =>
      input.requirements.map(parseDnsRecord).sort(compareRecords),
    );
    const existing = yield* provider
      .listRecords(zone)
      .pipe(
        Effect.flatMap((records) =>
          attemptInput(() => records.map(parseDnsRecord).sort(compareRecords)),
        ),
      );
    const operations = yield* Effect.forEach(
      requirements,
      (requirement) => reconcileRequirement(requirement, existing),
      { concurrency: "unbounded" },
    );
    const unsigned = {
      operations,
      providerId: provider.id,
      version: "domainkit.dns-plan.v1" as const,
      zone,
    };
    return { ...unsigned, digest: yield* sha256(unsigned) };
  });
}

/** Authorizes all or a selected subset of create operations in a digest-bound plan. */
export function authorizePlan(
  plan: DnsPlan,
  operationIds?: ReadonlyArray<string>,
  options: { readonly allowPartial?: boolean } = {},
): Effect.Effect<PlanAuthorization, AuthorizationPlanError, Crypto.Crypto> {
  return Effect.gen(function* () {
    yield* validatePlanDigest(plan);
    const createIds = plan.operations
      .filter((operation) => operation._tag === "create")
      .map(({ id }) => id);
    const selected = [...new Set(operationIds ?? createIds)].sort();
    const unknown = selected.filter((id) => !createIds.includes(id));
    if (unknown.length > 0) {
      return yield* new AuthorizationError({
        message: `Unknown operation IDs: ${unknown.join(", ")}`,
      });
    }
    if (!options.allowPartial && selected.length !== createIds.length) {
      return yield* new AuthorizationError({
        message: "Partial authorization requires allowPartial",
      });
    }
    return {
      allowPartial: options.allowPartial ?? false,
      operationIds: selected,
      planDigest: plan.digest,
      version: "domainkit.plan-authorization.v1",
    };
  });
}

/** Applies approved create operations sequentially after full and per-operation revalidation. */
export function applyPlan(input: {
  readonly authorization: PlanAuthorization;
  readonly plan: DnsPlan;
}): Effect.Effect<ApplyReceipt, ApplyPlanError, DnsProviderService | Crypto.Crypto> {
  return Effect.gen(function* () {
    const { authorization, plan } = input;
    const provider = yield* DnsProvider;
    yield* validatePlanDigest(plan);
    if (authorization.planDigest !== plan.digest) {
      return yield* new AuthorizationError({
        message: "Authorization belongs to a different plan",
      });
    }
    if (provider.id !== plan.providerId) {
      return yield* new AuthorizationError({
        message: "Provider does not match the approved plan",
      });
    }
    const conflicts = plan.operations.filter((operation) => operation._tag === "conflict");
    if (conflicts.length > 0) {
      return yield* new PlanConflictError({ operationIds: conflicts.map(({ id }) => id) });
    }

    const creates = plan.operations.filter(
      (operation): operation is Extract<PlanOperation, { readonly _tag: "create" }> =>
        operation._tag === "create",
    );
    const approved = new Set(authorization.operationIds);
    const unknown = authorization.operationIds.filter(
      (id) => !creates.some((operation) => operation.id === id),
    );
    if (unknown.length > 0) {
      return yield* new AuthorizationError({
        message: `Authorization contains unknown operations: ${unknown.join(", ")}`,
      });
    }
    if (!authorization.allowPartial && creates.some(({ id }) => !approved.has(id))) {
      return yield* new AuthorizationError({
        message: "Authorization does not cover every create operation",
      });
    }

    const currentPlan = yield* createPlan({
      requirements: plan.operations.map(({ requirement }) => requirement),
      zone: plan.zone,
    });
    if (currentPlan.digest !== plan.digest) {
      return yield* new StalePlanError({
        approvedPlanDigest: plan.digest,
        currentPlanDigest: currentPlan.digest,
      });
    }

    const operations: Array<{ operationId: string; providerRecordId: string | null }> = [];
    for (const operation of creates) {
      if (!approved.has(operation.id)) continue;
      yield* Effect.gen(function* () {
        yield* assertOperationStillCreatable(plan, operation);
        const result = yield* provider.createRecord(plan.zone, operation.requirement);
        operations.push({ operationId: operation.id, providerRecordId: result.providerRecordId });
      }).pipe(
        Effect.catch(
          (failure): Effect.Effect<never, PlanError | StalePlanError | PartialApplyError> =>
            operations.length === 0
              ? Effect.fail(failure)
              : createApplyReceipt(input, operations, "partial").pipe(
                  Effect.flatMap((receipt) =>
                    Effect.fail(
                      new PartialApplyError({
                        causeTag: failure._tag,
                        failedOperationId: operation.id,
                        message: applyFailureMessage(failure),
                        receipt,
                      }),
                    ),
                  ),
                ),
        ),
      );
    }

    return yield* createApplyReceipt(input, operations, "complete");
  });
}

function createApplyReceipt(
  input: Parameters<typeof applyPlan>[0],
  operations: ReadonlyArray<{
    readonly operationId: string;
    readonly providerRecordId: string | null;
  }>,
  status: "complete" | "partial",
): Effect.Effect<ApplyReceipt> {
  return Clock.currentTimeMillis.pipe(
    Effect.map((now) =>
      Schema.decodeUnknownSync(ApplyReceipt)({
        appliedAt: new Date(now).toISOString(),
        operations,
        planDigest: input.plan.digest,
        providerId: input.plan.providerId,
        status,
        version: "domainkit.apply-receipt.v1",
        zone: input.plan.zone,
      }),
    ),
  );
}

function assertOperationStillCreatable(
  plan: DnsPlan,
  operation: Extract<PlanOperation, { readonly _tag: "create" }>,
): Effect.Effect<void, PlanError | StalePlanError, DnsProviderService | Crypto.Crypto> {
  return createPlan({ requirements: [operation.requirement], zone: plan.zone }).pipe(
    Effect.flatMap((currentPlan) => {
      const currentOperation = currentPlan.operations[0];
      return currentOperation?._tag === "create" && currentOperation.id === operation.id
        ? Effect.void
        : Effect.fail(
            new StalePlanError({
              approvedPlanDigest: plan.digest,
              currentPlanDigest: currentPlan.digest,
            }),
          );
    }),
  );
}

function applyFailureMessage(failure: PlanError | StalePlanError): string {
  switch (failure._tag) {
    case "ProviderError":
    case "CryptoError":
    case "InvalidInputError":
      return failure.message;
    case "StalePlanError":
      return "DNS state changed while applying the approved plan";
  }
}

export function renderManualInstructions(plan: DnsPlan): ReadonlyArray<string> {
  return plan.operations.map((operation) => {
    const record = operation.requirement;
    const data = Object.entries(record)
      .filter(([key]) => !["_tag", "metadata", "name", "policy", "ttl"].includes(key))
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    return `${operation._tag.toUpperCase()} ${record._tag} ${record.name} ${data}`.trim();
  });
}

function reconcileRequirement(
  requirement: DnsRecord,
  allExisting: ReadonlyArray<DnsRecord>,
): Effect.Effect<PlanOperation, CryptoError, Crypto.Crypto> {
  return Effect.gen(function* () {
    const sameName = allExisting.filter((record) => record.name === requirement.name);
    const sameSet = sameName.filter((record) => record._tag === requirement._tag);
    const exact = sameSet.find((record) => sameRecordData(record, requirement));
    const id = yield* sha256({ requirement });

    if (exact !== undefined) {
      return { _tag: "noop", id, requirement, ttlDrift: exact.ttl !== requirement.ttl };
    }
    const cnameConflict =
      sameName.length > 0 &&
      (requirement._tag === "CNAME" || sameName.some((record) => record._tag === "CNAME"));
    if (cnameConflict) {
      return {
        _tag: "conflict",
        existing: sameName,
        id,
        reason: "CNAME records cannot coexist with other records at the same name",
        requirement,
      };
    }
    if (sameSet.length > 0 && requirement.policy === "exclusive") {
      return {
        _tag: "conflict",
        existing: sameSet,
        id,
        reason: "The exclusive record set already contains incompatible data",
        requirement,
      };
    }
    return { _tag: "create", id, requirement };
  });
}

function validatePlanDigest(
  plan: DnsPlan,
): Effect.Effect<void, AuthorizationPlanError, Crypto.Crypto> {
  const { digest: _digest, ...unsigned } = plan;
  return sha256(unsigned).pipe(
    Effect.flatMap((digest) =>
      digest === plan.digest
        ? Effect.void
        : Effect.fail(
            new AuthorizationError({ message: "Plan digest does not match its contents" }),
          ),
    ),
  );
}

function attemptInput<A>(evaluate: () => A): Effect.Effect<A, InvalidInputError> {
  return Effect.try({
    try: evaluate,
    catch: (cause) =>
      cause instanceof InvalidInputError
        ? cause
        : new InvalidInputError({
            message: cause instanceof Error ? cause.message : String(cause),
          }),
  });
}

function compareRecords(left: DnsRecord, right: DnsRecord): number {
  return canonicalJson(left).localeCompare(canonicalJson(right));
}
