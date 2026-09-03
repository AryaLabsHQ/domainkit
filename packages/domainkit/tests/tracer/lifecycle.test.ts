import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect } from "effect";
import { TestClock } from "effect/testing";

import {
  Cleanup,
  Connect,
  DnsRecord,
  DomainKit,
  Plan,
  Principal,
  Provision,
  Storage,
} from "../../src/index.ts";
import { Testing } from "../../src/entry/testing.ts";

const requirements = [
  DnsRecord.cname({ name: "app.example.com", target: "edge.acme.dev", purpose: "Serve your site" }),
  DnsRecord.txt({
    name: "_acme.app.example.com",
    value: "acme-verify=7f3a",
    purpose: "Prove ownership",
  }),
];

const connectFake = (fake: Testing.FakeProvider) =>
  Connect.start({
    provider: fake.id,
    method: Connect.Method.token("token"),
    domain: "app.example.com",
  }).pipe(
    Effect.map((started) => {
      if (started._tag !== "Connected" || started.attachment === null)
        throw new Error("expected an attachment");
      return started;
    }),
  );

const provide = (fake: Testing.FakeProvider) =>
  Effect.provide(DomainKit.layerMemory({ providers: [fake] }));
const withPrincipal = Effect.provideService(Principal.Principal, Testing.principal);

