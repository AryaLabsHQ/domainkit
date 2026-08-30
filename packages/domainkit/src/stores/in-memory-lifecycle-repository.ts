import { Effect, Layer, Ref, Semaphore } from "effect";

import * as Repository from "../auth/lifecycle-repository.ts";

export interface Options {
  readonly beforeCommit?: (
    operation: string,
    aggregate: Repository.Aggregate | null,
  ) => Effect.Effect<void, Repository.Error>;
}

function missing(operation: string, message: string): Repository.Error {
  return new Repository.Error({
    category: "storage",
    message,
    operation,
    retry: "never",
  });
}

export function make(options: Options = {}): Repository.Interface {
  const state = Effect.runSync(Ref.make<ReadonlyMap<string, Repository.Aggregate>>(new Map()));
  const mutations = Semaphore.makeUnsafe(1);
  const serialize = <A, E, R>(effect: Effect.Effect<A, E, R>) => mutations.withPermit(effect);

  const commit = Effect.fn("InMemoryAuthorizationLifecycleRepository.commit")(function* (
    operation: string,
    aggregate: Repository.Aggregate | null,
  ) {
    if (options.beforeCommit !== undefined) yield* options.beforeCommit(operation, aggregate);
    yield* Ref.update(state, (entries) => {
      const next = new Map(entries);
      if (aggregate === null) return next;
      next.set(aggregate.authorization.id, aggregate);
      return next;
    });
  });

  const remove = Effect.fn("InMemoryAuthorizationLifecycleRepository.remove")(function* (
    authorizationId: string,
  ) {
    if (options.beforeCommit !== undefined) yield* options.beforeCommit("remove", null);
    yield* Ref.update(state, (entries) => {
      const next = new Map(entries);
      next.delete(authorizationId);
      return next;
    });
  });

  const get = Effect.fn("AuthorizationLifecycleRepository.get")((authorizationId: string) =>
    Ref.get(state).pipe(Effect.map((entries) => entries.get(authorizationId) ?? null)),
  );

  const getByConnectionId = Effect.fn("AuthorizationLifecycleRepository.getByConnectionId")(
    (connectionId: string) =>
      Ref.get(state).pipe(
        Effect.map(
          (entries) =>
            [...entries.values()].find((aggregate) =>
              aggregate.bindings.some((binding) => binding.id === connectionId),
            ) ?? null,
        ),
      ),
  );

  const finishRevocation = Effect.fn("AuthorizationLifecycleRepository.finishRevocation")(
    function* <E>(
      aggregate: Repository.Aggregate,
      revoke: (aggregate: Repository.Aggregate) => Effect.Effect<void, E>,
    ) {
      const pending: Repository.Aggregate = {
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
      yield* revoke(pending);
      yield* remove(pending.authorization.id);
      return {
        authorizationId: pending.authorization.id,
        remainingBindings: 0,
        revokedAuthorization: true,
      } satisfies Repository.DetachResult;
    },
  );

  return Repository.Service.of({
    bind: Effect.fn("AuthorizationLifecycleRepository.bind")((authorizationId, binding) =>
      serialize(
        Effect.gen(function* () {
          const aggregate = yield* get(authorizationId);
          if (aggregate === null) {
            return yield* missing("bind", "Authorization aggregate does not exist");
          }
          const next = {
            ...aggregate,
            bindings: [
              ...aggregate.bindings.filter((candidate) => candidate.id !== binding.id),
              binding,
            ],
          };
          yield* commit("bind", next);
          return next;
        }),
      ),
    ),
    connect: Effect.fn("AuthorizationLifecycleRepository.connect")((aggregate) =>
      serialize(
        Effect.gen(function* () {
          yield* commit("connect", aggregate);
          return aggregate;
        }),
      ),
    ),
    detach: ({ connectionId, revoke }) =>
      serialize(
        Effect.gen(function* () {
          const aggregate = yield* getByConnectionId(connectionId);
          if (aggregate === null) {
            return yield* missing("detach", "Connection binding does not exist");
          }
          const remaining = aggregate.bindings.filter((binding) => binding.id !== connectionId);
          if (remaining.length > 0) {
            yield* commit("detachBinding", { ...aggregate, bindings: remaining });
            return {
              authorizationId: aggregate.authorization.id,
              remainingBindings: remaining.length,
              revokedAuthorization: false,
            };
          }
          return yield* finishRevocation(aggregate, revoke);
        }).pipe(Effect.withSpan("AuthorizationLifecycleRepository.detach")),
      ),
    findByProviderAccount: Effect.fn("AuthorizationLifecycleRepository.findByProviderAccount")(
      (providerId: string, providerAccountId: string) =>
        Ref.get(state).pipe(
          Effect.map(
            (entries) =>
              [...entries.values()].find(
                ({ authorization }) =>
                  authorization.providerId === providerId &&
                  authorization.providerAccountId === providerAccountId,
              ) ?? null,
          ),
        ),
    ),
    get,
    getByConnectionId,
    modifyBinding: (connectionId, modify) =>
      serialize(
        Effect.gen(function* () {
          const aggregate = yield* getByConnectionId(connectionId);
          if (aggregate === null) {
            return yield* missing("modifyBinding", "Connection binding does not exist");
          }
          const binding = aggregate.bindings.find((candidate) => candidate.id === connectionId);
          if (binding === undefined) {
            return yield* missing("modifyBinding", "Connection binding does not exist");
          }
          const modification = modify(binding);
          const next = {
            ...aggregate,
            bindings: aggregate.bindings.map((candidate) =>
              candidate.id === connectionId ? modification.binding : candidate,
            ),
          };
          yield* commit("modifyBinding", next);
          return { aggregate: next, value: modification.value };
        }),
      ),
    promoteEvidence: Effect.fn("AuthorizationLifecycleRepository.promoteEvidence")(
      (authorizationId, evidence) =>
        serialize(
          Effect.gen(function* () {
            const aggregate = yield* get(authorizationId);
            if (aggregate === null) {
              return yield* missing("promoteEvidence", "Authorization aggregate does not exist");
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
    ),
    recover: ({ authorizationId, revoke }) =>
      serialize(
        Effect.gen(function* () {
          const aggregate = yield* get(authorizationId);
          if (aggregate === null) {
            return yield* missing("recover", "Authorization aggregate does not exist");
          }
          if (aggregate.authorization.revocation._tag !== "Pending") {
            return yield* missing("recover", "Authorization is not awaiting revocation");
          }
          return yield* finishRevocation(aggregate, revoke);
        }).pipe(Effect.withSpan("AuthorizationLifecycleRepository.recover")),
      ),
    rotate: Effect.fn("AuthorizationLifecycleRepository.rotate")(
      (authorizationId, credential, expiresAt) =>
        serialize(
          Effect.gen(function* () {
            const aggregate = yield* get(authorizationId);
            if (aggregate === null) {
              return yield* missing("rotate", "Authorization aggregate does not exist");
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
    ),
  });
}

export const layer = (options: Options = {}) => Layer.sync(Repository.Service, () => make(options));
