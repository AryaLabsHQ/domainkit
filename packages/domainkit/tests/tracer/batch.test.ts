import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import { Connect, DnsRecord, DomainKit, Principal, Provision, Storage } from "../../src/index.ts";
import { Testing } from "../../src/entry/testing.ts";

const ONE = "one.example.com";
const TWO = "two.example.com";

const requirementsFor = (domain: string) => [
  DnsRecord.cname({ name: domain, target: "edge.acme.dev", purpose: "Serve your site" }),
  DnsRecord.txt({ name: `_acme.${domain}`, value: "acme-verify=7f3a" }),
];

/** One connection serving both domains, which is what a customer's batch looks like. */
const attachBoth = (fake: Testing.FakeProvider) =>
  Effect.gen(function* () {
    const started = yield* Connect.start({
      provider: fake.id,
      method: Connect.Method.token("token"),
      domain: ONE,
    });
    if (started._tag !== "Connected") throw new Error("expected a connected provider");
    yield* Connect.attach({ connectionId: started.connection.id, domain: TWO });
  });

/**
 * One domain at a time, so the fake's write counter is deterministic. Concurrency is the policy's
 * to change and the lease's to make safe; this suite is about the aggregate's transitions.
 */
const serially = Effect.provideService(Provision.Policy, {
  ...Provision.defaults,
  batchConcurrency: 1,
});

const run =
  (fake: Testing.FakeProvider) =>
  <A, E>(effect: Effect.Effect<A, E, DomainKit.Services | Storage.Service | Principal.Service>) =>
    effect.pipe(
      serially,
      Effect.provideService(Principal.Service, Testing.principal),
      Effect.provide(DomainKit.layerMemory({ providers: [fake] })),
    );

