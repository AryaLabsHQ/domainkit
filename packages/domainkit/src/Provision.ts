/**
 * plan -> approve -> apply, durable. Every step is a stored attempt, so a host can render the
 * plan in one request, collect consent in another, and apply in a third, and a retry of any step
 * is idempotent.
 */
import { Context, Effect, Layer, Option } from "effect";

import type * as Approval from "./Approval.ts";
import { Connect } from "./Connect.ts";
import type * as DnsRecord from "./DnsRecord.ts";
import * as DomainKitError from "./DomainKitError.ts";
import * as DomainName from "./DomainName.ts";
import * as Attempts from "./internal/attempts.ts";
import * as Planner from "./internal/planner.ts";
import type * as Plan from "./Plan.ts";
import type { Principal } from "./Principal.ts";
import type * as Receipt from "./Receipt.ts";
import * as Storage from "./Storage.ts";

type Fx<A> = Effect.Effect<A, DomainKitError.DomainKitError, Principal>;

export interface Attempt {
  readonly plan: Plan.Plan;
  readonly status: Storage.AttemptStatus;
  readonly approval: Approval.Approval | null;
  readonly receipt: Receipt.Receipt | null;
  readonly rejection: Storage.Rejection | null;
}

export interface RejectOptions {
  readonly reason?: string;
}

export interface Service {
  /** Read provider state and build an additive plan. Fails `NotFound` when the domain is not attached. */
  readonly plan: (input: {
    readonly domain: string;
    readonly requirements: ReadonlyArray<DnsRecord.DnsRecord>;
  }) => Fx<Plan.Plan>;
  /**
   * Record the principal's consent. Fails `Conflict` unless `allowPartial` and the selected
   * operations are conflict-free. Approving an already-approved plan returns the same approval.
   */
  readonly approve: (
    plan: Plan.Plan | Plan.PlanId,
    options?: Attempts.ApproveOptions,
  ) => Fx<Approval.Approval>;
  /**
   * Decline the plan for the acting principal; terminal. Rejecting again returns the same
   * attempt; a plan that was approved or applied fails `Stale`.
   */
  readonly reject: (plan: Plan.Plan | Plan.PlanId, options?: RejectOptions) => Fx<Attempt>;
  /**
   * Re-plan the zone, fail `Stale` if the digest moved, then create records. Partial success is a
   * `partial` receipt. Applying an attempt that already completed returns its receipt.
   */
  readonly apply: (approval: Approval.Approval | Approval.ApprovalId) => Fx<Receipt.Receipt>;
  readonly get: (planId: Plan.PlanId) => Fx<Attempt>;
  readonly latest: (domain: string) => Fx<Attempt | null>;
}

export class Provision extends Context.Service<Provision, Service>()("@domainkit/Provision") {}

export interface PolicyShape {
  /** Plan lifetime before it must be rebuilt. Default 1 hour. */
  readonly planTtlMs: number;
  /** Apply lease; a crashed apply can be retried after this. Default 2 minutes. */
  readonly applyLeaseMs: number;
}
export const defaults: PolicyShape = { planTtlMs: 60 * 60_000, applyLeaseMs: 2 * 60_000 };
export class Policy extends Context.Reference<PolicyShape>("@domainkit/Provision/Policy", {
  defaultValue: () => defaults,
}) {}

export const make: Effect.Effect<Service, never, Storage.Storage | Connect> = Effect.gen(
  function* () {
    const storage = yield* Storage.Storage;
    const connect = yield* Connect;
    const attempts = Attempts.make(storage, connect, "provisioning");

    const attachmentFor = (input: string): Fx<Storage.Attachment> =>
      Effect.gen(function* () {
        const domain = yield* DomainName.decode(input);
        const attachment = yield* storage.attachments.byDomain(domain);
        if (Option.isNone(attachment)) {
          return yield* DomainKitError.fail(
            new DomainKitError.NotFound({ entity: "attachment", id: domain }),
          );
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

    return {
      plan: (input) =>
        Effect.gen(function* () {
          const policy = yield* Policy;
          const attachment = yield* attachmentFor(input.domain);
          const { session, target } = yield* connect.session(attachment.id);
          const observed = yield* session.dns(target).list(target.zone);
          const operations = yield* Planner.reconcile(
            input.requirements,
            observed.map(({ record }) => record),
          );
          return yield* attempts.record({
            attachment,
            target,
            operations,
            ttlMs: policy.planTtlMs,
            sourceReceiptId: null,
          });
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
    };
  },
);

export const layer: Layer.Layer<Provision, never, Storage.Storage | Connect> =
  Layer.effect(Provision)(make);

const accessor =
  <Args extends ReadonlyArray<unknown>, A>(
    pick: (service: Service) => (...args: Args) => Fx<A>,
  ): ((...args: Args) => Effect.Effect<A, DomainKitError.DomainKitError, Principal | Provision>) =>
  (...args) =>
    Effect.flatMap(Provision, (service) => pick(service)(...args));

export const plan = accessor((service) => service.plan);
export const approve = accessor((service) => service.approve);
export const reject = accessor((service) => service.reject);
export const apply = accessor((service) => service.apply);
export const get = accessor((service) => service.get);
export const latest = accessor((service) => service.latest);