describe("provisioning and cleanup tracer", () => {
  it.effect("plans, approves, applies, re-plans as noop, and cleans up on memory storage", () => {
    const fake = Testing.provider({ zones: ["example.com"] });
    return Effect.gen(function* () {
      yield* connectFake(fake);
      const plan = yield* Provision.plan({ domain: "app.example.com", requirements });
      assert.deepStrictEqual(
        plan.operations.map(({ _tag }) => _tag),
        ["Create", "Create"],
      );
      assert.strictEqual(plan.kind, "provisioning");
      assert.strictEqual(plan.zone, "example.com");
      assert.strictEqual(plan.provider, "fake");
      assert.strictEqual(Plan.isApplicable(plan), true);

      const approval = yield* Provision.approve(plan);
      assert.strictEqual(approval.digest, plan.digest);
      assert.strictEqual(approval.approvedBy, "user_test");
      assert.deepStrictEqual(yield* Provision.approve(plan.id), approval);

      const receipt = yield* Provision.apply(approval);
      assert.strictEqual(receipt.status, "complete");
      assert.deepStrictEqual(
        receipt.outcomes.map(({ _tag }) => _tag),
        ["Applied", "Applied"],
      );
      assert.strictEqual(fake.records("example.com").length, 2);
      assert.deepStrictEqual(yield* Provision.apply(approval.id), receipt);

      const again = yield* Provision.plan({ domain: "app.example.com", requirements });
      assert.deepStrictEqual(
        again.operations.map(({ _tag }) => _tag),
        ["Noop", "Noop"],
      );
      assert.strictEqual(Plan.isApplicable(again), false);
      const noopReceipt = yield* Provision.apply(yield* Provision.approve(again));
      assert.deepStrictEqual(
        noopReceipt.outcomes.map((outcome) =>
          outcome._tag === "Skipped" ? outcome.reason : outcome._tag,
        ),
        ["noop", "noop"],
      );

      const latest = yield* Provision.latest("app.example.com");
      assert.strictEqual(latest?.plan.id, again.id);
      const stored = yield* Provision.get(plan.id);
      assert.strictEqual(stored.receipt?.id, receipt.id);
      const snapshot = yield* Connect.inspect("app.example.com");
      assert.strictEqual(snapshot.lastReceiptId, noopReceipt.id);

      const cleanup = yield* Cleanup.plan({ receiptId: receipt.id });
      assert.strictEqual(cleanup.kind, "cleanup");
      assert.deepStrictEqual(
        cleanup.operations.map(({ _tag }) => _tag),
        ["Delete", "Delete"],
      );
      const cleanupReceipt = yield* Cleanup.apply(yield* Cleanup.approve(cleanup));
      assert.strictEqual(cleanupReceipt.status, "complete");
      assert.deepStrictEqual(fake.records("example.com"), []);
      const byDomain = yield* Cleanup.plan({ domain: "app.example.com" });
      assert.deepStrictEqual(byDomain.operations, []);
      const gone = yield* Cleanup.plan({ receiptId: receipt.id });
      assert.deepStrictEqual(
        gone.operations.map(({ _tag }) => _tag),
        ["Conflict", "Conflict"],
      );
      assert.strictEqual(Plan.conflicts(gone)[0]?.reason, "missing");
      const unknownReceipt = yield* Cleanup.plan({ domain: "nobody.example.com" }).pipe(
        Effect.flip,
      );
      assert.strictEqual(unknownReceipt.reason._tag, "NotFound");
    }).pipe(withPrincipal, provide(fake));
  });

  it.effect("fails closed on conflicts and allows partial approval of the writable subset", () => {
    const fake = Testing.provider({
      zones: ["example.com"],
      records: [
        {
          zone: "example.com",
          record: DnsRecord.txt({ name: "app.example.com", value: "occupied" }),
        },
      ],
    });
    return Effect.gen(function* () {
      yield* connectFake(fake);
      const plan = yield* Provision.plan({ domain: "app.example.com", requirements });
      assert.deepStrictEqual(
        plan.operations.map(({ _tag }) => _tag),
        ["Conflict", "Create"],
      );
      assert.strictEqual(Plan.conflicts(plan)[0]?.reason, "cname-collision");
      const conflict = yield* Provision.approve(plan).pipe(Effect.flip);
      assert.strictEqual(conflict.reason._tag, "Conflict");
      const partial = yield* Provision.approve(plan, { allowPartial: true });
      assert.strictEqual(partial.operationIds.length, 1);
      const receipt = yield* Provision.apply(partial);
      assert.strictEqual(receipt.status, "complete");
      assert.deepStrictEqual(
        receipt.outcomes.map((outcome) =>
          outcome._tag === "Skipped" ? outcome.reason : outcome._tag,
        ),
        ["not-approved", "Applied"],
      );
      const unknown = yield* Provision.approve(
        yield* Provision.plan({ domain: "app.example.com", requirements }),
        { operationIds: [Plan.OperationId.make("nope")], allowPartial: true },
      ).pipe(Effect.flip);
      assert.strictEqual(unknown.reason._tag, "InvalidInput");
    }).pipe(withPrincipal, provide(fake));
  });

  it.effect("detects provider drift between approval and apply", () => {
    const fake = Testing.provider({ zones: ["example.com"] });
    return Effect.gen(function* () {
      const { attachment } = yield* connectFake(fake);
      const plan = yield* Provision.plan({ domain: "app.example.com", requirements });
      const approval = yield* Provision.approve(plan);
      const { session, target } = yield* Connect.session(attachment?.id ?? "");
      yield* session
        .dns(target)
        .create(
          "example.com",
          DnsRecord.cname({ name: "app.example.com", target: "other.acme.dev" }),
        );
      const stale = yield* Provision.apply(approval).pipe(Effect.flip);
      assert.strictEqual(stale.reason._tag, "Stale");
      const attempt = yield* Provision.get(plan.id);
      assert.strictEqual(attempt.receipt, null);
      const storage = yield* Storage.Storage;
      const row = yield* storage.attempts.get(plan.id);
      assert.strictEqual(row.status, "failed");
      const tampered = new Plan.Plan({ ...plan, digest: Plan.Digest.make("forged") });
      const forged = yield* Provision.approve(tampered).pipe(Effect.flip);
      assert.strictEqual(forged.reason._tag, "Stale");
    }).pipe(withPrincipal, provide(fake));
  });

  it.effect("returns a partial receipt when a later write fails and cleans up what landed", () => {
    const fake = Testing.provider({ zones: ["example.com"], failWrite: (index) => index === 1 });
    return Effect.gen(function* () {
      yield* connectFake(fake);
      const plan = yield* Provision.plan({ domain: "app.example.com", requirements });
      const receipt = yield* Provision.apply(yield* Provision.approve(plan));
      assert.strictEqual(receipt.status, "partial");
      assert.deepStrictEqual(
        receipt.outcomes.map(({ _tag }) => _tag),
        ["Applied", "Failed"],
      );
      assert.strictEqual(fake.records("example.com").length, 1);
      const cleanup = yield* Cleanup.plan({ receiptId: receipt.id });
      assert.deepStrictEqual(
        cleanup.operations.map(({ _tag }) => _tag),
        ["Delete"],
      );
      yield* Cleanup.apply(yield* Cleanup.approve(cleanup));
      assert.deepStrictEqual(fake.records("example.com"), []);
    }).pipe(withPrincipal, provide(fake));
  });

  it.effect("propagates a first-write failure and lets the attempt be retried", () => {
    let fail = true;
    const fake = Testing.provider({ zones: ["example.com"], failWrite: () => fail });
    return Effect.gen(function* () {
      yield* connectFake(fake);
      const approval = yield* Provision.approve(
        yield* Provision.plan({ domain: "app.example.com", requirements }),
      );
      const failure = yield* Provision.apply(approval).pipe(Effect.flip);
      assert.strictEqual(failure.reason._tag, "ProviderUnavailable");
      fail = false;
      const receipt = yield* Provision.apply(approval);
      assert.strictEqual(receipt.status, "complete");
    }).pipe(withPrincipal, provide(fake));
  });

  it.effect("expires plans and approvals after the policy TTL", () => {
    const fake = Testing.provider({ zones: ["example.com"] });
    return Effect.gen(function* () {
      yield* connectFake(fake);
      const plan = yield* Provision.plan({ domain: "app.example.com", requirements });
      const approval = yield* Provision.approve(plan);
      yield* TestClock.adjust("2 hours");
      const expired = yield* Provision.apply(approval).pipe(Effect.flip);
      assert.strictEqual(expired.reason._tag, "Expired");
      const stalePlan = yield* Provision.approve(
        yield* Provision.plan({ domain: "app.example.com", requirements }).pipe(
          Effect.map((p) => p.id),
        ),
      );
      assert.ok(
        DateTime.toEpochMillis(stalePlan.expiresAt) > DateTime.toEpochMillis(yield* DateTime.now),
      );
    }).pipe(withPrincipal, provide(fake));
  });

  it.effect("fails Busy while another apply holds the lease", () => {
    const fake = Testing.provider({ zones: ["example.com"] });
    return Effect.gen(function* () {
      yield* connectFake(fake);
      const plan = yield* Provision.plan({ domain: "app.example.com", requirements });
      const approval = yield* Provision.approve(plan);
      const storage = yield* Storage.Storage;
      const now = yield* DateTime.now;
      yield* storage.attempts.claim(plan.id, DateTime.add(now, { minutes: 2 }));
      const busy = yield* Provision.apply(approval).pipe(Effect.flip);
      assert.strictEqual(busy.reason._tag, "Busy");
      yield* TestClock.adjust("3 minutes");
      const receipt = yield* Provision.apply(approval);
      assert.strictEqual(receipt.status, "complete");
      const unattached = yield* Provision.plan({ domain: "other.example.com", requirements }).pipe(
        Effect.flip,
      );
      assert.strictEqual(unattached.reason._tag, "NotFound");
    }).pipe(withPrincipal, provide(fake));
  });

  it.effect("keeps a plan digest stable across labels but not across records", () => {
    const fake = Testing.provider({ zones: ["example.com"] });
    return Effect.gen(function* () {
      yield* connectFake(fake);
      const first = yield* Provision.plan({ domain: "app.example.com", requirements });
      const relabeled = yield* Provision.plan({
        domain: "app.example.com",
        requirements: requirements.map((record) =>
          DnsRecord.isDnsRecord(record) && record._tag === "CNAME"
            ? DnsRecord.cname({ name: record.name, target: record.target, purpose: "Other label" })
            : record,
        ),
      });
      assert.strictEqual(relabeled.digest, first.digest);
      const changed = yield* Provision.plan({
        domain: "app.example.com",
        requirements: [DnsRecord.cname({ name: "app.example.com", target: "elsewhere.acme.dev" })],
      });
      assert.notStrictEqual(changed.digest, first.digest);
    }).pipe(withPrincipal, provide(fake));
  });
});
