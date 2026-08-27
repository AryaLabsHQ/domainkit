import { Crypto, Effect, Layer, PlatformError } from "effect";

import { CryptoError } from "../errors.ts";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256(value: unknown): Effect.Effect<string, CryptoError, Crypto.Crypto> {
  return Effect.gen(function* () {
    const cryptoService = yield* Crypto.Crypto;
    const bytes = new TextEncoder().encode(canonicalJson(value));
    const digest = yield* cryptoService
      .digest("SHA-256", bytes)
      .pipe(Effect.mapError((cause) => new CryptoError({ message: cause.message })));
    return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  });
}

/** Portable Web Crypto implementation used by the Promise facade. */
export const webCryptoLayer: Layer.Layer<Crypto.Crypto> = Layer.succeed(Crypto.Crypto)(
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

/** @internal Temporary foreign-Promise bridge while OAuth is migrated to Effect. */
export function sha256Promise(value: unknown): Promise<string> {
  return Effect.runPromise(sha256(value).pipe(Effect.provide(webCryptoLayer)));
}
