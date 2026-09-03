import { assert, describe, it } from "@effect/vitest";
import { Effect, Redacted, Schema } from "effect";

import { DomainKitError, Provider, Providers } from "../../src/index.ts";
import { bail } from "./recorded-fetch.ts";

const session = (): Provider.Session => ({
  capabilities: () => Effect.succeed(["dns:read"]),
  listTargets: () => Effect.succeed([]),
  resolveTarget: () => Effect.succeed({ _tag: "NotFound" }),
  dns: () => ({
    list: () => Effect.succeed([]),
    create: () => Effect.succeed({ providerRecordId: null }),
    get: () => Effect.succeed(null),
    delete: () => Effect.void,
  }),
});

const tokenOnly = Provider.make({
  id: "porkbun",
  name: "Porkbun",
  context: Schema.Struct({ apiKey: Schema.String }),
  auth: {
    token: {
      label: "API key",
      requiredCapabilities: ["dns:read", "dns:write"],
      authenticate: (token) =>
        Effect.succeed({ secret: token, context: { apiKey: "pk" }, expiresAt: null }),
    },
  },
  session,
});

describe("Provider.make and Providers", () => {
  it("validates definitions and reports their methods", () => {
    assert.deepStrictEqual(Provider.methods(tokenOnly), ["token"]);
    let caught: unknown;
    try {
      Provider.make({ ...tokenOnly, auth: {} });
    } catch (error) {
      caught = error;
    }
    assert.ok(DomainKitError.isDomainKitError(caught));
    assert.strictEqual(caught.reason._tag, "InvalidInput");
    assert.throws(() => Provider.make({ ...tokenOnly, id: "Bad Id" }));
  });

  it.effect("resolves registered providers and rejects unknown or duplicate ids", () =>
    Effect.gen(function* () {
      const registry = yield* Providers.Providers;
      const found = yield* registry.get("porkbun");
      assert.strictEqual(found.name, "Porkbun");
      assert.deepStrictEqual(
        registry.list().map(({ id }) => id),
        ["porkbun"],
      );
      assert.deepStrictEqual(yield* registry.methods("porkbun"), ["token"]);
      const missing = yield* registry.get("nope").pipe(Effect.flip);
      assert.strictEqual(missing.reason._tag, "NotFound");
      assert.throws(() => Providers.make([tokenOnly, tokenOnly]));
      const context = yield* Provider.decodeContext(tokenOnly, { apiKey: "k" });
      assert.deepStrictEqual(context, { apiKey: "k" });
      const invalid = yield* Provider.decodeContext(tokenOnly, {}).pipe(Effect.flip);
      assert.strictEqual(invalid.reason._tag, "InvalidInput");
      const issued = yield* (tokenOnly.auth.token ?? bail("token")).authenticate(
        Redacted.make("t"),
      );
      assert.strictEqual(Redacted.value(issued.secret), "t");
    }).pipe(Effect.provide(Providers.layer([tokenOnly]))),
  );
});
