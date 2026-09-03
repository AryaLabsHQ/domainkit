import { DateTime, Duration, Effect } from "effect";

import * as Approval from "../Approval.ts";
import { Connect } from "../Connect.ts";
import * as DnsRecord from "../DnsRecord.ts";
import * as DomainKitError from "../DomainKitError.ts";
import * as Plan from "../Plan.ts";
import { Principal } from "../Principal.ts";
import type * as Provider from "../Provider.ts";
import * as Receipt from "../Receipt.ts";
import * as Storage from "../Storage.ts";
import { fresh } from "./ids.ts";
import * as Planner from "./planner.ts";

type Fx<A> = Effect.Effect<A, DomainKitError.DomainKitError, Principal>;

export interface ApproveOptions {
  readonly operationIds?: ReadonlyArray<Plan.OperationId>;
  readonly allowPartial?: boolean;
}

export interface PolicyShape {
  readonly planTtlMs: number;
  readonly applyLeaseMs: number;
}

const stale = (plan: Plan.Plan) =>
  DomainKitError.fail(new DomainKitError.Stale({ planId: plan.id, digest: plan.digest }));

const expired = (entity: "plan" | "approval", id: string) =>
  DomainKitError.fail(new DomainKitError.Expired({ entity, id }));

const past = (at: DateTime.Utc, now: DateTime.Utc) =>
  DateTime.toEpochMillis(at) <= DateTime.toEpochMillis(now);

