import { Cause, Clock, Crypto, Data, Effect, Schema as S } from "effect";

import * as DomainName from "../domain/domain-name.ts";
import * as DnsRecord from "../domain/dns-record.ts";
import * as ZoneDiscovery from "../discovery/zone-discovery.ts";
import { Error as InvalidInputError } from "../invalid-input.ts";
import * as DnsProvider from "../provider/provider.ts";
import { CryptoError, sha256Encoded, stringify } from "./canonical-json.ts";
import * as DnsPlan from "./types.ts";

const UnsignedPlan = S.Struct({
  operations: S.Array(DnsPlan.Operation),
  providerId: S.String,
  version: S.Literal("domainkit.dns-plan.v1"),
  zone: DomainName.Schema,
});

const RequirementDigest = S.Struct({ requirement: DnsRecord.Schema });

export class ConflictError extends S.TaggedError<ConflictError>()("PlanConflictError", {
  operationIds: S.Array(S.String),
}) {}

export class AuthorizationError extends S.TaggedError<AuthorizationError>()("AuthorizationError", {
  message: S.String,
}) {}

export class StaleError extends S.TaggedError<StaleError>()("StalePlanError", {
  approvedPlanDigest: S.String,
  currentPlanDigest: S.String,
}) {}

export class PartialApplyError extends S.TaggedError<PartialApplyError>()("PartialApplyError", {
  causeTag: S.Literals([
    "CryptoError",
    "InvalidInputError",
    "Interrupted",
    "ProviderError",
    "StalePlanError",
  ]),
  failedOperationId: S.String,
  message: S.String,
  receipt: DnsPlan.Receipt,
}) {}

export type Target = Data.TaggedEnum<{
  DiscoverFromDomain: { readonly domain: string };
  ExactZone: { readonly zone: string };
}>;
export const Target = Data.taggedEnum<Target>();

export type CreateResult = Data.TaggedEnum<{
  NotFound: { readonly domain: DomainName.DomainName };
  Resolved: {
    readonly candidate: ZoneDiscovery.Candidate | null;
    readonly plan: DnsPlan.DnsPlan;
  };
  SelectionRequired: { readonly candidates: ReadonlyArray<ZoneDiscovery.Candidate> };
}>;
export const CreateResult = Data.taggedEnum<CreateResult>();
export type ResolvedCreateResult = Extract<CreateResult, { readonly _tag: "Resolved" }>;

export interface CreateInput {
  readonly requirements: ReadonlyArray<DnsRecord.Encoded | DnsRecord.DnsRecord>;
  readonly target: Target;
}
export type ExactCreateInput = Omit<CreateInput, "target"> & {
  readonly target: Extract<Target, { readonly _tag: "ExactZone" }>;
};
export type DiscoverCreateInput = Omit<CreateInput, "target"> & {
  readonly target: Extract<Target, { readonly _tag: "DiscoverFromDomain" }>;
};

export interface ApplyInput {
  readonly authorization: DnsPlan.PlanAuthorization;
  readonly plan: DnsPlan.DnsPlan;
}

export type CreateError = InvalidInputError | DnsProvider.Error | CryptoError;
export type AuthorizeError = AuthorizationError | CryptoError;
export type ApplyError =
  | InvalidInputError
  | DnsProvider.Error
  | CryptoError
  | AuthorizationError
  | ConflictError
  | StaleError
  | PartialApplyError;

/** Builds a deterministic DNS plan through an exact or discoverable authoritative-zone target. */
export function create(
  input: ExactCreateInput,
): Effect.Effect<ResolvedCreateResult, CreateError, Crypto.Crypto | DnsProvider.Service>;
export function create(
  input: DiscoverCreateInput,
): Effect.Effect<CreateResult, CreateError, Crypto.Crypto | ZoneDiscovery.Service>;
export function create(
  input: CreateInput,
): Effect.Effect<
  CreateResult,
  CreateError,
  Crypto.Crypto | DnsProvider.Service | ZoneDiscovery.Service
> {
  const target = input.target;
  if (target._tag === "ExactZone") {
    return Effect.gen(function* () {
      const provider = yield* DnsProvider.Service;
      const zone = yield* DomainName.decode(target.zone);
      return CreateResult.Resolved({
        candidate: null,
        plan: yield* planAgainst(provider, zone, input.requirements),
      });
    }).pipe(Effect.withSpan("Provisioning.create"));
  }
  return Effect.gen(function* () {
    const discovery = yield* ZoneDiscovery.Service;
    const domain = yield* DomainName.decode(target.domain);
    const outcome = yield* discovery.discover(domain);
    switch (outcome._tag) {
      case "NotFound":
        return CreateResult.NotFound({ domain: outcome.domain });
      case "SelectionRequired":
        return CreateResult.SelectionRequired({ candidates: outcome.candidates });
      case "Resolved":
        return CreateResult.Resolved({
          candidate: outcome.candidate,
          plan: yield* planAgainst(outcome.provider, outcome.candidate.name, input.requirements),
        });
    }
  }).pipe(Effect.withSpan("Provisioning.create"));
}

