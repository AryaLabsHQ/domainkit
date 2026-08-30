import { Context, Effect, Layer } from "effect";

import type { OAuthContinuation } from "../auth/connection.ts";
import { type Error, fromCause } from "./error.ts";

export interface Interface {
  readonly consume: (
    stateHash: string,
    now: Date,
  ) => Effect.Effect<OAuthContinuation | null, Error>;
  readonly put: (continuation: OAuthContinuation) => Effect.Effect<void, Error>;
}

export class Service extends Context.Service<Service, Interface>()("@domainkit/OAuthStateStore") {}

export interface AsyncInterface {
  readonly consume: (stateHash: string, now: Date) => Promise<OAuthContinuation | null>;
  readonly put: (continuation: OAuthContinuation) => Promise<void>;
}

export const toAsync = (store: Interface): AsyncInterface => ({
  consume: (stateHash, now) => Effect.runPromise(store.consume(stateHash, now)),
  put: (continuation) => Effect.runPromise(store.put(continuation)),
});

export const layerFromAsync = (store: AsyncInterface): Layer.Layer<Service> =>
  Layer.succeed(Service, {
    consume: Effect.fn("OAuthStateStore.consume")((stateHash, now) =>
      Effect.tryPromise({
        try: () => store.consume(stateHash, now),
        catch: (cause) => fromCause("oauthState.consume", cause),
      }),
    ),
    put: Effect.fn("OAuthStateStore.put")((continuation) =>
      Effect.tryPromise({
        try: () => store.put(continuation),
        catch: (cause) => fromCause("oauthState.put", cause),
      }),
    ),
  });
