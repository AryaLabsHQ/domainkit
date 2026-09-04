import { assert, describe, it } from "@effect/vitest";
import { Effect, Redacted, Schema } from "effect";

import { DomainKit, Provider, Providers, Reason } from "../../src/index.ts";
import * as Errors from "../../src/internal/error.ts";
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

/** Every method one provider can declare, so the descriptor order has something to order. */
const everyMethod = Provider.make({
  ...tokenOnly,
  auth: {
    ...tokenOnly.auth,
    integration: {
      label: "Install the app",
      start: () => Effect.succeed({ authorizationUrl: "https://porkbun.test/install" }),
      complete: () =>
        Effect.succeed({
          secret: Redacted.make("installed"),
          context: { apiKey: "pk" },
          expiresAt: null,
        }),
    },
    oauth: {
      label: "Sign in with Porkbun",
      scopes: ["dns"],
      start: () => Effect.succeed({ authorizationUrl: "https://porkbun.test/auth" }),
      complete: () =>
        Effect.succeed({
          secret: Redacted.make("granted"),
          context: { apiKey: "pk" },
          expiresAt: null,
        }),
      refresh: () =>
        Effect.succeed({
          secret: Redacted.make("renewed"),
          context: { apiKey: "pk" },
          expiresAt: null,
        }),
    },
  },
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
    assert.ok(DomainKit.isError(caught));
    assert.strictEqual(caught.reason._tag, "InvalidInput");
    assert.throws(() => Provider.make({ ...tokenOnly, id: "Bad Id" }));
  });

  it("describes the interactive methods before the token a customer has to go and fetch", () => {
    assert.deepStrictEqual(Provider.methods(everyMethod), ["oauth", "integration", "token"]);
    assert.deepStrictEqual(
      Provider.describeMethods(everyMethod).map((method) => method.kind),
      ["oauth", "integration", "token"],
    );
  });

  it.effect("resolves registered providers and rejects unknown or duplicate ids", () =>
    Effect.gen(function* () {
      const registry = yield* Providers.Service;
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
            : Errors.fail(
                new Reason.Unsupported({
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
