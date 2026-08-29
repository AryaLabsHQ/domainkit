import { Effect, Ref } from "effect";

import type * as Connection from "../auth/connect.ts";

export function make(): Connection.ContinuationStore {
  const state = Effect.runSync(Ref.make<ReadonlyMap<string, Connection.Continuation>>(new Map()));
  return {
    consume: Effect.fn("ConnectionContinuations.consume")(function* (id, now) {
      return yield* Ref.modify(state, (entries) => {
        const continuation = entries.get(id);
        const next = new Map(entries);
        next.delete(id);
        return [
          continuation !== undefined && continuation.expiresAt > now ? continuation : null,
          next,
        ] as const;
      });
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
