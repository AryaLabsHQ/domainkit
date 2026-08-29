import { Data, Effect, Layer } from "effect";

import * as Connection from "../auth/connection.ts";
import * as Connect from "../auth/connect.ts";
import type * as Repository from "./authorization-lifecycle.ts";
import type * as ProviderAuthorization from "../auth/authorization.ts";
import { webCryptoLayer } from "../plan/canonical-json.ts";
import * as LifecycleRepository from "./authorization-lifecycle.ts";
import type * as Secret from "../auth/secret.ts";

export { assertGrant, AuthorizationError, encode, Grant, Schema } from "../auth/connection.ts";
export type { Connection, OAuthContinuation, StoredCredential } from "../auth/connection.ts";

export function decode(input: unknown): Promise<Connection.Connection> {
  return Effect.runPromise(Connection.decode(input));
}

export type Method = Data.TaggedEnum<{
  Interactive: {
    readonly continuations: ContinuationStore;
    readonly flow: InteractiveFlow;
    readonly ttlMs?: number;
  };
  Token: {
    readonly authenticate: (token: Secret.Value) => Promise<Connect.Authentication>;
    readonly providerId: string;
    readonly requiredCapabilities: ReadonlyArray<ProviderAuthorization.Capability>;
    readonly token: Secret.Value;
  };
}>;
export const Method = Data.taggedEnum<Method>();

export interface ContinuationStore {
  readonly consume: (id: string, now: Date) => Promise<Connect.Continuation | null>;
  readonly put: (continuation: Connect.Continuation) => Promise<void>;
}

export interface InteractiveFlow {
  readonly complete: (payload: Secret.Value, callbackUrl: URL) => Promise<Connect.Authentication>;
  readonly method: "integration" | "oauth2";
  readonly providerId: string;
  readonly requiredCapabilities: ReadonlyArray<ProviderAuthorization.Capability>;
  readonly start: (continuationId: string) => Promise<Connect.InteractiveStart>;
}

const connectionFailure = (operation: string, cause: unknown): Connect.Error =>
  cause instanceof Connect.Error
    ? cause
    : new Connect.Error({
        category: "provider",
        message: cause instanceof globalThis.Error ? cause.message : String(cause),
        operation,
        retry: "unknown",
      });

const effectMethod = (method: Method): Connect.Method =>
  method._tag === "Interactive"
    ? Connect.Method.Interactive({
        continuations: effectContinuations(method.continuations),
        flow: effectFlow(method.flow),
        ...(method.ttlMs === undefined ? {} : { ttlMs: method.ttlMs }),
      })
    : Connect.Method.Token({
        authenticate: (token) =>
          Effect.tryPromise({
            try: () => method.authenticate(token),
            catch: (cause) => connectionFailure("Connection.start", cause),
          }),
        providerId: method.providerId,
        requiredCapabilities: method.requiredCapabilities,
        token: method.token,
      });

const effectContinuations = (store: ContinuationStore): Connect.ContinuationStore => ({
  consume: (id, now) =>
    Effect.tryPromise({
      try: () => store.consume(id, now),
      catch: (cause) => connectionFailure("ConnectionContinuations.consume", cause),
    }),
  put: (continuation) =>
    Effect.tryPromise({
      try: () => store.put(continuation),
      catch: (cause) => connectionFailure("ConnectionContinuations.put", cause),
    }),
});

export const toAsyncContinuations = (store: Connect.ContinuationStore): ContinuationStore => ({
  consume: (id, now) => Effect.runPromise(store.consume(id, now)),
  put: (continuation) => Effect.runPromise(store.put(continuation)),
});

const effectFlow = (flow: InteractiveFlow): Connect.InteractiveFlow => ({
  complete: (payload, callbackUrl) =>
    Effect.tryPromise({
      try: () => flow.complete(payload, callbackUrl),
      catch: (cause) => connectionFailure("Connection.complete", cause),
    }),
  method: flow.method,
  providerId: flow.providerId,
  requiredCapabilities: flow.requiredCapabilities,
  start: (continuationId) =>
    Effect.tryPromise({
      try: () => flow.start(continuationId),
      catch: (cause) => connectionFailure("Connection.start", cause),
    }),
});

/** Adapts an Effect-native provider flow to the Promise facade. */
export const fromEffectFlow = (flow: Connect.InteractiveFlow): InteractiveFlow => ({
  complete: (payload, callbackUrl) => Effect.runPromise(flow.complete(payload, callbackUrl)),
  method: flow.method,
  providerId: flow.providerId,
  requiredCapabilities: flow.requiredCapabilities,
  start: (continuationId) =>
    Effect.runPromise(flow.start(continuationId).pipe(Effect.provide(webCryptoLayer))),
});

/** Adapts an Effect-native token method to the Promise facade. */
export function fromEffectTokenMethod(
  method: Extract<Connect.Method, { readonly _tag: "Token" }>,
): Extract<Method, { readonly _tag: "Token" }> {
  return Method.Token({
    authenticate: (token) => Effect.runPromise(method.authenticate(token)),
    providerId: method.providerId,
    requiredCapabilities: method.requiredCapabilities,
    token: method.token,
  });
}

export async function start(
  input: Connect.BaseInput & {
    readonly method: Method;
    readonly repository: Repository.Repository;
  },
): Promise<Connect.StartResult> {
  return Effect.runPromise(
    Connect.start({
      authorizedById: input.authorizedById,
      grant: input.grant,
      method: effectMethod(input.method),
      ownerId: input.ownerId,
    }).pipe(
      Effect.provide(Layer.merge(LifecycleRepository.layerFrom(input.repository), webCryptoLayer)),
    ),
  );
}

export async function complete(input: {
  readonly callbackUrl: URL;
  readonly continuationId: string;
  readonly continuations: ContinuationStore;
  readonly flow: InteractiveFlow;
  readonly repository: Repository.Repository;
}): Promise<Repository.Aggregate> {
  return Effect.runPromise(
    Connect.complete({
      callbackUrl: input.callbackUrl,
      continuationId: input.continuationId,
      continuations: effectContinuations(input.continuations),
      flow: effectFlow(input.flow),
    }).pipe(
      Effect.provide(Layer.merge(LifecycleRepository.layerFrom(input.repository), webCryptoLayer)),
    ),
  );
}

/** Extends one owner binding without repeating provider authentication. */
export async function extend(
  input: Connect.ExtendInput & { readonly repository: Repository.Repository },
): Promise<Repository.Aggregate> {
  return Effect.runPromise(
    Connect.extend({
      connectionId: input.connectionId,
      grant: input.grant,
      ownerId: input.ownerId,
    }).pipe(Effect.provide(LifecycleRepository.layerFrom(input.repository))),
  );
}

export { Error, StartResult } from "../auth/connect.ts";
export type { Authentication, ConnectionStartResult, ExtendInput } from "../auth/connection-api.ts";