const planAgainst = Effect.fn("Provisioning.planAgainst")(function* (
  provider: DnsProvider.Interface,
  zone: DomainName.DomainName,
  inputs: ReadonlyArray<DnsRecord.Encoded | DnsRecord.DnsRecord>,
) {
  const requirements = (yield* Effect.forEach(inputs, DnsRecord.decode, {
    concurrency: "unbounded",
  })).sort(compareRecords);
  const existing = [...(yield* provider.listRecords(zone))].sort(compareRecords);
  const { operations } = yield* Effect.reduce(
    requirements,
    (): PlanningState => ({ operations: [], projected: existing }),
    (state, requirement) =>
      reconcileRequirement(requirement, state.projected).pipe(
        Effect.map((operation) => ({
          operations: [...state.operations, operation],
          projected:
            operation._tag === "create"
              ? [...state.projected, operation.requirement].sort(compareRecords)
              : state.projected,
        })),
      ),
  );
  const unsigned: S.Schema.Type<typeof UnsignedPlan> = {
    operations,
    providerId: provider.id,
    version: "domainkit.dns-plan.v1",
    zone,
  };
  return { ...unsigned, digest: yield* sha256Encoded(UnsignedPlan, unsigned) };
});

interface PlanningState {
  readonly operations: ReadonlyArray<DnsPlan.Operation>;
  readonly projected: ReadonlyArray<DnsRecord.Observed>;
}

/** Authorizes all or a selected subset of create operations in a digest-bound plan. */
export const authorize = Effect.fn("Provisioning.authorize")(function* (
  plan: DnsPlan.DnsPlan,
  operationIds?: ReadonlyArray<string>,
  options: { readonly allowPartial?: boolean } = {},
) {
  yield* validate(plan);
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
    version: "domainkit.plan-authorization.v1" as const,
  };
});

/** Applies approved creates sequentially after full and per-operation revalidation. */
export const apply = Effect.fn("Provisioning.apply")(function* (input: ApplyInput) {
  const { authorization, plan } = input;
  const provider = yield* DnsProvider.Service;
  yield* validate(plan);
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
    return yield* new ConflictError({
      operationIds: conflicts.map(({ id }) => id),
    });
  }

  const creates = plan.operations.filter(DnsPlan.Operation.guards.create);
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

  const currentPlan = yield* planAgainst(
    provider,
    plan.zone,
    plan.operations.map(({ requirement }) => requirement),
  );
  if (currentPlan.digest !== plan.digest) {
    return yield* new StaleError({
      approvedPlanDigest: plan.digest,
      currentPlanDigest: currentPlan.digest,
    });
  }

  const operations: Array<{
    operationId: string;
    providerRecordId: string | null;
  }> = [];
  for (const operation of creates) {
    if (!approved.has(operation.id)) continue;
    yield* Effect.gen(function* () {
      yield* assertStillCreatable(plan, operation);
      const result = yield* provider.createRecord(plan.zone, operation.requirement);
      operations.push({
        operationId: operation.id,
        providerRecordId: result.providerRecordId,
      });
    }).pipe(
      Effect.catch((failure): Effect.Effect<never, CreateError | StaleError | PartialApplyError> =>
        operations.length === 0
          ? Effect.fail(failure)
          : makeReceipt(input, operations, "partial").pipe(
              Effect.flatMap((receipt) =>
                Effect.fail(
                  new PartialApplyError({
                    causeTag: failure._tag,
                    failedOperationId: operation.id,
                    message: failureMessage(failure),
                    receipt,
                  }),
                ),
              ),
            ),
      ),
      Effect.catchCause((cause) => {
        if (!Cause.hasInterruptsOnly(cause) || operations.length === 0) {
          return Effect.failCause(cause);
        }
        return makeReceipt(input, operations, "partial").pipe(
          Effect.flatMap((receipt) =>
            Effect.fail(
              new PartialApplyError({
                causeTag: "Interrupted",
                failedOperationId: operation.id,
                message: "DNS apply was interrupted after confirmed writes",
                receipt,
              }),
            ),
          ),
        );
      }),
    );
  }
  return yield* makeReceipt(input, operations, "complete");
});

