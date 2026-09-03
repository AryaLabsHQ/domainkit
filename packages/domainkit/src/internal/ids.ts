import { Effect } from "effect";

/** A fresh, prefixed, URL-safe identifier (`prefix_<uuid>`). */
export const fresh = (prefix: string): Effect.Effect<string> =>
  Effect.sync(() => `${prefix}_${crypto.randomUUID()}`);
