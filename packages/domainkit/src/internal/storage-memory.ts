import { DateTime, Effect, Option, Semaphore } from "effect";

import type * as Approval from "../Approval.ts";
import * as Errors from "./error.ts";
import * as Reason from "../Reason.ts";
import * as Plan from "../Plan.ts";
import * as Principal from "../Principal.ts";
import type * as Receipt from "../Receipt.ts";
import * as Storage from "../Storage.ts";
import { fresh } from "./ids.ts";

interface State {
  readonly authorizations: Map<string, Storage.Authorization>;
  readonly credentials: Map<string, Storage.Credential>;
  readonly connections: Map<string, Storage.Connection>;
  readonly attachments: Map<string, Storage.Attachment>;
  readonly continuations: Map<string, Storage.Continuation>;
  readonly attempts: Map<string, Storage.Attempt>;
  readonly batches: Map<string, Storage.Batch>;
  /** Items by batch id, kept in `position` order. */
  readonly batchItems: Map<string, Array<Storage.BatchItem>>;
  readonly readiness: Map<string, Storage.Readiness>;
  readonly locks: Set<string>;
}

const notFound = (entity: Reason.NotFound["entity"], id: string) =>
  Errors.fail(new Reason.NotFound({ entity, id }));
const invalid = (message: string, field?: string) =>
  Errors.fail(new Reason.InvalidInput({ message, ...(field === undefined ? {} : { field }) }));

