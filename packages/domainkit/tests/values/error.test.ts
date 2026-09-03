import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { DomainKit, Plan, Reason } from "../../src/index.ts";
import * as Errors from "../../src/internal/error.ts";

const reasons: ReadonlyArray<Reason.Model> = [
  new Reason.InvalidInput({ message: "bad", field: "domain" }),
  new Reason.Unauthenticated({ message: "who" }),
  new Reason.Forbidden({ message: "no" }),
  new Reason.NotFound({ entity: "plan", id: "p1" }),
  new Reason.Conflict({ planId: Plan.PlanId.make("p1"), operations: [] }),
  new Reason.Stale({ planId: Plan.PlanId.make("p1"), digest: Plan.Digest.make("d") }),
  new Reason.Expired({ entity: "approval", id: "a1" }),
  new Reason.Busy({ key: "refresh:x" }),
  new Reason.ProviderRejected({ provider: "cloudflare", code: "81057", message: "dup" }),
  new Reason.ProviderUnavailable({
    provider: "vercel",
    retryAfterMs: 1000,
    message: "429",
  }),
  new Reason.Reconnect({ provider: "cloudflare", connectionId: "c1" }),
  new Reason.StorageFailed({ operation: "attempts.claim", message: "db down" }),
  new Reason.CryptoFailed({ operation: "open" }),
  new Reason.ResolverFailed({ resolver: "google", message: "timeout" }),
  new Reason.ProviderConflict({ provider: "cloudflare", code: "81057", message: "exists" }),
  new Reason.Unsupported({ provider: "vercel", operation: "dns", message: "no" }),
];

const expected: Record<
  Reason.Model["_tag"],
  {
    readonly category: DomainKit.ErrorCategory;
    readonly status: number;
    readonly retryable: boolean;
  }
> = {
  InvalidInput: { category: "request", status: 400, retryable: false },
  Unauthenticated: { category: "auth", status: 401, retryable: false },
  Forbidden: { category: "auth", status: 403, retryable: false },
  NotFound: { category: "request", status: 404, retryable: false },
  Conflict: { category: "plan", status: 409, retryable: false },
  Stale: { category: "plan", status: 409, retryable: false },
  Expired: { category: "plan", status: 409, retryable: false },
  Busy: { category: "plan", status: 409, retryable: true },
  ProviderRejected: { category: "provider", status: 502, retryable: false },
  ProviderUnavailable: { category: "provider", status: 503, retryable: true },
  Reconnect: { category: "auth", status: 403, retryable: false },
  StorageFailed: { category: "storage", status: 500, retryable: true },
  CryptoFailed: { category: "internal", status: 500, retryable: false },
  ResolverFailed: { category: "internal", status: 500, retryable: false },
  ProviderConflict: { category: "provider", status: 409, retryable: false },
  Unsupported: { category: "provider", status: 501, retryable: false },
};

describe("DomainKitError", () => {
  it("names every reason class after its tag and derives category, status, and retry", () => {
    assert.strictEqual(
      new DomainKit.Error({ reason: new Reason.Busy({ key: "k" }) })._tag,
      "DomainKitError",
    );
    assert.strictEqual(DomainKit.Error.name, "DomainKitError");
    for (const reason of reasons) {
      assert.strictEqual(reason.constructor.name, reason._tag);
      const error = new DomainKit.Error({ reason });
      const table = expected[reason._tag];
      assert.strictEqual(error.category, table.category, reason._tag);
      assert.strictEqual(error.httpStatus, table.status, reason._tag);
      assert.strictEqual(error.isRetryable, table.retryable, reason._tag);
      assert.strictEqual(error.message, reason.message);
      assert.ok(error.message.length > 0, reason._tag);
    }
  });

  it.effect("is catchable by tag and survives the wire", () =>
    Effect.gen(function* () {
      const caught = yield* Errors.fail(new Reason.Busy({ key: "apply:p1" })).pipe(
        Effect.catchTag("DomainKitError", (error) => Effect.succeed(error.reason)),
      );
      assert.strictEqual(caught._tag, "Busy");
      const original = new DomainKit.Error({
        reason: new Reason.Stale({
          planId: Plan.PlanId.make("p1"),
          digest: Plan.Digest.make("d"),
        }),
      });
      const encoded = JSON.parse(JSON.stringify(Schema.encodeSync(DomainKit.Error)(original)));
      assert.deepStrictEqual(encoded, {
        _tag: "DomainKitError",
        reason: { _tag: "Stale", planId: "p1", digest: "d" },
      });
      const decoded = yield* Schema.decodeUnknownEffect(DomainKit.Error)(encoded);
      assert.ok(DomainKit.isError(decoded));
      assert.strictEqual(decoded.httpStatus, 409);
      assert.strictEqual(decoded.message, original.message);
    }),
  );
});
