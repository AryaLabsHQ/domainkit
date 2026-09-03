/**
 * Remove only what a receipt proves DomainKit created, with its own plan, approval, and receipt.
 * Same three verbs as Provision; the plan is built from a receipt instead of requirements.
 */
import { Context, Effect, Layer, Option } from "effect";

import type * as Approval from "./Approval.ts";
import { Connect } from "./Connect.ts";
import * as DomainKitError from "./DomainKitError.ts";
import * as DomainName from "./DomainName.ts";
import * as Attempts from "./internal/attempts.ts";
import type * as Plan from "./Plan.ts";
import type { Principal } from "./Principal.ts";
import * as Provision from "./Provision.ts";
import * as Receipt from "./Receipt.ts";
import * as Storage from "./Storage.ts";

type Fx<A> = Effect.Effect<A, DomainKitError.DomainKitError, Principal>;

export interface Service {
  /** Read back every receipt record; records that no longer match exactly become `Conflict`. */
  readonly plan: (
    input: { readonly receiptId: Receipt.ReceiptId } | { readonly domain: string },
  ) => Fx<Plan.Plan>;
  readonly approve: (
    plan: Plan.Plan | Plan.PlanId,
    options?: Attempts.ApproveOptions,
  ) => Fx<Approval.Approval>;
  readonly apply: (approval: Approval.Approval | Approval.ApprovalId) => Fx<Receipt.Receipt>;
}

export class Cleanup extends Context.Service<Cleanup, Service>()("@domainkit/Cleanup") {}

export const make: Effect.Effect<Service, never, Storage.Storage | Connect> = Effect.gen(
  function* () {
    const storage = yield* Storage.Storage;
    const connect = yield* Connect;
    const attempts = Attempts.make(storage, connect, "cleanup");

    const sourceAttempt = (
      input: { readonly receiptId: Receipt.ReceiptId } | { readonly domain: string },
    ) =>
      Effect.gen(function* () {
        if ("receiptId" in input) {
          const attempt = yield* storage.attempts.byReceipt(input.receiptId);
          if (attempt.kind !== "provisioning" || attempt.receipt === null) {
            return yield* DomainKitError.fail(
              new DomainKitError.NotFound({ entity: "receipt", id: input.receiptId }),
            );
          }
          return attempt;
        }
        const domain = yield* DomainName.decode(input.domain);
        const attachment = yield* storage.attachments.byDomain(domain);
        const latest = Option.isSome(attachment)
          ? yield* storage.attempts.latest(attachment.value.id, "provisioning")
          : Option.none<Storage.Attempt>();
        if (Option.isNone(latest) || latest.value.receipt === null) {
          return yield* DomainKitError.fail(
            new DomainKitError.NotFound({ entity: "receipt", id: domain }),
          );
        }
        return latest.value;
      });

    return {
      plan: (input) =>
        Effect.gen(function* () {
          const policy = yield* Provision.Policy;
          const source = yield* sourceAttempt(input);
          const receipt = source.receipt;
          if (receipt === null) {
            return yield* DomainKitError.fail(
              new DomainKitError.NotFound({ entity: "receipt", id: source.id }),
            );
          }
          const attachment = yield* storage.attachments.get(source.attachmentId);
          const { session, target } = yield* connect.session(attachment.id);
          const dns = session.dns(target);
          const operations = yield* Effect.forEach(Receipt.applied(receipt), (applied) =>
            Effect.gen(function* () {
              const created = source.plan.operations.find(
                (operation) => operation._tag === "Create" && operation.id === applied.operationId,
              );
              if (created === undefined) {
                return yield* DomainKitError.fail(
                  new DomainKitError.InvalidInput({
                    message: `Receipt ${receipt.id} proves no created record for ${applied.operationId}`,
                    field: "receiptId",
                  }),
                );
              }
              return yield* Attempts.cleanupOperation(
                dns,
                target.zone,
                created.id,
                created.record,
                applied.providerRecordId,
              );
            }),
          );
          return yield* attempts.record({
            attachment,
            target,
            operations,
            ttlMs: policy.planTtlMs,
            sourceReceiptId: receipt.id,
          });
        }),
      approve: (plan, options) => attempts.approve(plan, options),
      apply: (approval) =>
        Effect.flatMap(Provision.Policy, (policy) => attempts.apply(approval, policy)),
    };
  },
);

export const layer: Layer.Layer<Cleanup, never, Storage.Storage | Connect> =
  Layer.effect(Cleanup)(make);

const accessor =
  <Args extends ReadonlyArray<unknown>, A>(
    pick: (service: Service) => (...args: Args) => Fx<A>,
  ): ((...args: Args) => Effect.Effect<A, DomainKitError.DomainKitError, Principal | Cleanup>) =>
  (...args) =>
    Effect.flatMap(Cleanup, (service) => pick(service)(...args));

export const plan = accessor((service) => service.plan);
export const approve = accessor((service) => service.approve);
export const apply = accessor((service) => service.apply);
