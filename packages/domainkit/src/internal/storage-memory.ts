import { DateTime, Effect, Option, Semaphore } from "effect";

import type * as Approval from "../Approval.ts";
import * as DomainKitError from "../DomainKitError.ts";
import * as Plan from "../Plan.ts";
import { Principal, type Shape } from "../Principal.ts";
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
  readonly readiness: Map<string, Storage.Readiness>;
  readonly locks: Set<string>;
}

const notFound = (entity: DomainKitError.NotFound["entity"], id: string) =>
  DomainKitError.fail(new DomainKitError.NotFound({ entity, id }));
const invalid = (message: string, field?: string) =>
  DomainKitError.fail(
    new DomainKitError.InvalidInput({ message, ...(field === undefined ? {} : { field }) }),
  );

export function makeMemory(options: Storage.MemoryOptions = {}): Storage.Service {
  const state: State = {
    authorizations: new Map(),
    credentials: new Map(),
    connections: new Map(),
    attachments: new Map(),
    continuations: new Map(),
    attempts: new Map(),
    readiness: new Map(),
    locks: new Set(),
  };
  const mutations = Semaphore.makeUnsafe(1);
  const commit = (operation: string) =>
    options.beforeCommit === undefined ? Effect.void : options.beforeCommit(operation);

  const read = <A, E, R = never>(
    run: (principal: Shape) => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, Principal | R> => Effect.flatMap(Principal, run);
  const write = <A, E>(
    run: (principal: Shape) => Effect.Effect<A, E>,
  ): Effect.Effect<A, E, Principal> =>
    Effect.flatMap(Principal, (principal) => mutations.withPermit(run(principal)));

  const owned = <Row extends { readonly ownerId: string }>(
    rows: Map<string, Row>,
    principal: Shape,
    id: string,
  ): Row | undefined => {
    const row = rows.get(id);
    return row !== undefined && row.ownerId === principal.ownerId ? row : undefined;
  };
  const ownedRows = <Row extends { readonly ownerId: string }>(
    rows: Map<string, Row>,
    principal: Shape,
  ) => [...rows.values()].filter((row) => row.ownerId === principal.ownerId);

  const authorization = (principal: Shape, id: string) =>
    Effect.suspend(() => {
      const row = owned(state.authorizations, principal, id);
      return row === undefined ? notFound("authorization", id) : Effect.succeed(row);
    });
  const connection = (principal: Shape, id: string) =>
    Effect.suspend(() => {
      const row = owned(state.connections, principal, id);
      return row === undefined ? notFound("connection", id) : Effect.succeed(row);
    });
  const attachment = (principal: Shape, id: string) =>
    Effect.suspend(() => {
      const row = owned(state.attachments, principal, id);
      return row === undefined ? notFound("attachment", id) : Effect.succeed(row);
    });
  const attempt = (principal: Shape, id: string) =>
    Effect.suspend(() => {
      const row = owned(state.attempts, principal, id);
      return row === undefined ? notFound("plan", id) : Effect.succeed(row);
    });
  const attemptWhere = (
    principal: Shape,
    entity: DomainKitError.NotFound["entity"],
    id: string,
    predicate: (row: Storage.Attempt) => boolean,
  ) =>
    Effect.suspend(() => {
      const row = ownedRows(state.attempts, principal).find(predicate);
      return row === undefined ? notFound(entity, id) : Effect.succeed(row);
    });

  const finishRevocation = <E, R>(
    principal: Shape,
    row: Storage.Authorization,
    revoke: Effect.Effect<void, E, R>,
  ): Effect.Effect<void, DomainKitError.DomainKitError | E, R> =>
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
                return yield* DomainKitError.fail(
                  new DomainKitError.Busy({ key: `authorization:${expectedId}` }),
                );
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
            state.readiness.delete(id);
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
      consume: (id) =>
        write((principal) =>
          Effect.gen(function* () {
            const row = owned(state.continuations, principal, id);
            if (row === undefined) return yield* notFound("continuation", id);
            yield* commit("continuations.consume");
            state.continuations.delete(id);
            const now = yield* DateTime.now;
            if (DateTime.toEpochMillis(row.expiresAt) <= DateTime.toEpochMillis(now)) {
              return yield* DomainKitError.fail(
                new DomainKitError.Expired({ entity: "continuation", id }),
              );
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
          Effect.sync(() => {
            const rows = ownedRows(state.attempts, principal)
              .filter((row) => row.attachmentId === attachmentId && row.kind === kind)
              .sort(
                (left, right) =>
                  DateTime.toEpochMillis(right.plan.createdAt) -
                  DateTime.toEpochMillis(left.plan.createdAt),
              );
            return Option.fromNullishOr(rows[0]);
          }),
        ),
      approve: (id, approval: Approval.Approval) =>
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
                return yield* DomainKitError.fail(new DomainKitError.Busy({ key: `apply:${id}` }));
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
      complete: (id, receipt: Receipt.Receipt) =>
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
    readiness: {
      put: (readiness) =>
        write((principal) =>
          Effect.gen(function* () {
            if (readiness.ownerId !== principal.ownerId) {
              return yield* invalid("Readiness owner does not match the principal", "ownerId");
            }
            yield* attachment(principal, readiness.attachmentId);
            yield* commit("readiness.put");
            state.readiness.set(readiness.attachmentId, readiness);
          }),
        ),
      get: (attachmentId) =>
        read((principal) =>
          Effect.sync(() => Option.fromNullishOr(owned(state.readiness, principal, attachmentId))),
        ),
    },
    withLock: (key, effect) =>
      Effect.flatMap(Principal, (principal) => {
        const scoped = `${principal.ownerId}:${key}`;
        return Effect.acquireRelease(
          Effect.suspend(() => {
            if (state.locks.has(scoped)) {
              return DomainKitError.fail(new DomainKitError.Busy({ key }));
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
  DomainKitError.fail(
    new DomainKitError.Stale({ planId: Plan.PlanId.make(row.id), digest: row.plan.digest }),
  );
