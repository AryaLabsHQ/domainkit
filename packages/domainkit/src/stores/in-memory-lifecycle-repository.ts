import { Effect, Layer, Ref, Semaphore } from "effect";

import * as ProviderAuthorization from "../auth/authorization.ts";
import * as Connection from "../auth/connection.ts";
import * as Lifecycle from "../auth/lifecycle-repository.ts";

export interface Options {
  readonly beforeCommit?: (
    operation: string,
    aggregate: Lifecycle.Aggregate | null,
  ) => Effect.Effect<void, Lifecycle.Error>;
}

function missing(operation: string, message: string): Lifecycle.Error {
  return new Lifecycle.Error({
    category: "storage",
    message,
    operation,
    retry: "never",
  });
}

function conflict(operation: string, message: string): Lifecycle.Error {
  return new Lifecycle.Error({
    category: "storage",
    message,
    operation,
    retry: "after-user-action",
  });
}

function ownerConnection(
  aggregate: Lifecycle.Aggregate,
  connectionId: string,
  ownerId: string,
): Connection.StoredConnection | undefined {
  return aggregate.connections.find(
    (connection) => connection.id === connectionId && connection.ownerId === ownerId,
  );
}

function publicConnection(
  connection: Connection.StoredConnection,
  authorization: ProviderAuthorization.ProviderAuthorization,
): Connection.ProviderConnection {
  return Connection.project(connection, authorization);
}

