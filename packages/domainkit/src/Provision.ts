/**
 * plan -> approve -> apply, durable. Every step is a stored attempt, so a host can render the
 * plan in one request, collect consent in another, and apply in a third, and a retry of any step
 * is idempotent.
 */
import { Context, type DateTime, Effect, Layer, Option } from "effect";

import type * as Approval from "./Approval.ts";
import * as Connect from "./Connect.ts";
import type * as DnsRecord from "./DnsRecord.ts";
import * as Errors from "./internal/error.ts";
import * as Reason from "./Reason.ts";
import * as DomainName from "./DomainName.ts";
import * as Attempts from "./internal/attempts.ts";
import { sha256Hex } from "./internal/digest.ts";
import * as Planner from "./internal/planner.ts";
import * as Plan from "./Plan.ts";
import * as Principal from "./Principal.ts";
import type * as Receipt from "./Receipt.ts";
import * as Storage from "./Storage.ts";

type Fx<A> = Effect.Effect<A, Errors.DomainKitError, Principal.Service>;

export interface Attempt {
  readonly plan: Plan.Model;
  readonly status: Storage.AttemptStatus;
  readonly approval: Approval.Model | null;
  readonly receipt: Receipt.Model | null;
  readonly rejection: Storage.Rejection | null;
}

export interface RejectOptions {
  readonly reason?: string;
}

/** One domain to plan inside a batch. The domain must already be attached. */
export interface BatchInput {
  readonly domain: string;
  readonly requirements: ReadonlyArray<DnsRecord.Model>;
}

/**
 * One domain's place in a batch, with whatever its attempt holds.
 *
 * Everything but `planFailure` is read from the attempt the item points at, so a batch never
 * shows a customer a plan, receipt, or failure that disagrees with the attempt it came from.
 */
export interface BatchItem {
  readonly attachmentId: string;
  readonly position: number;
  /** Null while the item has no plan; `planFailure` then says why. */
  readonly plan: Plan.Model | null;
  readonly status: Storage.AttemptStatus | null;
  readonly approval: Approval.Model | null;
  readonly receipt: Receipt.Model | null;
  readonly rejection: Storage.Rejection | null;
  /** Why the last apply stopped before any write. */
  readonly failure: string | null;
  /** Why the last planning pass could not build this item's plan. */
  readonly planFailure: string | null;
}

/** Many domains planned together, approved once, and applied with bounded concurrency. */
export interface Batch {
  readonly id: Storage.BatchId;
  readonly status: Storage.BatchStatus;
  /**
   * What `approve` binds: SHA-256 over the items' sorted `attachmentId:planDigest` pairs. The
   * digest the batch was approved at once it is approved, the digest its current plans produce
   * before that, and null while any item is still unplanned.
   */
  readonly digest: Plan.Digest | null;
  readonly approval: Storage.BatchApproval | null;
  readonly rejection: Storage.Rejection | null;
  readonly createdAt: DateTime.Utc;
  readonly updatedAt: DateTime.Utc;
  readonly completedAt: DateTime.Utc | null;
  readonly items: ReadonlyArray<BatchItem>;
}

/** A batch without its plans, for the index a host renders as a banner. */
export interface BatchSummary {
  readonly id: Storage.BatchId;
  readonly status: Storage.BatchStatus;
  readonly itemCount: number;
  readonly createdAt: DateTime.Utc;
  readonly updatedAt: DateTime.Utc;
  readonly completedAt: DateTime.Utc | null;
}

