/**
 * Seals provider credentials before Storage writes them. The default is AES-256-GCM through
 * WebCrypto from one configured key; hosts with a KMS provide their own. There is no plaintext
 * mode.
 *
 * Envelope format: `v1.<iv>.<ciphertext>` with base64url segments and a 12-byte IV. Rotating
 * the key requires re-sealing stored credentials; `open` fails with `CryptoFailed` on a mismatch.
 */
import { Config, Context, Effect, Layer, Redacted } from "effect";

import * as DomainKitError from "./DomainKitError.ts";
import * as Aes from "./internal/aes.ts";

export interface Service {
  readonly seal: (
    plaintext: Redacted.Redacted<string>,
  ) => Effect.Effect<string, DomainKitError.DomainKitError>;
  readonly open: (
    ciphertext: string,
  ) => Effect.Effect<Redacted.Redacted<string>, DomainKitError.DomainKitError>;
}

export class Custody extends Context.Service<Custody, Service>()("@domainkit/Custody") {}

export interface Options {
  /** 32 bytes, base64 or hex. Rotating it requires re-sealing stored credentials. */
  readonly key: Redacted.Redacted<string>;
}

export const make = (options: Options): Effect.Effect<Service, DomainKitError.DomainKitError> =>
  Effect.gen(function* () {
    const raw = Aes.decodeKey(Redacted.value(options.key));
    if (raw === null) {
      return yield* DomainKitError.fail(
        new DomainKitError.InvalidInput({
          message: "Custody key must be 32 bytes encoded as base64 or hex",
          field: "key",
        }),
      );
    }
    const key = yield* Aes.importKey(raw);
    return {
      seal: (plaintext) => Aes.seal(key, plaintext),
      open: (ciphertext) => Aes.open(key, ciphertext),
    };
  });

export const layer = (options: Options): Layer.Layer<Custody, DomainKitError.DomainKitError> =>
  Layer.effect(Custody)(make(options));

/** Same options, each field a `Config`. Defaults to `DOMAINKIT_CUSTODY_KEY`. */
export const layerConfig = (
  options: { readonly key?: Config.Config<Redacted.Redacted<string>> } = {},
): Layer.Layer<Custody, DomainKitError.DomainKitError> =>
  Layer.effect(Custody)(
    Effect.gen(function* () {
      const key = yield* (options.key ?? Config.redacted("DOMAINKIT_CUSTODY_KEY")).pipe(
        Effect.mapError(
          (cause) =>
            new DomainKitError.DomainKitError({
              reason: new DomainKitError.InvalidInput({ message: cause.message, field: "key" }),
            }),
        ),
      );
      return yield* make({ key });
    }),
  );

/** A fresh random key in the accepted encoding; for tests, playgrounds, and first-time setup. */
export const generateKey = Aes.generateKey;

export interface AsyncService {
  readonly seal: (plaintext: string) => Promise<string>;
  readonly open: (ciphertext: string) => Promise<string>;
}

const cryptoFailed = (operation: "seal" | "open") => (cause: unknown) =>
  DomainKitError.isDomainKitError(cause)
    ? cause
    : new DomainKitError.DomainKitError({ reason: new DomainKitError.CryptoFailed({ operation }) });

/** Wrap a Promise-shaped KMS client; rejections become `CryptoFailed`. */
export const fromAsync = (service: AsyncService): Service => ({
  seal: (plaintext) =>
    Effect.tryPromise({
      try: () => service.seal(Redacted.value(plaintext)),
      catch: cryptoFailed("seal"),
    }),
  open: (ciphertext) =>
    Effect.tryPromise({ try: () => service.open(ciphertext), catch: cryptoFailed("open") }).pipe(
      Effect.map((value) => Redacted.make(value)),
    ),
});

export const layerFromAsync = (service: AsyncService): Layer.Layer<Custody> =>
  Layer.succeed(Custody)(fromAsync(service));
