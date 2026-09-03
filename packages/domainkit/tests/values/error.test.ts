import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { DomainKitError, Plan } from "../../src/index.ts";

const reasons: ReadonlyArray<DomainKitError.Reason> = [
  new DomainKitError.InvalidInput({ message: "bad", field: "domain" }),
  new DomainKitError.Unauthenticated({ message: "who" }),
  new DomainKitError.Forbidden({ message: "no" }),
  new DomainKitError.NotFound({ entity: "plan", id: "p1" }),
  new DomainKitError.Conflict({ planId: Plan.PlanId.make("p1"), operations: [] }),
  new DomainKitError.Stale({ planId: Plan.PlanId.make("p1"), digest: Plan.Digest.make("d") }),
  new DomainKitError.Expired({ entity: "approval", id: "a1" }),
  new DomainKitError.Busy({ key: "refresh:x" }),
  new DomainKitError.ProviderRejected({ provider: "cloudflare", code: "81057", message: "dup" }),
  new DomainKitError.ProviderUnavailable({
    provider: "vercel",
    retryAfterMs: 1000,
    message: "429",
  }),
  new DomainKitError.Reconnect({ provider: "cloudflare", connectionId: "c1" }),
  new DomainKitError.StorageFailed({ operation: "attempts.claim", message: "db down" }),
  new DomainKitError.CryptoFailed({ operation: "open" }),
  new DomainKitError.ResolverFailed({ resolver: "google", message: "timeout" }),
];

const expected: Record<
  DomainKitError.Reason["_tag"],
  {
    readonly category: DomainKitError.Category;
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
};

describe("DomainKitError", () => {
  it("names every reason class after its tag and derives category, status, and retry", () => {
    assert.strictEqual(
      new DomainKitError.DomainKitError({ reason: new DomainKitError.Busy({ key: "k" }) })._tag,
      "DomainKitError",
    );
    assert.strictEqual(DomainKitError.DomainKitError.name, "DomainKitError");
    for (const reason of reasons) {
      assert.strictEqual(reason.constructor.name, reason._tag);
      const error = new DomainKitError.DomainKitError({ reason });
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
      const caught = yield* DomainKitError.fail(new DomainKitError.Busy({ key: "apply:p1" })).pipe(
        Effect.catchTag("DomainKitError", (error) => Effect.succeed(error.reason)),
      );
      assert.strictEqual(caught._tag, "Busy");
      const original = new DomainKitError.DomainKitError({
        reason: new DomainKitError.Stale({
          planId: Plan.PlanId.make("p1"),
          digest: Plan.Digest.make("d"),
        }),
      });
      const encoded = JSON.parse(
        JSON.stringify(Schema.encodeSync(DomainKitError.DomainKitError)(original)),
      );
      assert.deepStrictEqual(encoded, {
        _tag: "DomainKitError",
        reason: { _tag: "Stale", planId: "p1", digest: "d" },
      });
      const decoded = yield* Schema.decodeUnknownEffect(DomainKitError.DomainKitError)(encoded);
      assert.ok(DomainKitError.isDomainKitError(decoded));
      assert.strictEqual(decoded.httpStatus, 409);
      assert.strictEqual(decoded.message, original.message);
    }),
  );
});