export interface BatchInterface {
  /**
   * Plan every domain in `items` as one batch, with `Policy.batchConcurrency` in flight.
   *
   * `idempotencyKey` is unique per owner: a retried create returns the batch the first call made,
   * plans whatever is still unplanned, and ignores items that batch does not hold. An item whose
   * plan fails records the reason and leaves the batch `planning` for `resumePlanning`.
   */
  readonly create: (input: {
    readonly items: ReadonlyArray<BatchInput>;
    readonly idempotencyKey: string;
  }) => Fx<Batch>;
  /**
   * Plan the items that still have none, with the requirements supplied again. A batch stores
   * pointers, not requirements, so the host owns them across the retry.
   */
  readonly resumePlanning: (
    id: Storage.BatchId,
    input: { readonly items: ReadonlyArray<BatchInput> },
  ) => Fx<Batch>;
  /**
   * Record the principal's consent to the whole batch. Fails `BatchStale` unless `digest` is the
   * one the batch's current plans produce. Approving an approved batch at its digest returns it.
   */
  readonly approve: (id: Storage.BatchId, options: { readonly digest: Plan.Digest }) => Fx<Batch>;
  /**
   * Apply every approved item that has no receipt yet, with `Policy.batchConcurrency` in flight
   * and each item under its own attempt lease. An item another apply holds is skipped this round,
   * and an item that fails records its failure on its attempt rather than stopping the others, so
   * calling `apply` again resumes the batch. Applying a complete batch returns it unchanged.
   */
  readonly apply: (id: Storage.BatchId) => Fx<Batch>;
  /**
   * Decline the batch and every plan under it; terminal. Rejecting again returns the same batch;
   * a batch that was approved fails `BatchStale`.
   */
  readonly reject: (id: Storage.BatchId, options?: RejectOptions) => Fx<Batch>;
  readonly get: (id: Storage.BatchId) => Fx<Batch>;
  /** Every batch this owner still owes a move on, most recently touched first. */
  readonly list: (filter: { readonly unfinished: true }) => Fx<ReadonlyArray<BatchSummary>>;
}

export interface Interface {
  /** Read provider state and build an additive plan. Fails `NotFound` when the domain is not attached. */
  readonly plan: (input: {
    readonly domain: string;
    readonly requirements: ReadonlyArray<DnsRecord.Model>;
  }) => Fx<Plan.Model>;
  /**
   * Record the principal's consent. Fails `Conflict` unless `allowPartial` and the selected
   * operations are conflict-free. Approving an already-approved plan returns the same approval.
   */
  readonly approve: (
    plan: Plan.Model | Plan.PlanId,
    options?: Attempts.ApproveOptions,
  ) => Fx<Approval.Model>;
  /**
   * Decline the plan for the acting principal; terminal. Rejecting again returns the same
   * attempt; a plan that was approved or applied fails `Stale`.
   */
  readonly reject: (plan: Plan.Model | Plan.PlanId, options?: RejectOptions) => Fx<Attempt>;
  /**
   * Re-plan the zone, fail `Stale` if the digest moved, then create records. Partial success is a
   * `partial` receipt. Applying an attempt that already completed returns its receipt.
   */
  readonly apply: (approval: Approval.Model | Approval.ApprovalId) => Fx<Receipt.Model>;
  readonly get: (planId: Plan.PlanId) => Fx<Attempt>;
  readonly latest: (domain: string) => Fx<Attempt | null>;
  /** Many domains as one reviewable unit: plan together, approve once, apply bounded. */
  readonly batch: BatchInterface;
}

export class Service extends Context.Service<Service, Interface>()("@domainkit/Provision") {}

export interface PolicyShape {
  /** Plan lifetime before it must be rebuilt. Default 1 hour. */
  readonly planTtlMs: number;
  /** Apply lease; a crashed apply can be retried after this. Default 2 minutes. */
  readonly applyLeaseMs: number;
  /** How many of a batch's domains are planned or applied at once. Default 4. */
  readonly batchConcurrency: number;
}
export const defaults: PolicyShape = {
  planTtlMs: 60 * 60_000,
  applyLeaseMs: 2 * 60_000,
  batchConcurrency: 4,
};
export class Policy extends Context.Reference<PolicyShape>("@domainkit/Provision/Policy", {
  defaultValue: () => defaults,
}) {}

