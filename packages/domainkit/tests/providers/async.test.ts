import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  Cleanup,
  Connect,
  DnsRecord,
  DomainKit,
  Principal,
  Provider,
  Provision,
  Reason,
} from "../../src/index.ts";
import { Testing } from "../../src/entry/testing.ts";

const zone = "example.com";

/** A Promise-shaped provider over one in-memory zone, the way a non-Effect integration is written. */
const makeAsyncProvider = (options: { readonly failList?: boolean } = {}) => {
  const rows = new Map<string, DnsRecord.Observed>();
  let next = 1;
  const target: Provider.Target = { zone, context: { kind: "zone", zone }, label: zone };
  const definition = Provider.fromAsync({
    id: "async-dns",
    name: "Async DNS",
    context: Schema.Struct({ kind: Schema.String, zone: Schema.optionalKey(Schema.String) }),
    contextVersion: "async.v1",
    auth: {
      token: {
        label: "API key",
        requiredCapabilities: ["dns:read", "dns:write"],
        fields: Schema.Struct({ token: Schema.RedactedFromValue(Schema.String) }),
        authenticate: async (values) => {
          if (values.token !== "good") throw new Error("bad key");
          return { secret: values.token, context: { kind: "account" }, expiresAt: null };
        },
      },
    },
    session: () => ({
      capabilities: async () => ["dns:read", "dns:write"],
      listTargets: async () => [target],
      resolveTarget: async (domain) =>
        domain.endsWith(zone)
          ? Provider.Resolution.Resolved({ target })
          : Provider.Resolution.NotFound(),
      dns: () => ({
        list: async () => {
          if (options.failList === true) throw new Error("listing exploded");
          return [...rows].map(([providerRecordId, record]) => ({ record, providerRecordId }));
        },
        create: async (_zone, record) => {
          const providerRecordId = `r${next++}`;
          rows.set(providerRecordId, record);
          return { providerRecordId };
        },
        get: async (_zone, id) => rows.get(id) ?? null,
        delete: async (_zone, id) => {
          if (!rows.delete(id)) {
            throw new DomainKit.Error({
              reason: new Reason.NotFound({ entity: "record", id }),
            });
          }
        },
      }),
    }),
  });
  return { definition, rows };
};

const withPrincipal = Effect.provideService(Principal.Service, Testing.principal);

describe("Provider.fromAsync", () => {
  it.effect("runs the lifecycle over a Promise-shaped provider", () => {
    const { definition, rows } = makeAsyncProvider();
    return Effect.gen(function* () {
      const bad = yield* Connect.start({
        provider: "async-dns",
        method: Connect.Method.token("nope"),
        domain: "app.example.com",
      }).pipe(Effect.flip);
      assert.strictEqual(bad.reason._tag, "ProviderUnavailable");
      const started = yield* Connect.start({
        provider: "async-dns",
        method: Connect.Method.token("good"),
        domain: "app.example.com",
      });
      assert.strictEqual(started._tag, "Connected");
      const plan = yield* Provision.plan({
        domain: "app.example.com",
        requirements: [DnsRecord.txt({ name: "app.example.com", value: "v" })],
      });
      const receipt = yield* Provision.apply(yield* Provision.approve(plan));
      assert.strictEqual(receipt.status, "complete");
      assert.strictEqual(rows.size, 1);
      const cleanup = yield* Cleanup.plan({ receiptId: receipt.id });
      yield* Cleanup.apply(yield* Cleanup.approve(cleanup));
      assert.strictEqual(rows.size, 0);
      const missing = yield* Cleanup.plan({ receiptId: receipt.id });
      assert.strictEqual(missing.operations[0]?._tag, "Conflict");
    }).pipe(
      withPrincipal,
      Effect.provide(
        DomainKit.layerMemory({ providers: [definition], resolver: Testing.resolver([]) }),
      ),
    );
  });

  it.effect("maps rejections to DomainKit.Error and passes thrown ones through", () => {
    const { definition } = makeAsyncProvider({ failList: true });
    return Effect.gen(function* () {
      yield* Connect.start({
        provider: "async-dns",
        method: Connect.Method.token("good"),
        domain: "app.example.com",
      });
      const exploded = yield* Provision.plan({
        domain: "app.example.com",
        requirements: [DnsRecord.txt({ name: "app.example.com", value: "v" })],
      }).pipe(Effect.flip);
      assert.strictEqual(exploded.reason._tag, "ProviderUnavailable");
      assert.match(exploded.message, /listing exploded/);
    }).pipe(
      withPrincipal,
      Effect.provide(
        DomainKit.layerMemory({ providers: [definition], resolver: Testing.resolver([]) }),
      ),
    );
  });
});