export function make(options: Options = {}): Lifecycle.Interface {
  const state = Effect.runSync(Ref.make<ReadonlyMap<string, Lifecycle.Aggregate>>(new Map()));
  const mutations = Semaphore.makeUnsafe(1);
  const serialize = <A, E, R>(effect: Effect.Effect<A, E, R>) => mutations.withPermit(effect);

  const commit = Effect.fn("InMemoryManagedDnsConnections.commit")(function* (
    operation: string,
    aggregate: Lifecycle.Aggregate,
  ) {
    if (options.beforeCommit !== undefined) yield* options.beforeCommit(operation, aggregate);
    yield* Ref.update(state, (entries) => {
      const next = new Map(entries);
      next.set(aggregate.authorization.id, aggregate);
      return next;
    });
  });

  const remove = Effect.fn("InMemoryManagedDnsConnections.remove")(function* (
    operation: string,
    authorizationId: string,
  ) {
    if (options.beforeCommit !== undefined) yield* options.beforeCommit(operation, null);
    yield* Ref.update(state, (entries) => {
      const next = new Map(entries);
      next.delete(authorizationId);
      return next;
    });
  });

  const get = Effect.fn("ManagedDnsConnections.get")((authorizationId: string) =>
    Ref.get(state).pipe(Effect.map((entries) => entries.get(authorizationId) ?? null)),
  );

  const getByConnectionId = Effect.fn("ManagedDnsConnections.getByConnectionId")(
    (connectionId: string) =>
      Ref.get(state).pipe(
        Effect.map(
          (entries) =>
            [...entries.values()].find((aggregate) =>
              aggregate.connections.some((connection) => connection.id === connectionId),
            ) ?? null,
        ),
      ),
  );

  const finishRevocation = Effect.fn("InMemoryManagedDnsConnections.finishRevocation")(function* <
    E,
  >(
    aggregate: Lifecycle.Aggregate,
    connection: Connection.StoredConnection,
    revoke: (authorization: ProviderAuthorization.ProviderAuthorization) => Effect.Effect<void, E>,
  ) {
    const pending: Lifecycle.Aggregate = {
      ...aggregate,
      authorization: {
        ...aggregate.authorization,
        revocation:
          aggregate.authorization.revocation._tag === "Pending"
            ? aggregate.authorization.revocation
            : { _tag: "Pending", requestedAt: new Date() },
      },
    };
    yield* commit("prepareRevocation", pending);
    yield* revoke(pending.authorization);
    yield* remove("completeRevocation", pending.authorization.id);
    return {
      connection: publicConnection(connection, pending.authorization),
      remainingConnections: 0,
      revokedAuthorization: true,
    } satisfies Lifecycle.DisconnectResult;
  });

  return Lifecycle.Service.of({
    attach: ({ attachment, connectionId, ownerId }) =>
      serialize(
        Effect.gen(function* () {
          const aggregate = yield* getByConnectionId(connectionId);
          if (aggregate === null) {
            return yield* missing("attach", "Provider connection does not exist");
          }
          const connection = ownerConnection(aggregate, connectionId, ownerId);
          if (connection === undefined) {
            return yield* missing("attach", "Provider connection does not belong to this owner");
          }
          if (attachment.connectionId !== connectionId) {
            return yield* conflict("attach", "Domain attachment targets another connection");
          }
          const existing = aggregate.attachments.find(({ id }) => id === attachment.id);
          if (existing !== undefined) {
            if (
              existing.connectionId !== attachment.connectionId ||
              existing.domain !== attachment.domain ||
              existing.target.accountId !== attachment.target.accountId ||
              existing.target.accountKind !== attachment.target.accountKind ||
              existing.target.zoneId !== attachment.target.zoneId ||
              existing.target.zoneName !== attachment.target.zoneName
            ) {
              return yield* conflict("attach", "Domain attachment id is already in use");
            }
            return {
              attachment: existing,
              connection: publicConnection(connection, aggregate.authorization),
            };
          }
          const duplicateId = [...(yield* Ref.get(state)).values()].some((candidate) =>
            candidate.attachments.some(({ id }) => id === attachment.id),
          );
          if (duplicateId) {
            return yield* conflict("attach", "Domain attachment id is already in use");
          }
          const duplicate = [...(yield* Ref.get(state)).values()].some((candidate) => {
            return candidate.attachments.some(
              ({ connectionId: attachmentConnectionId, domain }) =>
                domain === attachment.domain &&
                candidate.connections.some(
                  (candidateConnection) =>
                    candidateConnection.id === attachmentConnectionId &&
                    candidateConnection.ownerId === ownerId,
                ),
            );
          });
          if (duplicate) {
            return yield* conflict(
              "attach",
              "An organization domain already has a provider attachment",
            );
          }
          const next: Lifecycle.Aggregate = {
            ...aggregate,
            attachments: [...aggregate.attachments, attachment],
          };
          yield* commit("attach", next);
          return {
            attachment,
            connection: publicConnection(connection, aggregate.authorization),
          };
        }),
      ),
    connect: (input) =>
      serialize(
        Effect.gen(function* () {
          if (
            input.authorization.id !== input.connection.authorizationId ||
            input.authorization.providerId !== input.connection.providerId ||
            input.authorization.method !== input.connection.method
          ) {
            return yield* conflict("connect", "Connection does not match its authorization");
          }
          const existing = yield* get(input.authorization.id);
          const existingConnection = existing?.connections.find(
            (connection) => connection.ownerId === input.connection.ownerId,
          );
          const connection = existingConnection ?? input.connection;
          const next: Lifecycle.Aggregate = {
            authorization: input.authorization,
            connections: existing
              ? [...existing.connections.filter(({ id }) => id !== connection.id), connection]
              : [connection],
            attachments: existing?.attachments ?? [],
            credential: input.credential,
          };
          yield* commit("connect", next);
          return next;
        }),
      ),
    detach: ({ attachmentId, ownerId }) =>
      serialize(
        Effect.gen(function* () {
          const entries = yield* Ref.get(state);
          for (const aggregate of entries.values()) {
            const attachment = aggregate.attachments.find(({ id }) => id === attachmentId);
            if (attachment === undefined) continue;
            const connection = ownerConnection(aggregate, attachment.connectionId, ownerId);
            if (connection === undefined) {
              return yield* missing("detach", "Domain attachment does not belong to this owner");
            }
            const next: Lifecycle.Aggregate = {
              ...aggregate,
              attachments: aggregate.attachments.filter(({ id }) => id !== attachmentId),
            };
            yield* commit("detach", next);
            return {
              attachment,
              connection: publicConnection(connection, aggregate.authorization),
              remainingAttachments: next.attachments.filter(
                ({ connectionId }) => connectionId === connection.id,
              ).length,
            };
          }
          return yield* missing("detach", "Domain attachment does not exist");
        }),
      ),
    disconnect: ({ connectionId, ownerId, revoke }) =>
      serialize(
        Effect.gen(function* () {
          const aggregate = yield* getByConnectionId(connectionId);
          if (aggregate === null) {
            return yield* missing("disconnect", "Provider connection does not exist");
          }
          const connection = ownerConnection(aggregate, connectionId, ownerId);
          if (connection === undefined) {
            return yield* missing(
              "disconnect",
              "Provider connection does not belong to this owner",
            );
          }
          if (aggregate.attachments.some(({ connectionId: id }) => id === connectionId)) {
            return yield* conflict(
              "disconnect",
              "Detach all organization domains before disconnecting the provider",
            );
          }
          const remainingConnections = aggregate.connections.filter(
            ({ id }) => id !== connectionId,
          );
          if (remainingConnections.length > 0) {
            const next: Lifecycle.Aggregate = { ...aggregate, connections: remainingConnections };
            yield* commit("disconnectConnection", next);
            return {
              connection: publicConnection(connection, aggregate.authorization),
              remainingConnections: remainingConnections.length,
              revokedAuthorization: false,
            };
          }
          return yield* finishRevocation(aggregate, connection, revoke);
        }).pipe(Effect.withSpan("ManagedDnsConnections.disconnect")),
      ),
    findConnection: (ownerId, authorizationId) =>
      Ref.get(state).pipe(
        Effect.map(
          (entries) =>
            entries.get(authorizationId)?.connections.find(({ ownerId: id }) => id === ownerId) ??
            null,
        ),
      ),
    get,
    getAttachment: (attachmentId) =>
      Ref.get(state).pipe(
        Effect.map(
          (entries) =>
            [...entries.values()]
              .flatMap(({ attachments }) => attachments)
              .find(({ id }) => id === attachmentId) ?? null,
        ),
      ),
    getByConnectionId,
    listAttachments: (connectionId, ownerId) =>
      Effect.gen(function* () {
        const aggregate = yield* getByConnectionId(connectionId);
        if (aggregate === null) {
          return yield* missing("listAttachments", "Provider connection does not exist");
        }
        if (ownerConnection(aggregate, connectionId, ownerId) === undefined) {
          return yield* missing(
            "listAttachments",
            "Provider connection does not belong to this owner",
          );
        }
        return aggregate.attachments.filter(({ connectionId: id }) => id === connectionId);
      }),
    promoteEvidence: (authorizationId, evidence) =>
      serialize(
        Effect.gen(function* () {
          const aggregate = yield* get(authorizationId);
          if (aggregate === null) {
            return yield* missing("promoteEvidence", "Provider authorization does not exist");
          }
          const byCapability = new Map(
            aggregate.authorization.capabilityEvidence.map((item) => [item.capability, item]),
          );
          for (const item of evidence) byCapability.set(item.capability, item);
          const next = {
            ...aggregate,
            authorization: {
              ...aggregate.authorization,
              capabilityEvidence: [...byCapability.values()],
            },
          };
          yield* commit("promoteEvidence", next);
          return next;
        }),
      ),
    recover: ({ authorizationId, revoke }) =>
      serialize(
        Effect.gen(function* () {
          const aggregate = yield* get(authorizationId);
          if (aggregate === null) {
            return yield* missing("recover", "Provider authorization does not exist");
          }
          if (aggregate.authorization.revocation._tag !== "Pending") {
            return yield* missing("recover", "Provider authorization is not awaiting revocation");
          }
          const connection = aggregate.connections[0];
          if (connection === undefined) {
            return yield* missing("recover", "Pending authorization has no connection");
          }
          return yield* finishRevocation(aggregate, connection, revoke);
        }).pipe(Effect.withSpan("ManagedDnsConnections.recover")),
      ),
    rotate: (authorizationId, credential, expiresAt) =>
      serialize(
        Effect.gen(function* () {
          const aggregate = yield* get(authorizationId);
          if (aggregate === null) {
            return yield* missing("rotate", "Provider authorization does not exist");
          }
          const next = {
            ...aggregate,
            authorization: { ...aggregate.authorization, expiresAt },
            credential,
          };
          yield* commit("rotate", next);
          return next;
        }),
      ),
  });
}

export const layer = (options: Options = {}) => Layer.sync(Lifecycle.Service, () => make(options));