export const make: Effect.Effect<Interface, never, Storage.Service | Connect.Service> = Effect.gen(
  function* () {
    const storage = yield* Storage.Service;
    const connect = yield* Connect.Service;
    const attempts = Attempts.make(storage, connect, "provisioning");

    const attachmentFor = (input: string): Fx<Storage.Attachment> =>
      Effect.gen(function* () {
        const domain = yield* DomainName.decode(input);
        const attachment = yield* storage.attachments.byDomain(domain);
        if (Option.isNone(attachment)) {
          return yield* Errors.fail(new Reason.NotFound({ entity: "attachment", id: domain }));
        }
        return attachment.value;
      });

    const view = (attempt: Storage.Attempt): Attempt => ({
      plan: attempt.plan,
      status: attempt.status,
      approval: attempt.approval,
      receipt: attempt.receipt,
      rejection: attempt.rejection,
    });

    /** Read the attached zone and record one `planned` attempt for it. */
    const planFor = (
      attachment: Storage.Attachment,
      requirements: ReadonlyArray<DnsRecord.Model>,
      ttlMs: number,
    ): Fx<Plan.Model> =>
      Effect.gen(function* () {
        yield* Attempts.assertWithin(attachment, requirements);
        const { session, target } = yield* connect.session(attachment.id);
        const observed = yield* session.dns(target).list(target.zone);
        const operations = yield* Planner.reconcile(
          requirements,
          observed.map(({ record }) => record),
        );
        return yield* attempts.record({
          attachment,
          target,
          operations,
          ttlMs,
          sourceReceiptId: null,
        });
      });

    const batchStale = (batch: Storage.Batch, digest: Plan.Digest | null) =>
      Errors.fail(new Reason.BatchStale({ batchId: batch.id, status: batch.status, digest }));

    /** Provision reads provisioning batches; a cleanup batch is not its aggregate. */
    const provisioningBatch = (id: Storage.BatchId): Fx<Storage.BatchAggregate> =>
      Effect.flatMap(storage.batches.get(id), (aggregate) =>
        aggregate.batch.kind === "provisioning"
          ? Effect.succeed(aggregate)
          : Errors.fail(new Reason.NotFound({ entity: "batch", id })),
      );

    /**
     * The digest the principal reviews: SHA-256 over the items' sorted `attachmentId:planDigest`
     * pairs, and null while any item is still unplanned.
     */
    const digestOf = (items: ReadonlyArray<BatchItem>): Fx<Plan.Digest | null> =>
      items.some((item) => item.plan === null)
        ? Effect.succeed(null)
        : Effect.map(
            sha256Hex(
              items
                .map((item) => `${item.attachmentId}:${item.plan?.digest ?? ""}`)
                .sort()
                .join("\n"),
            ),
            Plan.Digest.make,
          );

    const batchView = (aggregate: Storage.BatchAggregate): Fx<Batch> =>
      Effect.gen(function* () {
        const policy = yield* Policy;
        const items = yield* Effect.forEach(
          aggregate.items,
          (item): Fx<BatchItem> =>
            item.attemptId === null
              ? Effect.succeed({
                  attachmentId: item.attachmentId,
                  position: item.position,
                  plan: null,
                  status: null,
                  approval: null,
                  receipt: null,
                  rejection: null,
                  failure: null,
                  planFailure: item.planFailure,
                })
              : Effect.map(storage.attempts.get(item.attemptId), (attempt) => ({
                  attachmentId: item.attachmentId,
                  position: item.position,
                  plan: attempt.plan,
                  status: attempt.status,
                  approval: attempt.approval,
                  receipt: attempt.receipt,
                  rejection: attempt.rejection,
                  failure: attempt.failure,
                  planFailure: item.planFailure,
                })),
          { concurrency: policy.batchConcurrency },
        );
        return {
          id: aggregate.batch.id,
          status: aggregate.batch.status,
          digest: aggregate.batch.digest ?? (yield* digestOf(items)),
          approval: aggregate.batch.approval,
          rejection: aggregate.batch.rejection,
          createdAt: aggregate.batch.createdAt,
          updatedAt: aggregate.batch.updatedAt,
          completedAt: aggregate.batch.completedAt,
          items,
        };
      });

    /** The batch was declined under a planning pass still in flight; the fence did its work. */
    const ignoreFence = <A>(
      effect: Fx<A>,
    ): Effect.Effect<void, Errors.DomainKitError, Principal.Service> =>
      effect.pipe(
        Effect.asVoid,
        Effect.catch((error) =>
          error.reason._tag === "BatchStale" ? Effect.void : Effect.fail(error),
        ),
      );

    /**
     * Plan every item that has no plan yet and for which this call supplied requirements. An item
     * the caller did not name keeps whatever it holds, so a replayed create never re-plans.
     */
    const planMissing = (
      aggregate: Storage.BatchAggregate,
      supplied: ReadonlyArray<{
        readonly attachment: Storage.Attachment;
        readonly requirements: ReadonlyArray<DnsRecord.Model>;
      }>,
    ): Fx<Batch> =>
      Effect.gen(function* () {
        const policy = yield* Policy;
        const id = aggregate.batch.id;
        const pending = aggregate.items.flatMap((item) => {
          if (item.attemptId !== null) return [];
          const match = supplied.find(({ attachment }) => attachment.id === item.attachmentId);
          return match === undefined ? [] : [match];
        });
        yield* Effect.forEach(
          pending,
          ({ attachment, requirements }) =>
            planFor(attachment, requirements, policy.planTtlMs).pipe(
              Effect.matchEffect({
                // A domain that cannot be planned is the batch's news to carry, not a reason to
                // abandon the domains beside it.
                onFailure: (error) =>
                  ignoreFence(
                    storage.batches.recordItemPlanFailure(id, attachment.id, error.message),
                  ),
                onSuccess: (plan) =>
                  ignoreFence(storage.batches.recordItemPlan(id, attachment.id, plan.id)),
              }),
            ),
          { concurrency: policy.batchConcurrency, discard: true },
        );
        return yield* batchView(yield* storage.batches.get(id));
      });

    const attachmentsFor = (items: ReadonlyArray<BatchInput>) =>
      Effect.forEach(items, (item) =>
        Effect.map(attachmentFor(item.domain), (attachment) => ({
          attachment,
          requirements: item.requirements,
        })),
      );

    const batch: BatchInterface = {
      create: (input) =>
        Effect.gen(function* () {
          const supplied = yield* attachmentsFor(input.items);
          const aggregate = yield* storage.batches.create({
            kind: "provisioning",
            idempotencyKey: input.idempotencyKey,
            attachmentIds: supplied.map(({ attachment }) => attachment.id),
          });
          return yield* planMissing(aggregate, supplied);
        }),
      resumePlanning: (id, input) =>
        Effect.gen(function* () {
          const aggregate = yield* provisioningBatch(id);
          const supplied = yield* attachmentsFor(input.items);
          return yield* planMissing(aggregate, supplied);
        }),
      approve: (id, options) =>
        Effect.gen(function* () {
          const principal = yield* Principal.Service;
          const aggregate = yield* provisioningBatch(id);
          const current = yield* batchView(aggregate);
          // Consent is bound to the digest the principal read, so nothing is written until the
          // batch's current plans still produce it.
          if (current.digest === null || current.digest !== options.digest) {
            return yield* batchStale(aggregate.batch, current.digest);
          }
          if (aggregate.batch.approval !== null) return current;
          const approvals = yield* Effect.forEach(aggregate.items, (item) =>
            Effect.gen(function* () {
              if (item.attemptId === null) return yield* batchStale(aggregate.batch, null);
              const attempt = yield* storage.attempts.get(item.attemptId);
              return {
                attachmentId: item.attachmentId,
                approval: attempt.approval ?? (yield* attempts.draftApproval(attempt)),
              };
            }),
          );
          // One transaction: the batch is never approved without the per-attempt approvals
          // `apply` takes.
          const approved = yield* storage.batches.approve(id, {
            digest: current.digest,
            actorId: principal.actorId,
            approvals,
          });
          return yield* batchView(approved);
        }),
      apply: (id) =>
        Effect.gen(function* () {
          const policy = yield* Policy;
          const aggregate = yield* provisioningBatch(id);
          if (aggregate.batch.status === "complete") return yield* batchView(aggregate);
          if (aggregate.batch.approval === null) {
            return yield* batchStale(aggregate.batch, aggregate.batch.digest);
          }
          yield* Effect.forEach(
            aggregate.items,
            (item) =>
              Effect.gen(function* () {
                if (item.attemptId === null) return;
                const attempt = yield* storage.attempts.get(item.attemptId);
                if (attempt.receipt !== null || attempt.approval === null) return;
                // The attempt lease is the item lock: an item another apply holds is `Busy` and
                // waits for the next round, and one that fails records that on its own attempt.
                yield* attempts.apply(attempt.approval.id, policy).pipe(
                  Effect.asVoid,
                  Effect.catch(() => Effect.void),
                );
              }),
            { concurrency: policy.batchConcurrency, discard: true },
          );
          return yield* batchView(yield* storage.batches.refresh(id));
        }),
      reject: (id, options) =>
        Effect.gen(function* () {
          const principal = yield* Principal.Service;
          yield* provisioningBatch(id);
          const rejected = yield* storage.batches.reject(id, {
            actorId: principal.actorId,
            reason: options?.reason ?? null,
          });
          return yield* batchView(rejected);
        }),
      get: (id) => Effect.flatMap(provisioningBatch(id), batchView),
      list: () =>
        Effect.map(storage.batches.listUnfinished(), (aggregates) =>
          aggregates
            .filter(({ batch: row }) => row.kind === "provisioning")
            .map(({ batch: row, items }) => ({
              id: row.id,
              status: row.status,
              itemCount: items.length,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
              completedAt: row.completedAt,
            })),
        ),
    };

    return {
      plan: (input) =>
        Effect.gen(function* () {
          const policy = yield* Policy;
          const attachment = yield* attachmentFor(input.domain);
          return yield* planFor(attachment, input.requirements, policy.planTtlMs);
        }),
      approve: (plan, options) => attempts.approve(plan, options),
      reject: (plan, options) => Effect.map(attempts.reject(plan, options), view),
      apply: (approval) => Effect.flatMap(Policy, (policy) => attempts.apply(approval, policy)),
      get: (planId) => Effect.map(attempts.attemptOf(planId), view),
      latest: (domain) =>
        Effect.gen(function* () {
          const attachment = yield* attachmentFor(domain);
          const latest = yield* storage.attempts.latest(attachment.id, "provisioning");
          return Option.isSome(latest) ? view(latest.value) : null;
        }),
      batch,
    };
  },
);

export const layer: Layer.Layer<Service, never, Storage.Service | Connect.Service> =
  Layer.effect(Service)(make);

const accessor =
  <Args extends ReadonlyArray<unknown>, A>(
    pick: (service: Interface) => (...args: Args) => Fx<A>,
  ): ((...args: Args) => Effect.Effect<A, Errors.DomainKitError, Principal.Service | Service>) =>
  (...args) =>
    Effect.flatMap(Service, (service) => pick(service)(...args));

export const plan = accessor((service) => service.plan);
export const approve = accessor((service) => service.approve);
export const reject = accessor((service) => service.reject);
export const apply = accessor((service) => service.apply);
export const get = accessor((service) => service.get);
export const latest = accessor((service) => service.latest);

/**
 * Many domains as one reviewable unit. Every operation needs `Provision.Service` and `Principal`,
 * exactly like the single-domain accessors above.
 */
export const batch = {
  create: accessor((service) => service.batch.create),
  resumePlanning: accessor((service) => service.batch.resumePlanning),
  approve: accessor((service) => service.batch.approve),
  apply: accessor((service) => service.batch.apply),
  reject: accessor((service) => service.batch.reject),
  get: accessor((service) => service.batch.get),
  list: accessor((service) => service.batch.list),
};
