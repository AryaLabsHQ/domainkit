import { Effect, Layer } from "effect";

import type * as Connection from "../auth/connection.ts";
import * as OAuthStateStore from "./oauth-state.ts";

export function make(): OAuthStateStore.Interface {
  const continuations = new Map<string, Connection.OAuthContinuation>();
  return {
    put: Effect.fn("InMemoryOAuthStateStore.put")((continuation) =>
      Effect.sync(() => void continuations.set(continuation.stateHash, continuation)),
    ),
    consume: Effect.fn("InMemoryOAuthStateStore.consume")((stateHash, now) =>
      Effect.sync(() => {
        const continuation = continuations.get(stateHash) ?? null;
        if (continuation === null) return null;
        continuations.delete(stateHash);
        return continuation.expiresAt > now ? continuation : null;
      }),
    ),
  };
}

export const layer = (): Layer.Layer<OAuthStateStore.Service> =>
  Layer.succeed(OAuthStateStore.Service, make());

export const toAsync = (
  store: OAuthStateStore.Interface = make(),
): OAuthStateStore.AsyncInterface => OAuthStateStore.toAsync(store);
