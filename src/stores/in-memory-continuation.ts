import { Effect, Ref } from "effect";

import type * as Connection from "../auth/connect.ts";

export function make(): Connection.ContinuationStore {
  const state = Effect.runSync(Ref.make<ReadonlyMap<string, Connection.Continuation>>(new Map()));
  return {
    consume: Effect.fn("ConnectionContinuations.consume")(function* (id, now) {
      const entries = yield* Ref.get(state);
      const continuation = entries.get(id);
      if (continuation === undefined || continuation.expiresAt <= now) {
        yield* Ref.update(state, (current) => {
          const next = new Map(current);
          next.delete(id);
          return next;
        });
        return null;
      }
      yield* Ref.update(state, (current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
      return continuation;
    }),
    put: Effect.fn("ConnectionContinuations.put")((continuation) =>
      Ref.update(state, (entries) => {
        const next = new Map(entries);
        next.set(continuation.id, continuation);
        return next;
      }),
    ),
  };
}