export function renderManualInstructions(plan: DnsPlan.DnsPlan): ReadonlyArray<string> {
  return plan.operations.map((operation) => {
    const record = operation.requirement;
    const data = Object.entries(DnsRecord.data(record))
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    return `${operation._tag.toUpperCase()} ${record._tag} ${record.name} ${data}`.trim();
  });
}

function makeReceipt(
  input: ApplyInput,
  operations: ReadonlyArray<{
    readonly operationId: string;
    readonly providerRecordId: string | null;
  }>,
  status: "complete" | "partial",
): Effect.Effect<DnsPlan.ApplyReceipt> {
  return Clock.currentTimeMillis.pipe(
    Effect.map((now) => ({
      appliedAt: new Date(now),
      operations,
      planDigest: input.plan.digest,
      providerId: input.plan.providerId,
      status,
      version: "domainkit.apply-receipt.v1" as const,
      zone: input.plan.zone,
    })),
  );
}

function assertStillCreatable(
  plan: DnsPlan.DnsPlan,
  operation: Extract<DnsPlan.Operation, { readonly _tag: "create" }>,
): Effect.Effect<void, CreateError | StaleError, DnsProvider.Service | Crypto.Crypto> {
  return DnsProvider.Service.pipe(
    Effect.flatMap((provider) => planAgainst(provider, plan.zone, [operation.requirement])),
    Effect.flatMap((currentPlan) => {
      const currentOperation = currentPlan.operations[0];
      return currentOperation?._tag === "create" && currentOperation.id === operation.id
        ? Effect.void
        : Effect.fail(
            new StaleError({
              approvedPlanDigest: plan.digest,
              currentPlanDigest: currentPlan.digest,
            }),
          );
    }),
  );
}

function reconcileRequirement(
  requirement: DnsRecord.DnsRecord,
  allExisting: ReadonlyArray<DnsRecord.Observed>,
): Effect.Effect<DnsPlan.Operation, CryptoError, Crypto.Crypto> {
  return Effect.gen(function* () {
    const sameName = allExisting.filter((record) => record.name === requirement.name);
    const sameSet = sameName.filter(
      (record): record is DnsRecord.DnsRecord =>
        record._tag !== "Opaque" && record._tag === requirement._tag,
    );
    const exact = sameSet.find((record) => DnsRecord.equals(record, requirement));
    const id = yield* sha256Encoded(RequirementDigest, { requirement });
    if (exact !== undefined) {
      return DnsPlan.Operation.noop.make({
        id,
        requirement,
        ttlDrift: exact.ttl !== requirement.ttl,
      });
    }
    const cnameConflict =
      sameName.length > 0 &&
      (requirement._tag === "CNAME" || sameName.some((record) => record._tag === "CNAME"));
    if (cnameConflict) {
      return DnsPlan.Operation.conflict.make({
        existing: sameName,
        id,
        reason: "CNAME records cannot coexist with other records at the same name",
        requirement,
      });
    }
    if (
      sameSet.length > 0 &&
      (requirement.policy === "exclusive" || sameSet.some(({ policy }) => policy === "exclusive"))
    ) {
      return DnsPlan.Operation.conflict.make({
        existing: sameSet,
        id,
        reason: "The exclusive record set already contains incompatible data",
        requirement,
      });
    }
    return DnsPlan.Operation.create.make({ id, requirement });
  });
}

export function validate(
  plan: DnsPlan.DnsPlan,
): Effect.Effect<void, AuthorizeError, Crypto.Crypto> {
  const unsigned: S.Schema.Type<typeof UnsignedPlan> = {
    operations: plan.operations,
    providerId: plan.providerId,
    version: plan.version,
    zone: plan.zone,
  };
  return sha256Encoded(UnsignedPlan, unsigned).pipe(
    Effect.flatMap((digest) =>
      digest === plan.digest
        ? Effect.void
        : Effect.fail(
            new AuthorizationError({
              message: "Plan digest does not match its contents",
            }),
          ),
    ),
  );
}

function failureMessage(failure: CreateError | StaleError): string {
  return failure._tag === "StalePlanError"
    ? "DNS state changed while applying the approved plan"
    : failure.message;
}

function compareRecords(left: DnsRecord.Observed, right: DnsRecord.Observed): number {
  const encode = S.encodeSync(DnsRecord.Observed);
  const toJson = S.decodeUnknownSync(S.Json);
  const leftJson = stringify(toJson(encode(left)));
  const rightJson = stringify(toJson(encode(right)));
  return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
}
