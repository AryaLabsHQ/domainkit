import {
  Cleanup,
  Connect,
  Custody,
  DnsRecord,
  DomainKit,
  Plan,
  Principal,
  Provision,
  Storage,
  Verify,
} from "domainkit";
import { Testing } from "domainkit/testing";
import { Effect, Layer, Option, Redacted } from "effect";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";

import { PgStorage } from "../src/index.ts";
import { type Postgres, start } from "./postgres.ts";

const requirements = [
  DnsRecord.cname({ name: "app.example.com", target: "edge.acme.dev", purpose: "Serve your site" }),
  DnsRecord.txt({ name: "_acme.app.example.com", value: "acme-verify=7f3a" }),
];

let postgres: Postgres | undefined;

beforeAll(async () => {
  postgres = await start();
}, 180_000);

afterAll(async () => {
  await postgres?.stop();
});

/**
 * One tenant, one provider, and one custody key per case, so a credential sealed in one case is
 * never opened in another.
 */
const run = <A>(
  ownerId: string,
  effect: Effect.Effect<A, unknown, DomainKit.Services | Storage.Storage | Principal.Principal>,
) => {
  const client = postgres?.layer;
  if (client === undefined) throw new Error("the Postgres container was not started");
  const fake = Testing.provider({ zones: ["example.com"] });
  return Effect.runPromise(
    effect.pipe(
      Effect.provideService(Principal.Principal, Principal.make({ ownerId, actorId: "actor" })),
      Effect.provide(
        DomainKit.layer({ providers: [fake], resolver: Testing.resolver() }).pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              PgStorage.layer(),
              Custody.layer({ key: Redacted.make(Custody.generateKey()) }),
            ),
          ),
          Layer.provide(client),
        ),
      ),
    ),
  );
};

describe("lifecycle on PgStorage", () => {
  it(
    "connects, plans, approves, applies, observes, and cleans up",
    () =>
      run(
        "org-lifecycle",
        Effect.gen(function* () {
          const started = yield* Connect.start({
            provider: "fake",
            method: Connect.Method.token("token"),
            domain: "app.example.com",
          });
          assert.strictEqual(started._tag, "Connected");
          if (started._tag !== "Connected" || started.attachment === null) return;

          const plan = yield* Provision.plan({ domain: "app.example.com", requirements });
          assert.deepStrictEqual(
            plan.operations.map(({ _tag }) => _tag),
            ["Create", "Create"],
          );
          assert.strictEqual(Plan.isApplicable(plan), true);

          const approval = yield* Provision.approve(plan);
          const receipt = yield* Provision.apply(approval);
          assert.strictEqual(receipt.status, "complete");

          // Everything the lifecycle wrote has to survive a read that goes back to Postgres.
          const storage = yield* Storage.Storage;
          const attempt = yield* storage.attempts.byReceipt(receipt.id);
          assert.strictEqual(attempt.id, plan.id);
          assert.strictEqual(attempt.status, "complete");
          assert.strictEqual(attempt.plan.digest, plan.digest);
          const byApproval = yield* storage.attempts.byApproval(approval.id);
          assert.strictEqual(byApproval.id, plan.id);
          const latest = yield* storage.attempts.latest(started.attachment.id, "provisioning");
          assert.strictEqual(Option.isSome(latest) && latest.value.id, plan.id);

          const readiness = yield* Verify.observe({ domain: "app.example.com" });
          assert.strictEqual(readiness.overall, "ready");
          const stored = yield* storage.readiness.get(started.attachment.id);
          assert.strictEqual(Option.isSome(stored) && stored.value.overall, "ready");

          const cleanup = yield* Cleanup.plan({ receiptId: receipt.id });
          const cleanupReceipt = yield* Cleanup.apply(yield* Cleanup.approve(cleanup));
          assert.strictEqual(cleanupReceipt.status, "complete");
          const cleanupAttempt = yield* storage.attempts.get(cleanup.id);
          assert.strictEqual(cleanupAttempt.sourceReceiptId, receipt.id);
        }),
      ),
    180_000,
  );

  it(
    "releases the advisory lock so the next single-flight caller acquires it",
    () =>
      run(
        "org-lock",
        Effect.gen(function* () {
          const started = yield* Connect.start({
            provider: "fake",
            method: Connect.Method.token("token"),
            domain: "locked.example.com",
          });
          if (started._tag !== "Connected") return;
          const storage = yield* Storage.Storage;
          const before = yield* storage.authorizations.credential(
            (yield* storage.connections.get(started.connection.id)).authorizationId,
          );
          // The advisory lock has to be released on the reserved connection, or the second call
          // would fail Busy against a session that is back in the pool.
          yield* storage.withLock("refresh:locked", Effect.void);
          yield* storage.withLock("refresh:locked", Effect.void);
          const after = yield* storage.authorizations.credential(
            (yield* storage.connections.get(started.connection.id)).authorizationId,
          );
          assert.strictEqual(after.ciphertext, before.ciphertext);
        }),
      ),
    180_000,
  );
});
