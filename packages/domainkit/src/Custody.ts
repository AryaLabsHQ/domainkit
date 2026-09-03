/**
 * Seals provider credentials before Storage writes them. The default is AES-256-GCM through
 * WebCrypto from one configured key; hosts with a KMS provide their own. There is no plaintext
 * mode.
 *
 * Envelope format: `v1.<iv>.<ciphertext>` with base64url segments and a 12-byte IV. Rotating
 * the key requires re-sealing stored credentials; `open` fails with `CryptoFailed` on a mismatch.
 */
import { Config, Context, Effect, Layer, Redacted } from "effect";

import * as Errors from "./internal/error.ts";
import * as Reason from "./Reason.ts";
import * as Aes from "./internal/aes.ts";

export interface Interface {
  readonly seal: (
    plaintext: Redacted.Redacted<string>,
  ) => Effect.Effect<string, Errors.DomainKitError>;
  readonly open: (
    ciphertext: string,
  ) => Effect.Effect<Redacted.Redacted<string>, Errors.DomainKitError>;
}

export class Service extends Context.Service<Service, Interface>()("@domainkit/Custody") {}

export interface Options {
  /** 32 bytes, base64 or hex. Rotating it requires re-sealing stored credentials. */
  readonly key: Redacted.Redacted<string>;
}

export const make = (options: Options): Effect.Effect<Interface, Errors.DomainKitError> =>
  Effect.gen(function* () {
    const raw = Aes.decodeKey(Redacted.value(options.key));
    if (raw === null) {
      return yield* Errors.fail(
        new Reason.InvalidInput({
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

export const layer = (options: Options): Layer.Layer<Service, Errors.DomainKitError> =>
  Layer.effect(Service)(make(options));

/** Same options, each field a `Config`. Defaults to `DOMAINKIT_CUSTODY_KEY`. */
export const layerConfig = (
  options: { readonly key?: Config.Config<Redacted.Redacted<string>> } = {},
): Layer.Layer<Service, Errors.DomainKitError> =>
  Layer.effect(Service)(
    Effect.gen(function* () {
      const key = yield* (options.key ?? Config.redacted("DOMAINKIT_CUSTODY_KEY")).pipe(
        Effect.mapError(
          (cause) =>
            new Errors.DomainKitError({
              reason: new Reason.InvalidInput({ message: cause.message, field: "key" }),
            }),
        ),
      );
      return yield* make({ key });
    }),
  );

/** A fresh random key in the accepted encoding; for tests, playgrounds, and first-time setup. */
export const generateKey = Aes.generateKey;

export interface AsyncInterface {
  readonly seal: (plaintext: string) => Promise<string>;
  readonly open: (ciphertext: string) => Promise<string>;
}

const cryptoFailed = (operation: "seal" | "open") => (cause: unknown) =>
  Errors.isDomainKitError(cause)
    ? cause
    : new Errors.DomainKitError({ reason: new Reason.CryptoFailed({ operation }) });

/** Wrap a Promise-shaped KMS client; rejections become `CryptoFailed`. */
export const fromAsync = (service: AsyncInterface): Interface => ({
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

export const layerFromAsync = (service: AsyncInterface): Layer.Layer<Service> =>
  Layer.succeed(Service)(fromAsync(service));
