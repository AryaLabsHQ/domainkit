import { assert, describe, it } from "@effect/vitest";
import { Config, ConfigProvider, Effect, Redacted } from "effect";

import { Custody } from "../../src/index.ts";

const key = Redacted.make(Custody.generateKey());

describe("Custody", () => {
  it.effect("round-trips a secret through a versioned envelope", () =>
    Effect.gen(function* () {
      const custody = yield* Custody.Service;
      const sealed = yield* custody.seal(Redacted.make("token-1"));
      assert.match(sealed, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      assert.ok(!sealed.includes("token-1"));
      const again = yield* custody.seal(Redacted.make("token-1"));
      assert.notStrictEqual(sealed, again);
      const opened = yield* custody.open(sealed);
      assert.strictEqual(Redacted.value(opened), "token-1");
    }).pipe(Effect.provide(Custody.layer({ key }))),
  );

  it.effect("fails typed when the key does not match or the envelope is malformed", () =>
    Effect.gen(function* () {
      const first = yield* Custody.make({ key });
      const second = yield* Custody.make({ key: Redacted.make(Custody.generateKey()) });
      const sealed = yield* first.seal(Redacted.make("secret"));
      const mismatch = yield* second.open(sealed).pipe(Effect.flip);
      assert.strictEqual(mismatch.reason._tag, "CryptoFailed");
      if (mismatch.reason._tag === "CryptoFailed")
        assert.strictEqual(mismatch.reason.operation, "open");
      const malformed = yield* first.open("v0.nope").pipe(Effect.flip);
      assert.strictEqual(malformed.reason._tag, "CryptoFailed");
    }),
  );

  it.effect("accepts hex keys and rejects short ones", () =>
    Effect.gen(function* () {
      const hex = yield* Custody.make({ key: Redacted.make("00".repeat(32)) });
      const opened = yield* hex.open(yield* hex.seal(Redacted.make("x")));
      assert.strictEqual(Redacted.value(opened), "x");
      const short = yield* Custody.make({ key: Redacted.make("dG9vLXNob3J0") }).pipe(Effect.flip);
      assert.strictEqual(short.reason._tag, "InvalidInput");
    }),
  );

  it.effect("reads DOMAINKIT_CUSTODY_KEY through layerConfig", () =>
    Effect.gen(function* () {
      const custody = yield* Custody.Service;
      const opened = yield* custody.open(yield* custody.seal(Redacted.make("env")));
      assert.strictEqual(Redacted.value(opened), "env");
    }).pipe(
      Effect.provide(Custody.layerConfig()),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown({ DOMAINKIT_CUSTODY_KEY: Redacted.value(key) }),
      ),
    ),
  );

  it.effect("adapts a Promise-shaped KMS", () =>
    Effect.gen(function* () {
      const custody = yield* Custody.Service;
      assert.strictEqual(yield* custody.seal(Redacted.make("a")), "sealed:a");
      assert.strictEqual(Redacted.value(yield* custody.open("sealed:a")), "a");
      const failure = yield* custody.open("bad").pipe(Effect.flip);
      assert.strictEqual(failure.reason._tag, "CryptoFailed");
    }).pipe(
      Effect.provide(
        Custody.layerFromAsync({
          seal: async (plaintext) => `sealed:${plaintext}`,
          open: async (ciphertext) => {
            if (!ciphertext.startsWith("sealed:")) throw new Error("kms denied");
            return ciphertext.slice("sealed:".length);
          },
        }),
      ),
    ),
  );

  it("exposes Config.redacted as the key option", () => {
    assert.ok(Config.isConfig(Config.redacted("X")));
  });
});
