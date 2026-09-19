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
import { DateTime, Effect, Layer, Option, Redacted } from "effect";
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
  effect: Effect.Effect<A, unknown, DomainKit.Services | Storage.Service | Principal.Service>,
  provider: Testing.FakeProviderOptions = { zones: ["example.com"] },
) => {
  const client = postgres?.layer;
  if (client === undefined) throw new Error("the Postgres container was not started");
  const fake = Testing.provider(provider);
  return Effect.runPromise(
    effect.pipe(
      Effect.provideService(Principal.Service, Principal.make({ ownerId, actorId: "actor" })),
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
          const storage = yield* Storage.Service;
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
          const stored = yield* storage.readiness.get("app.example.com");
          assert.strictEqual(Option.isSome(stored) && stored.value.overall, "ready");
          assert.strictEqual(
            Option.isSome(stored) && stored.value.attachmentId,
            started.attachment.id,
          );

          const cleanup = yield* Cleanup.plan({ receiptId: receipt.id });
          const cleanupReceipt = yield* Cleanup.apply(yield* Cleanup.approve(cleanup));
          assert.strictEqual(cleanupReceipt.status, "complete");
          const cleanupAttempt = yield* storage.attempts.get(cleanup.id);
          assert.strictEqual(cleanupAttempt.sourceReceiptId, receipt.id);

          // Readiness is keyed by domain, so removing the attachment clears the link and keeps
          // what was observed about the domain.
          yield* storage.attachments.remove(started.attachment.id);
          const unlinked = yield* storage.readiness.get("app.example.com");
          assert.strictEqual(Option.isSome(unlinked) && unlinked.value.attachmentId, null);
        }),
      ),
    180_000,
  );

  it(
    "plans a batch, resumes what failed, approves once, and resumes a partial apply",
    () =>
      run(
        "org-batch",
        Effect.gen(function* () {
          const one = "one.batch.example.com";
          const two = "two.batch.example.com";
          const requirementsFor = (domain: string) => [
            DnsRecord.cname({ name: domain, target: "edge.acme.dev" }),
            DnsRecord.txt({ name: `_acme.${domain}`, value: "acme-verify=7f3a" }),
          ];
          const started = yield* Connect.start({
            provider: "fake",
            method: Connect.Method.token("token"),
            domain: one,
          });
          if (started._tag !== "Connected") return;
          yield* Connect.attach({ connectionId: started.connection.id, domain: two });

          // A requirement outside the attached domain fails before the planner reads the zone.
          const created = yield* Provision.batch.create({
            idempotencyKey: "pg-batch-1",
            items: [
              { domain: one, requirements: requirementsFor(one) },
              {
                domain: two,
                requirements: [DnsRecord.txt({ name: "_acme.elsewhere.com", value: "nope" })],
              },
            ],
          });
          assert.strictEqual(created.status, "planning");
          assert.strictEqual(created.digest, null);
          assert.ok(created.items[1]?.planFailure !== null, "the second item records its failure");

          const replay = yield* Provision.batch.create({
            idempotencyKey: "pg-batch-1",
            items: [{ domain: one, requirements: requirementsFor(one) }],
          });
          assert.strictEqual(replay.id, created.id);

          const planned = yield* Provision.batch.resumePlanning(created.id, {
            items: [{ domain: two, requirements: requirementsFor(two) }],
          });
          assert.strictEqual(planned.status, "planned");
          assert.strictEqual(planned.items[0]?.plan?.id, created.items[0]?.plan?.id);
          assert.ok(planned.digest !== null, "a fully planned batch has a digest");

          const moved = yield* Effect.flip(
            Provision.batch.approve(created.id, {
              digest: Plan.Digest.make("not-the-digest-you-read"),
            }),
          );
          assert.strictEqual(moved.reason._tag, "BatchStale");

          const approved = yield* Provision.batch.approve(created.id, { digest: planned.digest });
          assert.strictEqual(approved.status, "approved");
          assert.ok(
            approved.items.every((item) => item.approval !== null),
            "the batch approval and the per-attempt approvals committed together",
          );

          // The first provider write fails, so one domain stops before any record.
          const partial = yield* Provision.batch.apply(created.id);
          assert.strictEqual(partial.status, "failed");
          assert.strictEqual(partial.items[0]?.status, "failed");
          assert.strictEqual(partial.items[1]?.receipt?.status, "complete");

          const complete = yield* Provision.batch.apply(created.id);
          assert.strictEqual(complete.status, "complete");
          assert.ok(complete.completedAt !== null, "a complete batch is completed");
          assert.deepStrictEqual(
            (yield* Provision.batch.list({ unfinished: true })).map(({ id }) => id),
            [],
          );
        }).pipe(
          // One domain at a time, so the fake's write counter is deterministic.
          Effect.provideService(Provision.Policy, {
            ...Provision.defaults,
            batchConcurrency: 1,
          }),
        ),
        { zones: ["example.com"], failWrite: (index) => index === 0 },
      ),
    180_000,
  );
  it(
    "declines a batch with every plan under it",
    () =>
      run(
        "org-batch-reject",
        Effect.gen(function* () {
          const domain = "declined.example.com";
          const started = yield* Connect.start({
            provider: "fake",
            method: Connect.Method.token("token"),
            domain,
          });
          if (started._tag !== "Connected") return;
          const created = yield* Provision.batch.create({
            idempotencyKey: "pg-batch-reject",
            items: [
              {
                domain,
                requirements: [DnsRecord.cname({ name: domain, target: "edge.acme.dev" })],
              },
            ],
          });
          assert.strictEqual(created.status, "planned");
          const rejected = yield* Provision.batch.reject(created.id, { reason: "wrong domain" });
          assert.strictEqual(rejected.status, "rejected");
          assert.deepStrictEqual(
            rejected.items.map(({ status }) => status),
            ["rejected"],
          );
          // The fence: a planning pass still in flight lands nothing on a declined batch.
          const storage = yield* Storage.Service;
          const attachmentId = created.items[0]?.attachmentId ?? "";
          const fenced = yield* Effect.flip(
            storage.batches.recordItemPlanFailure(created.id, attachmentId, "x"),
          );
          assert.strictEqual(fenced.reason._tag, "BatchStale");
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
          const storage = yield* Storage.Service;
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
  it(
    "keeps a revocation pending when a refresh rotates the credential mid-revoke",
    () =>
      run(
        "org-rotate",
        Effect.gen(function* () {
          const storage = yield* Storage.Service;
          const now = yield* DateTime.now;
          const id = "auth-rotate";
          yield* storage.authorizations.upsert({
            authorization: new Storage.Authorization({
              id,
              ownerId: "org-rotate",
              provider: "fake",
              method: "oauth",
              capabilities: ["dns:read", "dns:write"],
              context: { account: "fake" },
              label: "Fake account",
              revocation: "active",
              createdBy: "actor",
              createdAt: now,
            }),
            credential: new Storage.Credential({
              ciphertext: "sealed-old",
              expiresAt: null,
              rotatedAt: now,
            }),
          });

          // The provider call is where a concurrent refresh lands: it issues a replacement
          // credential and rotates the row after revocation already picked the old one.
          const revoked: Array<string> = [];
          yield* storage.authorizations.revoke(
            id,
            Effect.gen(function* () {
              revoked.push((yield* storage.authorizations.credential(id)).ciphertext);
              yield* storage.authorizations.rotate(
                id,
                new Storage.Credential({
                  ciphertext: "sealed-new",
                  expiresAt: null,
                  rotatedAt: yield* DateTime.now,
                }),
              );
            }),
          );

          // Deleting here would leave sealed-new live at the provider with nothing to revoke it
          // from, so the row stays pending for recovery.
          const still = yield* storage.authorizations.get(id);
          assert.strictEqual(still.revocation, "pending");

          const recovered = yield* storage.authorizations.recoverRevocations((authorization) =>
            Effect.map(
              storage.authorizations.credential(authorization.id),
              (credential) => void revoked.push(credential.ciphertext),
            ),
          );
          assert.strictEqual(recovered, 1);
          assert.deepStrictEqual(revoked, ["sealed-old", "sealed-new"]);
          const gone = yield* Effect.flip(storage.authorizations.get(id));
          assert.strictEqual(gone.reason._tag, "NotFound");
        }),
      ),
    180_000,
  );
});
