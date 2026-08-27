import { Crypto, Effect, Layer, PlatformError, Schema } from "effect";

export class CryptoError extends Schema.TaggedError<CryptoError>()("CryptoError", {
  message: Schema.String,
}) {}

export type Json =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<Json>
  | { readonly [key: string]: Json };

/** Deterministic JSON serialization for already schema-encoded protocol values. */
export function stringify(value: Json): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError("Value is not representable as JSON");
    return encoded;
  }
  if (isJsonArray(value)) return `[${value.map(stringify).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stringify(entry)}`)
    .join(",")}}`;
}

function isJsonArray(value: Json): value is ReadonlyArray<Json> {
  return Array.isArray(value);
}

export const sha256Text = Effect.fn("Digest.sha256Text")(function* (value: string) {
  const cryptoService = yield* Crypto.Crypto;
  const digest = yield* cryptoService
    .digest("SHA-256", new TextEncoder().encode(value))
    .pipe(Effect.mapError((cause) => new CryptoError({ message: cause.message })));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
});

export const sha256Json = Effect.fn("Digest.sha256Json")((value: Json) =>
  Effect.try({
    try: () => stringify(value),
    catch: (cause) =>
      new CryptoError({ message: cause instanceof Error ? cause.message : String(cause) }),
  }).pipe(Effect.flatMap(sha256Text)),
);

function sha256EncodedProgram<S extends Schema.Constraint>(
  schema: S,
  value: S["Type"],
): Effect.Effect<string, CryptoError, Crypto.Crypto | S["EncodingServices"]> {
  return Schema.encodeEffect(schema)(value).pipe(
    Effect.mapError((cause) => new CryptoError({ message: cause.message })),
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
    Effect.mapError((cause) => new CryptoError({ message: cause.message })),
    Effect.flatMap(sha256Json),
  );
}

export const sha256Encoded = Effect.fn("Digest.sha256Encoded")(sha256EncodedProgram);

/** Portable Web Crypto implementation for hosts that want a ready-made Layer. */
export const webCryptoLayer: Layer.Layer<Crypto.Crypto> = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => crypto.getRandomValues(new Uint8Array(size)),
    digest: (algorithm, data) =>
      Effect.tryPromise({
        try: async () => {
          const bytes = new Uint8Array(data.byteLength);
          bytes.set(data);
          return new Uint8Array(await crypto.subtle.digest(algorithm, bytes.buffer));
        },
        catch: (cause) =>
          PlatformError.systemError({
            _tag: "Unknown",
            module: "WebCrypto",
            method: "digest",
            cause,
          }),
      }),
  }),
);
