import { Effect, Schema } from "effect";

import * as Errors from "./error.ts";
import * as Reason from "../Reason.ts";

export type Json =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<Json>
  | { readonly [key: string]: Json };

/** Deterministic JSON serialization for already schema-encoded protocol values. */
export function stringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError("Value is not representable as JSON");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(stringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stringify(entry)}`)
    .join(",")}}`;
}

const cryptoFailed = () =>
  new Errors.DomainKitError({
    reason: new Reason.CryptoFailed({ operation: "digest" }),
  });

export const sha256Hex = (value: string): Effect.Effect<string, Errors.DomainKitError> =>
  Effect.tryPromise({
    try: async () => {
      const bytes = new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
      );
      return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    },
    catch: cryptoFailed,
  });

/** Digest of the canonical JSON encoding of `value` under `schema`. */
export const sha256Encoded = <S extends Schema.ConstraintEncoder<unknown>>(
  schema: S,
  value: S["Type"],
): Effect.Effect<string, Errors.DomainKitError> =>
  Effect.try({
    try: () => stringify(Schema.encodeSync(schema)(value)),
    catch: cryptoFailed,
  }).pipe(Effect.flatMap(sha256Hex));