export function makeMemory(options: Storage.MemoryOptions = {}): Storage.Interface {
  const state: State = {
    authorizations: new Map(),
    credentials: new Map(),
    connections: new Map(),
    attachments: new Map(),
    continuations: new Map(),
    attempts: new Map(),
    batches: new Map(),
    batchItems: new Map(),
    readiness: new Map(),
    locks: new Set(),
  };
  const mutations = Semaphore.makeUnsafe(1);
  const commit = (operation: string) =>
    options.beforeCommit === undefined ? Effect.void : options.beforeCommit(operation);

  const read = <A, E, R = never>(
    run: (principal: Principal.Interface) => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, Principal.Service | R> => Effect.flatMap(Principal.Service, run);
  const write = <A, E>(
    run: (principal: Principal.Interface) => Effect.Effect<A, E>,
  ): Effect.Effect<A, E, Principal.Service> =>
    Effect.flatMap(Principal.Service, (principal) => mutations.withPermit(run(principal)));

  const owned = <Row extends { readonly ownerId: string }>(
    rows: Map<string, Row>,
    principal: Principal.Interface,
    id: string,
  ): Row | undefined => {
    const row = rows.get(id);
    return row !== undefined && row.ownerId === principal.ownerId ? row : undefined;
  };
  const ownedRows = <Row extends { readonly ownerId: string }>(
    rows: Map<string, Row>,
    principal: Principal.Interface,
  ) => [...rows.values()].filter((row) => row.ownerId === principal.ownerId);

  const authorization = (principal: Principal.Interface, id: string) =>
    Effect.suspend(() => {
      const row = owned(state.authorizations, principal, id);
      return row === undefined ? notFound("authorization", id) : Effect.succeed(row);
    });
  const connection = (principal: Principal.Interface, id: string) =>
    Effect.suspend(() => {
      const row = owned(state.connections, principal, id);
      return row === undefined ? notFound("connection", id) : Effect.succeed(row);
    });
  const attachment = (principal: Principal.Interface, id: string) =>
    Effect.suspend(() => {
      const row = owned(state.attachments, principal, id);
      return row === undefined ? notFound("attachment", id) : Effect.succeed(row);
    });
  const attempt = (principal: Principal.Interface, id: string) =>
    Effect.suspend(() => {
      const row = owned(state.attempts, principal, id);
      return row === undefined ? notFound("plan", id) : Effect.succeed(row);
    });
  const attemptWhere = (
    principal: Principal.Interface,
    entity: Reason.NotFound["entity"],
    id: string,
    predicate: (row: Storage.Attempt) => boolean,
  ) =>
    Effect.suspend(() => {
      const row = ownedRows(state.attempts, principal).find(predicate);
      return row === undefined ? notFound(entity, id) : Effect.succeed(row);
    });

  const batch = (principal: Principal.Interface, id: string) =>
    Effect.suspend(() => {
      const row = owned(state.batches, principal, id);
      return row === undefined ? notFound("batch", id) : Effect.succeed(row);
    });

  const itemsOf = (batchId: string): ReadonlyArray<Storage.BatchItem> =>
    [...(state.batchItems.get(batchId) ?? [])].sort(
      (left, right) => left.position - right.position,
    );

  const aggregateOf = (row: Storage.Batch): Storage.BatchAggregate => ({
    batch: row,
    items: itemsOf(row.id),
  });

  const batchStale = (row: Storage.Batch) =>
    Errors.fail(new Reason.BatchStale({ batchId: row.id, status: row.status, digest: row.digest }));

  const statusOf = (row: Storage.Batch, items: ReadonlyArray<Storage.BatchItem>) =>
    Storage.batchStatusOf({
      approved: row.approval !== null,
      rejected: row.rejection !== null,
      items: items.map((item) =>
        item.attemptId === null ? null : (state.attempts.get(item.attemptId)?.status ?? null),
      ),
    });

  /** Store `row` with its status recomputed from the items' attempts, and return the aggregate. */
  const settle = (row: Storage.Batch, now: DateTime.Utc): Storage.BatchAggregate => {
    const items = itemsOf(row.id);
    const status = statusOf(row, items);
    const next = new Storage.Batch({
      ...row,
      status,
      completedAt: status === "complete" || status === "rejected" ? now : null,
      updatedAt: now,
    });
    state.batches.set(row.id, next);
    return { batch: next, items };
  };

  const replaceItem = (item: Storage.BatchItem) => {
    const items = state.batchItems.get(item.batchId) ?? [];
    const index = items.findIndex((row) => row.attachmentId === item.attachmentId);
    if (index >= 0) items[index] = item;
  };

  /** Only a batch still being planned accepts plan state, an approval, or a rejection. */
  const openForPlanning = (row: Storage.Batch) =>
    row.status === "planning" || row.status === "planned" ? Effect.void : batchStale(row);

  const itemAt = (row: Storage.Batch, attachmentId: string) =>
    Effect.suspend(() => {
      const item = itemsOf(row.id).find((entry) => entry.attachmentId === attachmentId);
      return item === undefined ? notFound("attachment", attachmentId) : Effect.succeed(item);
    });

  const finishRevocation = <E, R>(
    principal: Principal.Interface,
    row: Storage.Authorization,
    revoke: Effect.Effect<void, E, R>,
  ): Effect.Effect<void, Errors.DomainKitError | E, R> =>
    Effect.gen(function* () {
      yield* commit("authorizations.prepareRevocation");
      state.authorizations.set(
        row.id,
        new Storage.Authorization({ ...row, revocation: "pending" }),
      );
      yield* revoke;
      yield* commit("authorizations.completeRevocation");
      if (owned(state.authorizations, principal, row.id) !== undefined) {
        state.authorizations.delete(row.id);
        state.credentials.delete(row.id);
      }
    });

  return {
    authorizations: {
      upsert: ({ authorization: input, credential, expectedId }) =>
        write((principal) =>
          Effect.gen(function* () {
            if (input.ownerId !== principal.ownerId) {
              return yield* invalid("Authorization owner does not match the principal", "ownerId");
            }
            if (expectedId !== undefined) {
              const current = yield* authorization(principal, expectedId);
              if (current.revocation !== "active") {
                return yield* Errors.fail(new Reason.Busy({ key: `authorization:${expectedId}` }));
              }
              if (input.id !== expectedId) {
                return yield* invalid("Authorization id must match expectedId", "id");
              }
            } else if (state.authorizations.has(input.id)) {
              return yield* invalid(`Authorization ${input.id} already exists`, "id");
            }
            yield* commit("authorizations.upsert");
            state.authorizations.set(input.id, input);
            state.credentials.set(input.id, credential);
            return input;
          }),
        ),
      get: (id) => read((principal) => authorization(principal, id)),
      credential: (id) =>
        read((principal) =>
          authorization(principal, id).pipe(
            Effect.flatMap(() => {
              const row = state.credentials.get(id);
              return row === undefined ? notFound("authorization", id) : Effect.succeed(row);
            }),
          ),
        ),
      rotate: (id, credential) =>
        write((principal) =>
          Effect.gen(function* () {
            yield* authorization(principal, id);
            yield* commit("authorizations.rotate");
            state.credentials.set(id, credential);
          }),
        ),
      promoteCapabilities: (id, capabilities) =>
        write((principal) =>
          Effect.gen(function* () {
            const row = yield* authorization(principal, id);
            yield* commit("authorizations.promoteCapabilities");
            state.authorizations.set(
              id,
              new Storage.Authorization({
                ...row,
                capabilities: [...new Set([...row.capabilities, ...capabilities])],
              }),
            );
          }),
        ),
      revoke: (id, revoke) =>
        read((principal) =>
          authorization(principal, id).pipe(
            Effect.flatMap((row) => finishRevocation(principal, row, revoke)),
          ),
        ),
      recoverRevocations: (revoke) =>
        read((principal) =>
          Effect.forEach(
            ownedRows(state.authorizations, principal).filter(
              (row) => row.revocation === "pending",
            ),
            (row) => finishRevocation(principal, row, revoke(row)),
          ).pipe(Effect.map((finished) => finished.length)),
        ),
    },
    connections: {
      create: (authorizationId) =>
        write((principal) =>
          Effect.gen(function* () {
            yield* authorization(principal, authorizationId);
            const row = new Storage.Connection({
              id: yield* fresh("conn"),
              ownerId: principal.ownerId,
              authorizationId,
              createdAt: yield* DateTime.now,
            });
            yield* commit("connections.create");
            state.connections.set(row.id, row);
            return row;
          }),
        ),
      get: (id) => read((principal) => connection(principal, id)),
      list: (filter) =>
        read((principal) =>
          Effect.sync(() =>
            ownedRows(state.connections, principal).filter(
              (row) =>
                filter?.provider === undefined ||
                state.authorizations.get(row.authorizationId)?.provider === filter.provider,
            ),
          ),
        ),
      remove: (id) =>
        write((principal) =>
          Effect.gen(function* () {
            yield* connection(principal, id);
            if (ownedRows(state.attachments, principal).some((row) => row.connectionId === id)) {
              return yield* invalid(`Connection ${id} still has attachments`, "connectionId");
            }
            yield* commit("connections.remove");
            state.connections.delete(id);
          }),
        ),
    },
    attachments: {
      create: (input) =>
        write((principal) =>
          Effect.gen(function* () {
            yield* connection(principal, input.connectionId);
            if (
              ownedRows(state.attachments, principal).some((row) => row.domain === input.domain)
            ) {
              return yield* invalid(`${input.domain} is already attached`, "domain");
            }
            const row = new Storage.Attachment({
              id: yield* fresh("att"),
              ownerId: principal.ownerId,
              connectionId: input.connectionId,
              domain: input.domain,
              zone: input.zone,
              label: input.label,
              target: input.target,
              createdAt: yield* DateTime.now,
            });
            yield* commit("attachments.create");
            state.attachments.set(row.id, row);
            return row;
          }),
        ),
      get: (id) => read((principal) => attachment(principal, id)),
      byDomain: (domain) =>
        read((principal) =>
          Effect.sync(() =>
            Option.fromNullishOr(
              ownedRows(state.attachments, principal).find((row) => row.domain === domain),
            ),
          ),
        ),
      list: (connectionId) =>
        read((principal) =>
          connection(principal, connectionId).pipe(
            Effect.map(() =>
              ownedRows(state.attachments, principal).filter(
                (row) => row.connectionId === connectionId,
              ),
            ),
          ),
        ),
      remove: (id) =>
        write((principal) =>
          Effect.gen(function* () {
            yield* attachment(principal, id);
            yield* commit("attachments.remove");
            state.attachments.delete(id);
          }),
        ),
    },
    continuations: {
      put: (continuation) =>
        write((principal) =>
          Effect.gen(function* () {
            if (continuation.ownerId !== principal.ownerId) {
              return yield* invalid("Continuation owner does not match the principal", "ownerId");
            }
            yield* commit("continuations.put");
            state.continuations.set(continuation.id, continuation);
          }),
        ),
      get: (id) =>
        read((principal) =>
          Effect.gen(function* () {
            const row = owned(state.continuations, principal, id);
            if (row === undefined) return yield* notFound("continuation", id);
            const now = yield* DateTime.now;
            if (DateTime.toEpochMillis(row.expiresAt) <= DateTime.toEpochMillis(now)) {
              return yield* Errors.fail(new Reason.Expired({ entity: "continuation", id }));
            }
            return row;
          }),
        ),
      header: (id) =>
        Effect.gen(function* () {
          // Unscoped on purpose, unlike every other read here: the provider callback has to learn
          // whose flow it is finishing before it can resolve a principal to scope by. Header
          // fields only; `payload` stays behind `get`.
          const row = state.continuations.get(id);
          if (row === undefined) return yield* notFound("continuation", id);
          const now = yield* DateTime.now;
          if (DateTime.toEpochMillis(row.expiresAt) <= DateTime.toEpochMillis(now)) {
            return yield* Errors.fail(new Reason.Expired({ entity: "continuation", id }));
          }
          return new Storage.ContinuationHeader({
            ownerId: row.ownerId,
            actorId: row.actorId,
            provider: row.provider,
            expiresAt: row.expiresAt,
          });
        }),
      consume: (id) =>
        write((principal) =>
          Effect.gen(function* () {
            const row = owned(state.continuations, principal, id);
            if (row === undefined) return yield* notFound("continuation", id);
            yield* commit("continuations.consume");
            state.continuations.delete(id);
            const now = yield* DateTime.now;
            if (DateTime.toEpochMillis(row.expiresAt) <= DateTime.toEpochMillis(now)) {
              return yield* Errors.fail(new Reason.Expired({ entity: "continuation", id }));
            }
            return row;
          }),
        ),
    },
    attempts: {
      create: (input) =>
        write((principal) =>
          Effect.gen(function* () {
            if (input.ownerId !== principal.ownerId) {
              return yield* invalid("Attempt owner does not match the principal", "ownerId");
            }
            if (state.attempts.has(input.id)) {
              return yield* invalid(`Plan ${input.id} already exists`, "id");
            }
            yield* commit("attempts.create");
            state.attempts.set(input.id, input);
            return input;
          }),
        ),
      get: (id) => read((principal) => attempt(principal, id)),
      byApproval: (id) =>
        read((principal) =>
          attemptWhere(principal, "approval", id, (row) => row.approval?.id === id),
        ),
      byReceipt: (id) =>
        read((principal) =>
          attemptWhere(principal, "receipt", id, (row) => row.receipt?.id === id),
        ),
      latest: (attachmentId, kind) =>
        read((principal) =>
          Effect.sync(() =>
            Option.fromNullishOr(
              ownedRows(state.attempts, principal)
                .filter((row) => row.attachmentId === attachmentId && row.kind === kind)
                .reduce<Storage.Attempt | undefined>(
                  (best, row) =>
                    best === undefined ||
                    DateTime.toEpochMillis(row.plan.createdAt) >=
                      DateTime.toEpochMillis(best.plan.createdAt)
                      ? row
                      : best,
                  undefined,
                ),
            ),
          ),
        ),
      approve: (id, approval: Approval.Model) =>
        write((principal) =>
          Effect.gen(function* () {
            const row = yield* attempt(principal, id);
            if (row.approval?.id === approval.id) return row;
            if (row.status !== "planned") return yield* stale(row);
            const next = new Storage.Attempt({
              ...row,
              status: "approved",
              approval,
              updatedAt: yield* DateTime.now,
            });
            yield* commit("attempts.approve");
            state.attempts.set(id, next);
            return next;
          }),
        ),
      reject: (id, input) =>
        write((principal) =>
          Effect.gen(function* () {
            const row = yield* attempt(principal, id);
            if (row.status === "rejected") return row;
            if (row.status === "expired") {
              return yield* Errors.fail(new Reason.Expired({ entity: "plan", id }));
            }
            if (row.status !== "planned" || row.plan.digest !== input.digest)
              return yield* stale(row);
            const now = yield* DateTime.now;
            const next = new Storage.Attempt({
              ...row,
              status: "rejected",
              rejection: { actorId: input.actorId, reason: input.reason, at: now },
              updatedAt: now,
            });
            yield* commit("attempts.reject");
            state.attempts.set(id, next);
            return next;
          }),
        ),
      claim: (id, lease) =>
        write((principal) =>
          Effect.gen(function* () {
            const row = yield* attempt(principal, id);
            const now = yield* DateTime.now;
            if (row.status === "applying") {
              const held =
                row.leaseExpiresAt !== null &&
                DateTime.toEpochMillis(row.leaseExpiresAt) > DateTime.toEpochMillis(now);
              if (held) {
                return yield* Errors.fail(new Reason.Busy({ key: `apply:${id}` }));
              }
            } else if (row.status !== "approved" && row.status !== "failed") {
              return yield* stale(row);
            }
            const next = new Storage.Attempt({
              ...row,
              status: "applying",
              leaseExpiresAt: lease,
              failure: null,
              updatedAt: now,
            });
            yield* commit("attempts.claim");
            state.attempts.set(id, next);
            return next;
          }),
        ),
      complete: (id, receipt: Receipt.Model) =>
        write((principal) =>
          Effect.gen(function* () {
            const row = yield* attempt(principal, id);
            if (row.status !== "applying") return yield* stale(row);
            const next = new Storage.Attempt({
              ...row,
              status: receipt.status,
              receipt,
              leaseExpiresAt: null,
              updatedAt: yield* DateTime.now,
            });
            yield* commit("attempts.complete");
            state.attempts.set(id, next);
            return next;
          }),
        ),
      fail: (id, message) =>
        write((principal) =>
          Effect.gen(function* () {
            const row = yield* attempt(principal, id);
            if (row.status !== "applying") return yield* stale(row);
            const next = new Storage.Attempt({
              ...row,
              status: "failed",
              failure: message,
              leaseExpiresAt: null,
              updatedAt: yield* DateTime.now,
            });
            yield* commit("attempts.fail");
            state.attempts.set(id, next);
            return next;
          }),
        ),
    },
    batches: {
      create: (input) =>
        write((principal) =>
          Effect.gen(function* () {
            const replay = ownedRows(state.batches, principal).find(
              (row) => row.idempotencyKey === input.idempotencyKey,
            );
            if (replay !== undefined) return aggregateOf(replay);
            if (input.attachmentIds.length === 0) {
              return yield* invalid("A batch needs at least one attachment", "attachmentIds");
            }
            if (new Set(input.attachmentIds).size !== input.attachmentIds.length) {
              return yield* invalid("A batch holds one item per attachment", "attachmentIds");
            }
            for (const attachmentId of input.attachmentIds) {
              yield* attachment(principal, attachmentId);
            }
            const now = yield* DateTime.now;
            const id = Storage.BatchId.make(yield* fresh("batch"));
            const row = new Storage.Batch({
              id,
              ownerId: principal.ownerId,
              kind: input.kind,
              status: "planning",
              digest: null,
              approval: null,
              rejection: null,
              idempotencyKey: input.idempotencyKey,
              createdBy: principal.actorId,
              createdAt: now,
              updatedAt: now,
              completedAt: null,
            });
            yield* commit("batches.create");
            state.batches.set(id, row);
            state.batchItems.set(
              id,
              input.attachmentIds.map(
                (attachmentId, position) =>
                  new Storage.BatchItem({
                    batchId: id,
                    attachmentId,
                    position,
                    attemptId: null,
                    planFailure: null,
                  }),
              ),
            );
            return aggregateOf(row);
          }),
        ),
      get: (id) => read((principal) => Effect.map(batch(principal, id), aggregateOf)),
      listUnfinished: () =>
        read((principal) =>
          Effect.sync(() =>
            ownedRows(state.batches, principal)
              .filter((row) => row.status !== "complete" && row.status !== "rejected")
              .sort(
                (left, right) =>
                  DateTime.toEpochMillis(right.updatedAt) - DateTime.toEpochMillis(left.updatedAt),
              )
              .map(aggregateOf),
          ),
        ),
      recordItemPlan: (id, attachmentId, attemptId) =>
        write((principal) =>
          Effect.gen(function* () {
            const row = yield* batch(principal, id);
            yield* openForPlanning(row);
            const item = yield* itemAt(row, attachmentId);
            const planned = yield* attempt(principal, attemptId);
            if (planned.attachmentId !== attachmentId || planned.kind !== row.kind) {
              return yield* invalid(
                `Plan ${attemptId} does not belong to attachment ${attachmentId} in this batch`,
                "attemptId",
              );
            }
            yield* commit("batches.recordItemPlan");
            replaceItem(new Storage.BatchItem({ ...item, attemptId, planFailure: null }));
            return settle(row, yield* DateTime.now);
          }),
        ),
      recordItemPlanFailure: (id, attachmentId, message) =>
        write((principal) =>
          Effect.gen(function* () {
            const row = yield* batch(principal, id);
            yield* openForPlanning(row);
            const item = yield* itemAt(row, attachmentId);
            yield* commit("batches.recordItemPlanFailure");
            replaceItem(new Storage.BatchItem({ ...item, attemptId: null, planFailure: message }));
            return settle(row, yield* DateTime.now);
          }),
        ),
      approve: (id, input) =>
        write((principal) =>
          Effect.gen(function* () {
            const row = yield* batch(principal, id);
            // Replaying the same approval is how a retried request stays safe.
            if (row.approval !== null) {
              return row.digest === input.digest ? aggregateOf(row) : yield* batchStale(row);
            }
            if (row.status !== "planned") return yield* batchStale(row);
            const items = itemsOf(id);
            const pairs: Array<{
              readonly attempt: Storage.Attempt;
              readonly approval: Approval.Model;
            }> = [];
            for (const item of items) {
              const supplied = input.approvals.find(
                (entry) => entry.attachmentId === item.attachmentId,
              );
              if (supplied === undefined) {
                return yield* invalid(
                  `Batch ${id} has no approval for attachment ${item.attachmentId}`,
                  "approvals",
                );
              }
              // The item has to still point at the attempt this approval names: anything else
              // means the batch was re-planned after the principal reviewed it.
              const stored =
                item.attemptId === null ? undefined : state.attempts.get(item.attemptId);
              if (stored === undefined || stored.id !== supplied.approval.planId) {
                return yield* batchStale(row);
              }
              pairs.push({ attempt: stored, approval: supplied.approval });
            }
            const now = yield* DateTime.now;
            yield* commit("batches.approve");
            for (const { attempt: stored, approval } of pairs) {
              if (stored.approval?.id === approval.id) continue;
              state.attempts.set(
                stored.id,
                new Storage.Attempt({
                  ...stored,
                  status: "approved",
                  approval,
                  updatedAt: now,
                }),
              );
            }
            return settle(
              new Storage.Batch({
                ...row,
                digest: input.digest,
                approval: { actorId: input.actorId, at: now },
              }),
              now,
            );
          }),
        ),
      reject: (id, input) =>
        write((principal) =>
          Effect.gen(function* () {
            const row = yield* batch(principal, id);
            // Terminal: a second rejection is the same outcome, so it returns the first one.
            if (row.rejection !== null) return aggregateOf(row);
            yield* openForPlanning(row);
            const now = yield* DateTime.now;
            yield* commit("batches.reject");
            for (const item of itemsOf(id)) {
              const stored =
                item.attemptId === null ? undefined : state.attempts.get(item.attemptId);
              if (stored === undefined || stored.status !== "planned") continue;
              state.attempts.set(
                stored.id,
                new Storage.Attempt({
                  ...stored,
                  status: "rejected",
                  rejection: { actorId: input.actorId, reason: input.reason, at: now },
                  updatedAt: now,
                }),
              );
            }
            return settle(
              new Storage.Batch({
                ...row,
                rejection: { actorId: input.actorId, reason: input.reason, at: now },
              }),
              now,
            );
          }),
        ),
      refresh: (id) =>
        write((principal) =>
          Effect.gen(function* () {
            const row = yield* batch(principal, id);
            yield* commit("batches.refresh");
            return settle(row, yield* DateTime.now);
          }),
        ),
    },
    readiness: {
      put: (readiness) =>
        write((principal) =>
          Effect.gen(function* () {
            if (readiness.ownerId !== principal.ownerId) {
              return yield* invalid("Readiness owner does not match the principal", "ownerId");
            }
            if (readiness.attachmentId !== null)
              yield* attachment(principal, readiness.attachmentId);
            yield* commit("readiness.put");
            state.readiness.set(`${principal.ownerId}:${readiness.domain}`, readiness);
          }),
        ),
      get: (domain) =>
        read((principal) =>
          Effect.sync(() =>
            Option.fromNullishOr(state.readiness.get(`${principal.ownerId}:${domain}`)),
          ),
        ),
    },
    withLock: (key, effect) =>
      Effect.flatMap(Principal.Service, (principal) => {
        const scoped = `${principal.ownerId}:${key}`;
        return Effect.acquireRelease(
          Effect.suspend(() => {
            if (state.locks.has(scoped)) {
              return Errors.fail(new Reason.Busy({ key }));
            }
            state.locks.add(scoped);
            return Effect.void;
          }),
          () => Effect.sync(() => void state.locks.delete(scoped)),
        ).pipe(
          Effect.flatMap(() => effect),
          Effect.scoped,
        );
      }),
  };
}

const stale = (row: Storage.Attempt) =>
  Errors.fail(new Reason.Stale({ planId: Plan.PlanId.make(row.id), digest: row.plan.digest }));