describe("batch tracer", () => {
  it.effect("plans, resumes a failed plan, approves once, and resumes a partial apply", () => {
    // The first provider write fails, so one domain's apply stops before any record and the
    // batch has something left to resume.
    const fake = Testing.provider({ zones: ["example.com"], failWrite: (index) => index === 0 });
    return run(fake)(
      Effect.gen(function* () {
        yield* attachBoth(fake);

        // A requirement outside the attached domain fails before the planner reads the zone, so
        // the second item carries a plan failure and the batch stays planning.
        const created = yield* Provision.batch.create({
          idempotencyKey: "setup-1",
          items: [
            { domain: ONE, requirements: requirementsFor(ONE) },
            {
              domain: TWO,
              requirements: [DnsRecord.txt({ name: "_acme.elsewhere.com", value: "nope" })],
            },
          ],
        });
        assert.strictEqual(created.status, "planning");
        assert.strictEqual(created.digest, null);
        assert.strictEqual(created.items.length, 2);
        assert.ok(created.items[0]?.plan !== null, "the first item was planned");
        assert.strictEqual(created.items[1]?.plan, null);
        assert.ok(
          created.items[1]?.planFailure?.includes("outside the attached domain") === true,
          "the second item records why its plan failed",
        );

        const unfinished = yield* Provision.batch.list({ unfinished: true });
        assert.deepStrictEqual(
          unfinished.map(({ id, status, itemCount }) => ({ id, status, itemCount })),
          [{ id: created.id, status: "planning" as const, itemCount: 2 }],
        );

        // Resuming re-plans only what has no plan; the first item keeps the one it had.
        const planned = yield* Provision.batch.resumePlanning(created.id, {
          items: [{ domain: TWO, requirements: requirementsFor(TWO) }],
        });
        assert.strictEqual(planned.status, "planned");
        assert.strictEqual(planned.items[0]?.plan?.id, created.items[0]?.plan?.id);
        assert.strictEqual(planned.items[1]?.planFailure, null);
        assert.ok(planned.digest !== null, "a fully planned batch has a digest to approve");

        const moved = yield* Provision.batch
          .approve(created.id, {
            digest: "not-the-digest-you-read" as typeof planned.digest & string,
          })
          .pipe(Effect.flip);
        assert.strictEqual(moved.reason._tag, "BatchStale");
        const untouched = yield* Provision.batch.get(created.id);
        assert.strictEqual(untouched.status, "planned");
        assert.strictEqual(untouched.approval, null);

        const approved = yield* Provision.batch.approve(created.id, { digest: planned.digest });
        assert.strictEqual(approved.status, "approved");
        assert.strictEqual(approved.digest, planned.digest);
        assert.strictEqual(approved.approval?.actorId, Testing.principal.actorId);
        assert.deepStrictEqual(
          approved.items.map(({ status }) => status),
          ["approved", "approved"],
        );
        // Every item carries the approval `apply` takes, written with the batch's own.
        assert.ok(
          approved.items.every((item) => item.approval !== null),
          "every item's attempt was approved",
        );

        const declined = yield* Provision.batch.reject(created.id).pipe(Effect.flip);
        assert.strictEqual(declined.reason._tag, "BatchStale");

        const partial = yield* Provision.batch.apply(created.id);
        assert.strictEqual(partial.status, "failed");
        assert.strictEqual(partial.items[0]?.status, "failed");
        assert.ok(partial.items[0]?.failure !== null, "the failed item records why");
        assert.strictEqual(partial.items[1]?.receipt?.status, "complete");
        assert.strictEqual(fake.records("example.com").length, 2);

        // Applying again re-claims the failed attempt; the writes that landed stay landed.
        const complete = yield* Provision.batch.apply(created.id);
        assert.strictEqual(complete.status, "complete");
        assert.deepStrictEqual(
          complete.items.map(({ receipt }) => receipt?.status),
          ["complete", "complete"],
        );
        assert.ok(complete.completedAt !== null, "a complete batch is completed");
        assert.strictEqual(fake.records("example.com").length, 4);

        // Idempotent at the end: nothing left to apply, nothing written twice.
        const settled = yield* Provision.batch.apply(created.id);
        assert.strictEqual(settled.status, "complete");
        assert.strictEqual(fake.records("example.com").length, 4);
        assert.deepStrictEqual(yield* Provision.batch.list({ unfinished: true }), []);
      }),
    );
  });

  it.effect("returns the same batch for a replayed idempotency key", () => {
    const fake = Testing.provider({ zones: ["example.com"] });
    return run(fake)(
      Effect.gen(function* () {
        yield* attachBoth(fake);
        const items = [{ domain: ONE, requirements: requirementsFor(ONE) }];
        const first = yield* Provision.batch.create({ idempotencyKey: "setup-replay", items });
        const second = yield* Provision.batch.create({ idempotencyKey: "setup-replay", items });
        assert.strictEqual(second.id, first.id);
        assert.strictEqual(second.items[0]?.plan?.id, first.items[0]?.plan?.id);
      }),
    );
  });

  it.effect("declines a batch and every plan under it", () => {
    const fake = Testing.provider({ zones: ["example.com"] });
    return run(fake)(
      Effect.gen(function* () {
        yield* attachBoth(fake);
        const created = yield* Provision.batch.create({
          idempotencyKey: "setup-reject",
          items: [
            { domain: ONE, requirements: requirementsFor(ONE) },
            { domain: TWO, requirements: requirementsFor(TWO) },
          ],
        });
        const rejected = yield* Provision.batch.reject(created.id, { reason: "wrong domains" });
        assert.strictEqual(rejected.status, "rejected");
        assert.strictEqual(rejected.rejection?.reason, "wrong domains");
        assert.deepStrictEqual(
          rejected.items.map(({ status }) => status),
          ["rejected", "rejected"],
        );
        // Rejecting again is the same outcome, and the batch has left the unfinished index.
        assert.strictEqual((yield* Provision.batch.reject(created.id)).status, "rejected");
        assert.deepStrictEqual(yield* Provision.batch.list({ unfinished: true }), []);
      }),
    );
  });

  it.effect("writes every record once when two applies race", () => {
    const fake = Testing.provider({ zones: ["example.com"] });
    return run(fake)(
      Effect.gen(function* () {
        yield* attachBoth(fake);
        const created = yield* Provision.batch.create({
          idempotencyKey: "setup-race",
          items: [
            { domain: ONE, requirements: requirementsFor(ONE) },
            { domain: TWO, requirements: requirementsFor(TWO) },
          ],
        });
        const digest = created.digest;
        assert.ok(digest !== null, "both domains were planned");
        const approved = yield* Provision.batch.approve(created.id, { digest });
        assert.strictEqual(approved.status, "approved");

        // The attempt lease is the item lock: the apply that loses it skips that item.
        const [left, right] = yield* Effect.all(
          [Provision.batch.apply(created.id), Provision.batch.apply(created.id)],
          { concurrency: 2 },
        );
        const records = fake.records("example.com");
        assert.strictEqual(records.length, 4);
        assert.strictEqual(
          new Set(records.map((record) => `${record._tag}:${record.name}`)).size,
          4,
        );
        assert.strictEqual(left.id, created.id);
        assert.strictEqual(right.id, created.id);
        const settled = yield* Provision.batch.get(created.id);
        assert.strictEqual(settled.status, "complete");
      }),
    );
  });
});
