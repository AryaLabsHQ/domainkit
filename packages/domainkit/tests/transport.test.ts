import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import * as DnsRecord from "../src/domain/dns-record.ts";
import * as Transport from "../src/transport.ts";

const provider: Transport.Provider = {
  authentication: [{ _tag: "OAuth", label: "Continue with Cloudflare" }],
  id: "cloudflare",
  name: "Cloudflare",
};

describe("application transport", () => {
  it("constructs connection methods without hand-authored tags", () => {
    assert.deepStrictEqual(Transport.Method.OAuth(), { _tag: "OAuth" });
    assert.deepStrictEqual(
      Transport.Method.Token({ parameters: { accountId: "account-1" }, token: "secret" }),
      {
        _tag: "Token",
        parameters: { accountId: "account-1" },
        token: "secret",
      },
    );
  });

  it("decodes serialized connection snapshots through the canonical schema", () => {
    assert.deepStrictEqual(
      Schema.decodeUnknownSync(Transport.ConnectionSnapshot)({
        _tag: "Disconnected",
        domain: "example.com",
        provider,
      }),
      {
        _tag: "Disconnected",
        domain: "example.com",
        provider,
      },
    );
  });

  it("projects operational DNS requirements for application review", () => {
    const requirement = DnsRecord.parse({
      _tag: "MX",
      exchange: "feedback-smtp.us-east-1.amazonses.com",
      metadata: { ownership: "app", provenance: "test", purpose: "mail" },
      name: "mail.example.com",
      policy: "append",
      priority: 10,
      ttl: 300,
    });

    assert.deepStrictEqual(Transport.fromDnsRecord("mx-1", requirement), {
      id: "mx-1",
      name: "mail.example.com",
      priority: 10,
      type: "MX",
      value: "feedback-smtp.us-east-1.amazonses.com",
    });
  });

  it.effect("lifts an async host implementation into the Effect service", () => {
    const layer = Transport.layerFromAsync({
      cleanup: {
        apply: async () => ({ _tag: "Cleaned", operationId: "cleanup-1", results: [] }),
        plan: async () => ({
          _tag: "CleanupPlan",
          digest: "cleanup-digest",
          expiresAt: "2026-08-30T00:15:00.000Z",
          operations: [],
        }),
      },
      connection: {
        connect: async (input) => ({
          _tag: "Connected",
          connectionId: "connection-1",
          domain: input.domain,
          provider,
        }),
        inspect: async (input) => ({ _tag: "Unsupported", domain: input.domain }),
        removeDomain: async (input) => ({
          _tag: "Removed",
          connectionId: input.connectionId,
          domain: input.domain,
          remainingDomainCount: 0,
        }),
        reuse: async (input) => ({
          _tag: "Connected",
          connectionId: input.connectionId,
          domain: input.domain,
          provider,
        }),
      },
      provisioning: {
        apply: async () => ({
          _tag: "Applied",
          operationId: "apply-1",
          receiptId: "receipt-1",
          results: [],
        }),
        plan: async () => ({
          _tag: "Plan",
          digest: "plan-digest",
          expiresAt: "2026-08-30T00:15:00.000Z",
          operations: [],
        }),
      },
      verification: {
        observe: async () => ({ _tag: "Observation", provider: [], publicDns: [] }),
      },
    });

    return Effect.gen(function* () {
      const transport = yield* Transport.Service;
      const result = yield* transport.connection.connect({
        domain: "example.com",
        method: Transport.Method.OAuth(),
        providerId: "cloudflare",
      });
      assert.strictEqual(result._tag, "Connected");
      if (result._tag === "Connected") assert.strictEqual(result.connectionId, "connection-1");
    }).pipe(Effect.provide(layer));
  });

  it.effect("maps rejected async requests into a typed failure", () => {
    const failure = new Transport.Failure({
      message: "authorization expired",
      operation: "connection.inspect",
      retry: "after-user-action",
    });
    const transport = Transport.fromAsync({
      cleanup: {
        apply: async () => Promise.reject(failure),
        plan: async () => Promise.reject(failure),
      },
      connection: {
        connect: async () => Promise.reject(failure),
        inspect: async () => Promise.reject(failure),
        removeDomain: async () => Promise.reject(failure),
        reuse: async () => Promise.reject(failure),
      },
      provisioning: {
        apply: async () => Promise.reject(failure),
        plan: async () => Promise.reject(failure),
      },
      verification: { observe: async () => Promise.reject(failure) },
    });

    return Effect.gen(function* () {
      const result = yield* transport.connection
        .inspect({ domain: "example.com" })
        .pipe(Effect.result);
      assert.strictEqual(result._tag, "Failure");
      if (result._tag === "Failure") assert.strictEqual(result.failure, failure);
    });
  });
});
