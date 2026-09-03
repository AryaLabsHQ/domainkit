import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { DomainKitError, DomainName } from "../../src/index.ts";

describe("DomainName", () => {
  it("normalizes case, trailing dots, and IDN labels", () => {
    assert.deepStrictEqual(DomainName.fromString("Example.COM."), Option.some("example.com"));
    assert.deepStrictEqual(
      DomainName.fromString("bücher.example"),
      Option.some("xn--bcher-kva.example"),
    );
    assert.deepStrictEqual(
      DomainName.fromString("_dmarc.Example.com"),
      Option.some("_dmarc.example.com"),
    );
  });

  it("rejects values that are not hostnames", () => {
    assert.deepStrictEqual(DomainName.fromString("localhost"), Option.none());
    assert.deepStrictEqual(DomainName.fromString("bad host.example"), Option.none());
    assert.strictEqual(DomainName.isDomainName("Example.com"), false);
    assert.strictEqual(DomainName.isDomainName("example.com"), true);
  });

  it("throws a DomainKitError with reason InvalidInput from fromStringUnsafe", () => {
    let caught: unknown;
    try {
      DomainName.fromStringUnsafe("nope");
    } catch (cause) {
      caught = cause;
    }
    assert.ok(DomainKitError.isDomainKitError(caught));
    assert.strictEqual(caught.reason._tag, "InvalidInput");
    assert.strictEqual(
      caught.reason._tag === "InvalidInput" ? caught.reason.field : undefined,
      "domain",
    );
  });

  it.effect("decodes and encodes through the schema codec", () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(DomainName.DomainName)(
        "Track.Example.com.",
      );
      assert.strictEqual(decoded, "track.example.com");
      assert.strictEqual(Schema.encodeSync(DomainName.DomainName)(decoded), "track.example.com");
      const failure = yield* DomainName.decode("bad host", "zone").pipe(Effect.flip);
      assert.strictEqual(failure.reason._tag, "InvalidInput");
    }),
  );

  it("lists zone candidates from the name down to the registrable domain", () => {
    const candidates = (input: string): ReadonlyArray<string> =>
      DomainName.candidates(DomainName.fromStringUnsafe(input));
    assert.deepStrictEqual(candidates("a.b.example.com"), [
      "a.b.example.com",
      "b.example.com",
      "example.com",
    ]);
    assert.deepStrictEqual(candidates("example.co.uk"), ["example.co.uk"]);
    assert.deepStrictEqual(candidates("app.github.io"), ["app.github.io"]);
  });
});