/** Shared plan -> approve -> apply machinery for provisioning and cleanup attempts. */
export const make = (storage: Storage.Service, connect: Connect["Service"], kind: Plan.Kind) => {
  const providerOf = (attachment: Storage.Attachment) =>
    Effect.gen(function* () {
      const connection = yield* storage.connections.get(attachment.connectionId);
      const authorization = yield* storage.authorizations.get(connection.authorizationId);
      return authorization.provider;
    });

  /** Persist a freshly built plan as a `planned` attempt. */
  const record = (input: {
    readonly attachment: Storage.Attachment;
    readonly target: Provider.Target;
    readonly operations: ReadonlyArray<Plan.Operation>;
    readonly ttlMs: number;
    readonly sourceReceiptId: Receipt.ReceiptId | null;
  }): Fx<Plan.Plan> =>
    Effect.gen(function* () {
      const principal = yield* Principal;
      const provider = yield* providerOf(input.attachment);
      const now = yield* DateTime.now;
      const unsigned: Planner.Unsigned = {
        version: "domainkit.plan.v2",
        kind,
        domain: input.attachment.domain,
        zone: input.target.zone,
        provider,
        attachmentId: input.attachment.id,
        operations: input.operations,
      };
      const plan = new Plan.Plan({
        ...unsigned,
        id: Plan.PlanId.make(yield* fresh("plan")),
        digest: yield* Planner.digest(unsigned),
        createdAt: now,
        expiresAt: DateTime.addDuration(now, Duration.millis(input.ttlMs)),
      });
      yield* storage.attempts.create(
        new Storage.Attempt({
          id: plan.id,
          ownerId: principal.ownerId,
          attachmentId: input.attachment.id,
          kind,
          status: "planned",
          plan,
          approval: null,
          receipt: null,
          sourceReceiptId: input.sourceReceiptId,
          leaseExpiresAt: null,
          failure: null,
          updatedAt: now,
        }),
      );
      return plan;
    });

  const attemptOf = (plan: Plan.Plan | Plan.PlanId): Fx<Storage.Attempt> =>
    Effect.gen(function* () {
      const attempt = yield* storage.attempts.get(typeof plan === "string" ? plan : plan.id);
      if (attempt.kind !== kind) {
        return yield* DomainKitError.fail(
          new DomainKitError.NotFound({ entity: "plan", id: attempt.id }),
        );
      }
      if (typeof plan !== "string" && plan.digest !== attempt.plan.digest)
        return yield* stale(plan);
      return attempt;
    });

  const approve = (
    plan: Plan.Plan | Plan.PlanId,
    options: ApproveOptions = {},
  ): Fx<Approval.Approval> =>
    Effect.gen(function* () {
      const attempt = yield* attemptOf(plan);
      if (attempt.approval !== null) return attempt.approval;
      const principal = yield* Principal;
      const now = yield* DateTime.now;
      if (past(attempt.plan.expiresAt, now)) return yield* expired("plan", attempt.plan.id);
      const writes = Plan.writes(attempt.plan);
      const writeIds = new Set(writes.map(({ id }) => id));
      const selected = [...new Set(options.operationIds ?? writes.map(({ id }) => id))].sort();
      const unknown = selected.filter((id) => !writeIds.has(id));
      if (unknown.length > 0) {
        return yield* DomainKitError.fail(
          new DomainKitError.InvalidInput({
            message: `Operations ${unknown.join(", ")} are not writable in plan ${attempt.plan.id}`,
            field: "operationIds",
          }),
        );
      }
      const conflicts = Plan.conflicts(attempt.plan);
      if (options.allowPartial !== true) {
        if (conflicts.length > 0) {
          return yield* DomainKitError.fail(
            new DomainKitError.Conflict({ planId: attempt.plan.id, operations: conflicts }),
          );
        }
        if (selected.length !== writes.length) {
          return yield* DomainKitError.fail(
            new DomainKitError.InvalidInput({
              message: "Approving a subset of the plan requires allowPartial",
              field: "operationIds",
            }),
          );
        }
      }
      const approval = new Approval.Approval({
        id: Approval.ApprovalId.make(yield* fresh("apr")),
        version: "domainkit.approval.v2",
        kind,
        planId: attempt.plan.id,
        digest: attempt.plan.digest,
        operationIds: selected,
        approvedBy: principal.actorId,
        approvedAt: now,
        expiresAt: attempt.plan.expiresAt,
      });
      const stored = yield* storage.attempts.approve(attempt.id, approval);
      return stored.approval ?? approval;
    });

  const apply = (
    approval: Approval.Approval | Approval.ApprovalId,
    policy: PolicyShape,
  ): Fx<Receipt.Receipt> =>
    Effect.gen(function* () {
      const attempt =
        typeof approval === "string"
          ? yield* storage.attempts.byApproval(approval)
          : yield* attemptOf(approval.planId);
      if (attempt.kind !== kind) {
        return yield* DomainKitError.fail(
          new DomainKitError.NotFound({
            entity: "approval",
            id: typeof approval === "string" ? approval : approval.id,
          }),
        );
      }
      const stored = attempt.approval;
      if (stored === null || (typeof approval !== "string" && stored.id !== approval.id)) {
        return yield* DomainKitError.fail(
          new DomainKitError.NotFound({
            entity: "approval",
            id: typeof approval === "string" ? approval : approval.id,
          }),
        );
      }
      if (attempt.receipt !== null) return attempt.receipt;
      const now = yield* DateTime.now;
      if (past(stored.expiresAt, now)) return yield* expired("approval", stored.id);
      const claimed = yield* storage.attempts.claim(
        attempt.id,
        DateTime.addDuration(now, Duration.millis(policy.applyLeaseMs)),
      );
      return yield* run(claimed, stored).pipe(
        Effect.tapError((error) =>
          storage.attempts.fail(claimed.id, error.message).pipe(Effect.ignore),
        ),
      );
    });

  /** Writes under a claimed lease; a failure before any write releases the attempt as `failed`. */
  const run = (attempt: Storage.Attempt, approval: Approval.Approval): Fx<Receipt.Receipt> =>
    Effect.gen(function* () {
      const plan = attempt.plan;
      const attachment = yield* storage.attachments.get(attempt.attachmentId);
      const { session, target } = yield* connect.session(attachment.id);
      const dns = session.dns(target);
      yield* revalidate(plan, dns, target.zone);
      const approved = new Set(approval.operationIds);
      const outcomes: Array<Receipt.Outcome> = [];
      const applied: Array<Receipt.Applied> = [];
      let stopped = false;
      const finish = (status: "complete" | "partial") =>
        Effect.gen(function* () {
          const receipt = new Receipt.Receipt({
            id: Receipt.ReceiptId.make(yield* fresh("rcpt")),
            version: "domainkit.receipt.v2",
            kind,
            planId: plan.id,
            approvalId: approval.id,
            digest: plan.digest,
            provider: plan.provider,
            zone: plan.zone,
            status,
            outcomes: [...outcomes],
            appliedAt: yield* DateTime.now,
          });
          yield* storage.attempts.complete(attempt.id, receipt);
          return receipt;
        });
      const writes = Effect.gen(function* () {
        for (const operation of plan.operations) {
          if (operation._tag === "Noop") {
            outcomes.push(new Receipt.Skipped({ operationId: operation.id, reason: "noop" }));
            continue;
          }
          if (operation._tag === "Conflict" || !approved.has(operation.id)) {
            outcomes.push(
              new Receipt.Skipped({ operationId: operation.id, reason: "not-approved" }),
            );
            continue;
          }
          if (stopped) {
            outcomes.push(
              new Receipt.Skipped({ operationId: operation.id, reason: "not-attempted" }),
            );
            continue;
          }
          const result = yield* write(plan, operation, dns, target.zone).pipe(Effect.result);
          if (result._tag === "Success") {
            const outcome = new Receipt.Applied({
              operationId: operation.id,
              providerRecordId: result.success,
            });
            outcomes.push(outcome);
            applied.push(outcome);
            continue;
          }
          if (applied.length === 0) return yield* Effect.fail(result.failure);
          stopped = true;
          outcomes.push(
            new Receipt.Failed({ operationId: operation.id, message: result.failure.message }),
          );
        }
        return yield* finish(stopped ? "partial" : "complete");
      });
      return yield* writes.pipe(
        Effect.onInterrupt(() =>
          applied.length === 0
            ? Effect.void
            : Effect.gen(function* () {
                for (const operation of plan.operations) {
                  if (outcomes.some((outcome) => outcome.operationId === operation.id)) continue;
                  outcomes.push(
                    new Receipt.Skipped({ operationId: operation.id, reason: "not-attempted" }),
                  );
                }
                yield* finish("partial");
              }).pipe(Effect.ignore),
        ),
      );
    });

  /** Re-plan the zone and fail `Stale` when the digest moved since the plan was built. */
  const revalidate = (plan: Plan.Plan, dns: Provider.Dns, zone: string) =>
    Effect.gen(function* () {
      const current = yield* currentOperations(plan, dns, zone);
      const digest = yield* Planner.digest({
        version: plan.version,
        kind: plan.kind,
        domain: plan.domain,
        zone: plan.zone,
        provider: plan.provider,
        attachmentId: plan.attachmentId,
        operations: current,
      });
      if (digest !== plan.digest) return yield* stale(plan);
    });

  const currentOperations = (
    plan: Plan.Plan,
    dns: Provider.Dns,
    zone: string,
  ): Effect.Effect<ReadonlyArray<Plan.Operation>, DomainKitError.DomainKitError> =>
    kind === "provisioning"
      ? Effect.flatMap(dns.list(zone), (observed) =>
          Planner.reconcile(
            Planner.requirements(plan),
            observed.map(({ record: observedRecord }) => observedRecord),
          ),
        )
      : Effect.forEach(
          plan.operations,
          (operation): Effect.Effect<Plan.Operation, DomainKitError.DomainKitError> =>
            operation._tag === "Delete"
              ? cleanupOperation(
                  dns,
                  zone,
                  operation.id,
                  operation.record,
                  operation.providerRecordId,
                )
              : Effect.succeed(operation),
        );

  const write = (
    plan: Plan.Plan,
    operation: Plan.Create | Plan.Delete,
    dns: Provider.Dns,
    zone: string,
  ): Effect.Effect<string | null, DomainKitError.DomainKitError> =>
    operation._tag === "Create"
      ? Effect.gen(function* () {
          const observed = yield* dns.list(zone);
          const [check] = yield* Planner.reconcile(
            [operation.record],
            observed.map(({ record: observedRecord }) => observedRecord),
          );
          if (check?._tag !== "Create") return yield* stale(plan);
          const created = yield* dns.create(zone, operation.record);
          return created.providerRecordId;
        })
      : Effect.gen(function* () {
          const check = yield* cleanupOperation(
            dns,
            zone,
            operation.id,
            operation.record,
            operation.providerRecordId,
          );
          if (check._tag !== "Delete") return yield* stale(plan);
          yield* dns.delete(zone, operation.providerRecordId);
          return operation.providerRecordId;
        });

  return { record, approve, apply, attemptOf };
};

/** Read one receipt-proven record back; anything but an exact match is a conflict. */
export const cleanupOperation = (
  dns: Provider.Dns,
  zone: string,
  id: Plan.OperationId,
  record: DnsRecord.DnsRecord,
  providerRecordId: string,
): Effect.Effect<Plan.Delete | Plan.Conflict, DomainKitError.DomainKitError> =>
  Effect.map(dns.get(zone, providerRecordId), (observed) => {
    if (observed === null)
      return new Plan.Conflict({ id, record, existing: [], reason: "missing" });
    if (!DnsRecord.equals(observed, record)) {
      return new Plan.Conflict({ id, record, existing: [observed], reason: "value-mismatch" });
    }
    return new Plan.Delete({ id, record, providerRecordId });
  });
