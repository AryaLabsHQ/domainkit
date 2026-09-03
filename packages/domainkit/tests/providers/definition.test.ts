import { assert, describe, it } from "@effect/vitest";
import { Effect, Redacted, Schema } from "effect";

import { DomainKitError, Provider, Providers } from "../../src/index.ts";
import { bail } from "./recorded-fetch.ts";

const session = (): Provider.Session => ({
  capabilities: () => Effect.succeed(["dns:read"]),
  listTargets: () => Effect.succeed([]),
  resolveTarget: () => Effect.succeed(Provider.Resolution.NotFound()),
  dns: () => ({
    list: () => Effect.succeed([]),
    create: () => Effect.succeed({ providerRecordId: "pb-1" }),
    get: () => Effect.succeed(null),
    delete: () => Effect.void,
  }),
});

const tokenOnly = Provider.make({
  id: "porkbun",
  name: "Porkbun",
  context: Schema.Struct({ apiKey: Schema.String }),
  contextVersion: "porkbun.v1",
  auth: {
    token: Provider.tokenAuth({
      label: "API key",
      requiredCapabilities: ["dns:read", "dns:write"],
      fields: Schema.Struct({
        token: Schema.RedactedFromValue(Schema.String),
        region: Schema.optionalKey(Schema.String),
      }),
      authenticate: ({ token, region }) =>
        Effect.succeed({ secret: token, context: { apiKey: region ?? "pk" }, expiresAt: null }),
    }),
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
      const envelope = yield* Provider.encodeContext(tokenOnly, { apiKey: "k" });
      assert.deepStrictEqual(envelope, { version: "porkbun.v1", value: { apiKey: "k" } });
      const context = yield* Provider.decodeContext(tokenOnly, envelope);
      assert.deepStrictEqual(context, { apiKey: "k" });
      const invalid = yield* Provider.decodeContext(tokenOnly, { apiKey: "k" }).pipe(Effect.flip);
      assert.strictEqual(invalid.reason._tag, "InvalidInput");
      const older = yield* Provider.decodeContext(tokenOnly, {
        version: "porkbun.v0",
        value: {},
      }).pipe(Effect.flip);
      assert.strictEqual(older.reason._tag, "Unsupported");
      const migrating = Provider.make({
        ...tokenOnly,
        migrateContext: (stored) =>
          stored.version === "porkbun.v0"
            ? Effect.succeed({ apiKey: String((stored.value as { key?: string }).key ?? "") })
            : DomainKitError.fail(
                new DomainKitError.Unsupported({
                  provider: "porkbun",
                  operation: "context",
                  message: "no",
                }),
              ),
      });
      const migrated = yield* Provider.decodeContext(migrating, {
        version: "porkbun.v0",
        value: { key: "legacy" },
      });
      assert.deepStrictEqual(migrated, { apiKey: "legacy" });
      assert.throws(() => Provider.make({ ...tokenOnly, contextVersion: "" }));
      const issued = yield* (tokenOnly.auth.token ?? bail("token")).authenticate({
        token: Redacted.make("t"),
      });
      assert.strictEqual(Redacted.value(issued.secret), "t");
      assert.deepStrictEqual(Provider.describeMethods(tokenOnly), [
        {
          kind: "token",
          label: "API key",
          docsUrl: null,
          fields: [
            { name: "token", required: true, secret: true },
            { name: "region", required: false, secret: false },
          ],
        },
      ]);
      const noToken = yield* (tokenOnly.auth.token ?? bail("token"))
        .authenticate({ region: Redacted.make("eu") })
        .pipe(Effect.flip);
      assert.strictEqual(noToken.reason._tag, "InvalidInput");
    }).pipe(Effect.provide(Providers.layer([tokenOnly]))),
  );
});
