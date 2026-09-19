import { DateTime, Deferred, Effect, Fiber, Layer, Option } from "effect";

import * as Approval from "../../Approval.ts";
import * as DnsRecord from "../../DnsRecord.ts";
import * as Errors from "../error.ts";
import * as Reason from "../../Reason.ts";
import * as Plan from "../../Plan.ts";
import * as Principal from "../../Principal.ts";
import * as Receipt from "../../Receipt.ts";
import * as Storage from "../../Storage.ts";

export interface Case {
  readonly name: string;
  readonly run: Effect.Effect<void, unknown>;
}

export interface Options {
  /** Register each case with a test runner, e.g. vitest's `it`. */
  readonly it?: (name: string, run: () => Promise<void>) => void;
}

const owner = Principal.make({ ownerId: "conformance-owner-a", actorId: "actor-a" });
const other = Principal.make({ ownerId: "conformance-owner-b", actorId: "actor-b" });

class Failure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageConformanceFailure";
  }
}

const expect = (condition: boolean, message: string) =>
  condition ? Effect.void : Effect.fail(new Failure(message));

const expectReason = <A, R>(
  effect: Effect.Effect<A, unknown, R>,
  tag: Reason.Model["_tag"],
  label: string,
): Effect.Effect<void, Failure, R> =>
  effect.pipe(
    Effect.flip,
    Effect.mapError(() => new Failure(`${label}: expected failure ${tag}, effect succeeded`)),
    Effect.flatMap((cause) =>
      expect(
        Errors.isDomainKitError(cause) && cause.reason._tag === tag,
        `${label}: expected reason ${tag}, received ${Errors.isDomainKitError(cause) ? cause.reason._tag : String(cause)}`,
      ),
    ),
  );

const authorizationRow = (principal: Principal.Interface, id: string, now: DateTime.Utc) =>
  new Storage.Authorization({
    id,
    ownerId: principal.ownerId,
    provider: "fake",
    method: "token",
    capabilities: ["dns:read"],
    context: { account: "acc" },
    label: "Acme",
    revocation: "active",
    createdBy: principal.actorId,
    createdAt: now,
  });

const credentialRow = (now: DateTime.Utc, ciphertext = "sealed-1") =>
  new Storage.Credential({ ciphertext, expiresAt: null, rotatedAt: now });

const connect = (principal: Principal.Interface, id: string) =>
  Effect.gen(function* () {
    const storage = yield* Storage.Service;
    const now = yield* DateTime.now;
    yield* storage.authorizations.upsert({
      authorization: authorizationRow(principal, id, now),
      credential: credentialRow(now),
    });
    const connection = yield* storage.connections.create(id);
    const attachment = yield* storage.attachments.create({
      connectionId: connection.id,
      domain: `app.${id}.example.com`,
      zone: `${id}.example.com`,
      label: `${id}.example.com (${id})`,
      target: { zoneId: `zone-${id}` },
    });
    return { storage, connection, attachment };
  }).pipe(Effect.provideService(Principal.Service, principal));

const planRow = (attachmentId: string, now: DateTime.Utc, suffix: string) =>
  new Plan.Model({
    id: Plan.PlanId.make(`plan-${suffix}`),
    version: "domainkit.plan.v2",
    kind: "provisioning",
    digest: Plan.Digest.make(`digest-${suffix}`),
    domain: "app.example.com",
    zone: "example.com",
    provider: "fake",
    attachmentId,
    operations: [
      new Plan.Create({
        id: Plan.OperationId.make(`op-${suffix}`),
        record: DnsRecord.txt({ name: "app.example.com", value: suffix }),
      }),
    ],
    createdAt: now,
    expiresAt: DateTime.add(now, { hours: 1 }),
  });

const attemptRow = (principal: Principal.Interface, plan: Plan.Model) =>
  new Storage.Attempt({
    id: plan.id,
    ownerId: principal.ownerId,
    attachmentId: plan.attachmentId,
    kind: plan.kind,
    status: "planned",
    plan,
    approval: null,
    receipt: null,
    rejection: null,
    sourceReceiptId: null,
    leaseExpiresAt: null,
    failure: null,
    updatedAt: plan.createdAt,
  });

const approvalRow = (plan: Plan.Model, suffix: string) =>
  new Approval.Model({
    id: Approval.ApprovalId.make(`approval-${suffix}`),
    version: "domainkit.approval.v2",
    kind: plan.kind,
    planId: plan.id,
    digest: plan.digest,
    operationIds: plan.operations.map(({ id }) => id),
    approvedBy: "actor",
    approvedAt: plan.createdAt,
    expiresAt: plan.expiresAt,
  });

const receiptRow = (plan: Plan.Model, approval: Approval.Model, suffix: string) =>
  new Receipt.Model({
    id: Receipt.ReceiptId.make(`receipt-${suffix}`),
    version: "domainkit.receipt.v2",
    kind: plan.kind,
    planId: plan.id,
    approvalId: approval.id,
    digest: plan.digest,
    provider: plan.provider,
    zone: plan.zone,
    status: "complete",
    outcomes: plan.operations.map(
      (operation) => new Receipt.Applied({ operationId: operation.id, providerRecordId: "r1" }),
    ),
    appliedAt: plan.createdAt,
  });

/** Every invariant a `Storage` implementation must hold. Each case runs against a fresh layer. */
export const cases = (layer: Layer.Layer<Storage.Service, unknown>): ReadonlyArray<Case> => {
  const run = <E>(effect: Effect.Effect<void, E, Storage.Service>): Effect.Effect<void, unknown> =>
    effect.pipe(Effect.provide(layer));
  return [
    {
      name: "scopes every row by the principal's owner",
      run: run(
        Effect.gen(function* () {
          const { storage, connection, attachment } = yield* connect(owner, "auth-a");
          const asOther = <A, E>(effect: Effect.Effect<A, E, Principal.Service>) =>
            effect.pipe(Effect.provideService(Principal.Service, other));
          yield* expectReason(
            asOther(storage.authorizations.get("auth-a")),
            "NotFound",
            "authorizations.get",
          );
          yield* expectReason(
            asOther(storage.authorizations.credential("auth-a")),
            "NotFound",
            "authorizations.credential",
          );
          yield* expectReason(
            asOther(storage.connections.get(connection.id)),
            "NotFound",
            "connections.get",
          );
          yield* expectReason(
            asOther(storage.attachments.get(attachment.id)),
            "NotFound",
            "attachments.get",
          );
          yield* expectReason(
            asOther(storage.attachments.list(connection.id)),
            "NotFound",
            "attachments.list",
          );
          const connections = yield* asOther(storage.connections.list());
          yield* expect(connections.length === 0, "connections.list leaked across owners");
          const byDomain = yield* asOther(storage.attachments.byDomain(attachment.domain));
          yield* expect(Option.isNone(byDomain), "attachments.byDomain leaked across owners");
          const now = yield* DateTime.now;
          yield* expectReason(
            asOther(
              storage.authorizations.upsert({
                authorization: authorizationRow(owner, "auth-b", now),
                credential: credentialRow(now),
              }),
            ),
            "InvalidInput",
            "authorizations.upsert with a foreign ownerId",
          );
        }),
      ),
    },
    {
      name: "stores, rotates, and promotes credentials without exposing plaintext",
      run: run(
        Effect.gen(function* () {
          const { storage } = yield* connect(owner, "auth-cred");
          const first = yield* storage.authorizations.credential("auth-cred");
          yield* expect(first.ciphertext === "sealed-1", "credential ciphertext was not stored");
          const now = yield* DateTime.now;
          yield* storage.authorizations.rotate("auth-cred", credentialRow(now, "sealed-2"));
          const rotated = yield* storage.authorizations.credential("auth-cred");
          yield* expect(rotated.ciphertext === "sealed-2", "rotate did not replace the credential");
          yield* storage.authorizations.promoteCapabilities("auth-cred", ["dns:write", "dns:read"]);
          const promoted = yield* storage.authorizations.get("auth-cred");
          yield* expect(
            [...promoted.capabilities].sort().join(",") === "dns:read,dns:write",
            "promoteCapabilities did not merge capabilities",
          );
          // The account label names the connection without a provider call, so it has to survive
          // the round trip as written.
          yield* expect(promoted.label === "Acme", "authorization label was not stored");
        }).pipe(Effect.provideService(Principal.Service, owner)),
      ),
    },
    {
      name: "replaces an authorization only through the expected id",
      run: run(
        Effect.gen(function* () {
          const { storage } = yield* connect(owner, "auth-cas");
          const now = yield* DateTime.now;
          const replaced = yield* storage.authorizations.upsert({
            authorization: new Storage.Authorization({
              ...authorizationRow(owner, "auth-cas", now),
              method: "oauth",
            }),
            credential: credentialRow(now, "sealed-oauth"),
            expectedId: "auth-cas",
          });
          yield* expect(
            replaced.method === "oauth",
            "upsert with expectedId did not replace the row",
          );
          const credential = yield* storage.authorizations.credential("auth-cas");
          yield* expect(
            credential.ciphertext === "sealed-oauth",
            "upsert with expectedId did not replace the credential",
          );
          yield* expectReason(
            storage.authorizations.upsert({
              authorization: authorizationRow(owner, "auth-missing", now),
              credential: credentialRow(now),
              expectedId: "auth-missing",
            }),
            "NotFound",
            "upsert with an unknown expectedId",
          );
          yield* expectReason(
            storage.authorizations.upsert({
              authorization: authorizationRow(owner, "auth-cas", now),
              credential: credentialRow(now),
            }),
            "InvalidInput",
            "insert of an existing id",
          );
        }).pipe(Effect.provideService(Principal.Service, owner)),
      ),
    },
    {
      name: "consumes continuations exactly once and rejects expired ones",
      run: run(
        Effect.gen(function* () {
          const storage = yield* Storage.Service;
          const now = yield* DateTime.now;
          const continuation = new Storage.Continuation({
            id: "cont-1",
            ownerId: owner.ownerId,
            actorId: owner.actorId,
            provider: "fake",
            payload: { codeVerifier: "v" },
            returnTo: null,
            expiresAt: DateTime.add(now, { minutes: 15 }),
          });
          yield* storage.continuations.put(continuation);
          yield* expectReason(
            storage.continuations
              .consume("cont-1")
              .pipe(Effect.provideService(Principal.Service, other)),
            "NotFound",
            "consume by another owner",
          );
          const peeked = yield* storage.continuations.get("cont-1");
          yield* expect(peeked.id === "cont-1", "get did not return the continuation");
          const consumed = yield* storage.continuations.consume("cont-1");
          yield* expect(consumed.id === "cont-1", "consume did not return the continuation");
          yield* expectReason(storage.continuations.get("cont-1"), "NotFound", "get after consume");
          yield* expectReason(
            storage.continuations.consume("cont-1"),
            "NotFound",
            "second consume",
          );
          yield* storage.continuations.put(
            new Storage.Continuation({
              ...continuation,
              id: "cont-2",
              expiresAt: DateTime.subtract(now, { minutes: 1 }),
            }),
          );
          yield* expectReason(storage.continuations.get("cont-2"), "Expired", "expired get");
          yield* expectReason(
            storage.continuations.consume("cont-2"),
            "Expired",
            "expired consume",
          );
          yield* expectReason(
            storage.continuations.consume("cont-2"),
            "NotFound",
            "expired consume is also spent",
          );
        }).pipe(Effect.provideService(Principal.Service, owner)),
      ),
    },
    {
      name: "reads a continuation header under any principal and still refuses an expired one",
      run: run(
        Effect.gen(function* () {
          const storage = yield* Storage.Service;
          const now = yield* DateTime.now;
          const continuation = new Storage.Continuation({
            id: "cont-header-1",
            ownerId: owner.ownerId,
            actorId: owner.actorId,
            provider: "fake",
            payload: { codeVerifier: "v" },
            returnTo: null,
            expiresAt: DateTime.add(now, { minutes: 15 }),
          });
          yield* storage.continuations.put(continuation);
          // The deliberate exception to the tenant isolation every other case here enforces, and
          // not a bug. A provider callback is a top-level navigation carrying a continuation id
          // and a session cookie, so the route has to learn whose flow it is before it can name a
          // principal to scope by. The read therefore takes no principal at all — that is a type
          // constraint, and providing a foreign one below changes nothing — and it answers with
          // header fields only. `payload` holds the PKCE verifier and stays behind the
          // owner-scoped `get`. Binding the caller to the flow is the reader's job, and
          // `domainkit/server` does it on the callback route.
          const foreign = yield* storage.continuations
            .header("cont-header-1")
            .pipe(Effect.provideService(Principal.Service, other));
          yield* expect(
            foreign.ownerId === owner.ownerId && foreign.actorId === owner.actorId,
            "header did not report the recorded owner and actor",
          );
          yield* expect(foreign.provider === "fake", "header did not report the provider");
          yield* expect(!("payload" in foreign), "header exposed the continuation payload");
          // A read, never a claim: the flow is still there to be spent.
          const still = yield* storage.continuations.get("cont-header-1");
          yield* expect(still.id === "cont-header-1", "the header read spent the continuation");
          yield* expectReason(
            storage.continuations.header("cont-header-missing"),
            "NotFound",
            "header of an unknown continuation",
          );
          yield* storage.continuations.put(
            new Storage.Continuation({
              ...continuation,
              id: "cont-header-2",
              expiresAt: DateTime.subtract(now, { minutes: 1 }),
            }),
          );
          yield* expectReason(
            storage.continuations.header("cont-header-2"),
            "Expired",
            "header of an expired continuation",
          );
        }).pipe(Effect.provideService(Principal.Service, owner)),
      ),
    },
    {
      name: "moves attempts through planned, approved, applying, and complete with leases",
      run: run(
        Effect.gen(function* () {
          const { storage, attachment } = yield* connect(owner, "auth-attempt");
          const now = yield* DateTime.now;
          const plan = planRow(attachment.id, now, "1");
          yield* storage.attempts.create(attemptRow(owner, plan));
          yield* expectReason(
            storage.attempts.create(attemptRow(owner, plan)),
            "InvalidInput",
            "duplicate attempt",
          );
          yield* expectReason(
            storage.attempts.claim(plan.id, DateTime.add(now, { minutes: 2 })),
            "Stale",
            "claim before approval",
          );
          const approval = approvalRow(plan, "1");
          const approved = yield* storage.attempts.approve(plan.id, approval);
          yield* expect(approved.status === "approved", "approve did not move the status");
          const again = yield* storage.attempts.approve(plan.id, approval);
          yield* expect(
            again.approval?.id === approval.id,
            "re-approving with the same approval must be idempotent",
          );
          yield* expectReason(
            storage.attempts.approve(plan.id, approvalRow(plan, "other")),
            "Stale",
            "second approval",
          );
          const byApproval = yield* storage.attempts.byApproval(approval.id);
          yield* expect(byApproval.id === plan.id, "byApproval did not find the attempt");
          const claimed = yield* storage.attempts.claim(plan.id, DateTime.add(now, { minutes: 2 }));
          yield* expect(
            claimed.status === "applying" && claimed.leaseExpiresAt !== null,
            "claim did not lease",
          );
          yield* expectReason(
            storage.attempts.claim(plan.id, DateTime.add(now, { minutes: 2 })),
            "Busy",
            "claim while leased",
          );
          yield* storage.attempts.fail(plan.id, "provider down");
          const failed = yield* storage.attempts.get(plan.id);
          yield* expect(
            failed.status === "failed" && failed.failure === "provider down",
            "fail did not record the message",
          );
          const reclaimed = yield* storage.attempts.claim(
            plan.id,
            DateTime.subtract(now, { minutes: 1 }),
          );
          yield* expect(reclaimed.failure === null, "claim did not clear the failure");
          const expiredLease = yield* storage.attempts.claim(
            plan.id,
            DateTime.add(now, { minutes: 2 }),
          );
          yield* expect(expiredLease.status === "applying", "an expired lease must be reclaimable");
          const receipt = receiptRow(plan, approval, "1");
          const completed = yield* storage.attempts.complete(plan.id, receipt);
          yield* expect(
            completed.status === "complete" && completed.leaseExpiresAt === null,
            "complete did not clear the lease",
          );
          yield* expectReason(
            storage.attempts.claim(plan.id, DateTime.add(now, { minutes: 2 })),
            "Stale",
            "claim after completion",
          );
          const byReceipt = yield* storage.attempts.byReceipt(receipt.id);
          yield* expect(byReceipt.receipt?.id === receipt.id, "byReceipt did not find the attempt");
          const later = planRow(attachment.id, DateTime.add(now, { seconds: 1 }), "2");
          yield* storage.attempts.create(attemptRow(owner, later));
          const latest = yield* storage.attempts.latest(attachment.id, "provisioning");
          yield* expect(
            Option.isSome(latest) && latest.value.id === later.id,
            "latest did not return the newest attempt",
          );
          const cleanup = yield* storage.attempts.latest(attachment.id, "cleanup");
          yield* expect(Option.isNone(cleanup), "latest must filter by kind");
          yield* expectReason(
            storage.attempts.get(plan.id).pipe(Effect.provideService(Principal.Service, other)),
            "NotFound",
            "attempts.get across owners",
          );
        }).pipe(Effect.provideService(Principal.Service, owner)),
      ),
    },
    {
      name: "rejects a planned attempt once and terminally",
      run: run(
        Effect.gen(function* () {
          const { storage, attachment } = yield* connect(owner, "auth-reject");
          const now = yield* DateTime.now;
          const plan = planRow(attachment.id, now, "r1");
          yield* storage.attempts.create(attemptRow(owner, plan));
          yield* expectReason(
            storage.attempts.reject(plan.id, {
              digest: Plan.Digest.make("other"),
              actorId: "a",
              reason: null,
            }),
            "Stale",
            "reject with a digest mismatch",
          );
          yield* expectReason(
            storage.attempts
              .reject(plan.id, { digest: plan.digest, actorId: other.actorId, reason: null })
              .pipe(Effect.provideService(Principal.Service, other)),
            "NotFound",
            "reject by another owner",
          );
          const rejected = yield* storage.attempts.reject(plan.id, {
            digest: plan.digest,
            actorId: owner.actorId,
            reason: "wrong zone",
          });
          yield* expect(
            rejected.status === "rejected" &&
              rejected.rejection?.actorId === owner.actorId &&
              rejected.rejection.reason === "wrong zone" &&
              DateTime.toEpochMillis(rejected.rejection.at) >= DateTime.toEpochMillis(now),
            "reject did not record the actor, reason, and time",
          );
          const again = yield* storage.attempts.reject(plan.id, {
            digest: plan.digest,
            actorId: "someone-else",
            reason: "later",
          });
          yield* expect(
            again.rejection?.reason === "wrong zone",
            "rejecting a rejected attempt must return it unchanged",
          );
          yield* expectReason(
            storage.attempts.approve(plan.id, approvalRow(plan, "r1")),
            "Stale",
            "approve after reject",
          );
          yield* expectReason(
            storage.attempts.claim(plan.id, DateTime.add(now, { minutes: 2 })),
            "Stale",
            "claim after reject",
          );
          const approvedPlan = planRow(attachment.id, now, "r2");
          yield* storage.attempts.create(attemptRow(owner, approvedPlan));
          yield* storage.attempts.approve(approvedPlan.id, approvalRow(approvedPlan, "r2"));
          yield* expectReason(
            storage.attempts.reject(approvedPlan.id, {
              digest: approvedPlan.digest,
              actorId: "a",
              reason: null,
            }),
            "Stale",
            "reject after approve",
          );
          const expiredPlan = planRow(attachment.id, now, "r3");
          yield* storage.attempts.create(
            new Storage.Attempt({ ...attemptRow(owner, expiredPlan), status: "expired" }),
          );
          yield* expectReason(
            storage.attempts.reject(expiredPlan.id, {
              digest: expiredPlan.digest,
              actorId: "a",
              reason: null,
            }),
            "Expired",
            "reject an expired plan",
          );
        }).pipe(Effect.provideService(Principal.Service, owner)),
      ),
    },
    {
      name: "keeps a failed revocation pending and finishes it on recovery",
      run: run(
        Effect.gen(function* () {
          const { storage, connection, attachment } = yield* connect(owner, "auth-revoke");
          yield* storage.attachments.remove(attachment.id);
          yield* storage.connections.remove(connection.id);
          const revokeFailure = yield* storage.authorizations
            .revoke("auth-revoke", Effect.fail(new Failure("provider unavailable")))
            .pipe(Effect.flip);
          yield* expect(
            revokeFailure instanceof Failure,
            "revoke must surface the provider failure",
          );
          const pending = yield* storage.authorizations.get("auth-revoke");
          yield* expect(
            pending.revocation === "pending",
            "a failed revoke must leave the row pending",
          );
          const now = yield* DateTime.now;
          yield* expectReason(
            storage.authorizations.upsert({
              authorization: authorizationRow(owner, "auth-revoke", now),
              credential: credentialRow(now),
              expectedId: "auth-revoke",
            }),
            "Busy",
            "reconnect while revocation is pending",
          );
          const recoveredByOther = yield* storage.authorizations
            .recoverRevocations(() => Effect.void)
            .pipe(Effect.provideService(Principal.Service, other));
          yield* expect(recoveredByOther === 0, "recovery must not cross owners");
          let calls = 0;
          const recovered = yield* storage.authorizations.recoverRevocations(() =>
            Effect.sync(() => void (calls += 1)),
          );
          yield* expect(
            recovered === 1 && calls === 1,
            "recovery must revoke exactly the pending authorization",
          );
          yield* expectReason(
            storage.authorizations.get("auth-revoke"),
            "NotFound",
            "authorization after recovery",
          );
          const again = yield* storage.authorizations.recoverRevocations(() => Effect.void);
          yield* expect(again === 0, "recovery must be idempotent");
        }).pipe(Effect.provideService(Principal.Service, owner)),
      ),
    },
    {
      name: "returns an attachment's label from every read",
      run: run(
        Effect.gen(function* () {
          const { storage, connection, attachment } = yield* connect(owner, "auth-label");
          const label = `${attachment.zone} (auth-label)`;
          yield* expect(attachment.label === label, "create must return the label it was given");
          const read = yield* storage.attachments.get(attachment.id);
          yield* expect(read.label === label, "get must return the stored label");
          const byDomain = yield* storage.attachments.byDomain(attachment.domain);
          yield* expect(
            Option.isSome(byDomain) && byDomain.value.label === label,
            "byDomain must return the stored label",
          );
          const listed = yield* storage.attachments.list(connection.id);
          yield* expect(
            listed.every((row) => row.label === label),
            "list must return the stored label",
          );
        }).pipe(Effect.provideService(Principal.Service, owner)),
      ),
    },
    {
      name: "blocks connection removal while attachments exist",
      run: run(
        Effect.gen(function* () {
          const { storage, connection, attachment } = yield* connect(owner, "auth-remove");
          yield* expectReason(
            storage.connections.remove(connection.id),
            "InvalidInput",
            "remove with attachments",
          );
          yield* expectReason(
            storage.attachments.create({
              connectionId: connection.id,
              domain: attachment.domain,
              zone: attachment.zone,
              label: attachment.label,
              target: {},
            }),
            "InvalidInput",
            "duplicate domain attachment",
          );
          yield* storage.attachments.remove(attachment.id);
          yield* storage.connections.remove(connection.id);
          yield* expectReason(
            storage.connections.get(connection.id),
            "NotFound",
            "connection after remove",
          );
        }).pipe(Effect.provideService(Principal.Service, owner)),
      ),
    },
    {
      name: "fails Busy while a lock is held and releases it afterwards",
      run: run(
        Effect.gen(function* () {
          const storage = yield* Storage.Service;
          const gate = yield* Deferred.make<void>();
          const holder = yield* Effect.forkChild(
            storage.withLock("refresh:auth-1", Deferred.await(gate)),
          );
          yield* Effect.yieldNow;
          yield* expectReason(
            storage.withLock("refresh:auth-1", Effect.void),
            "Busy",
            "second holder",
          );
          const otherOwner = yield* storage
            .withLock("refresh:auth-1", Effect.succeed("ok"))
            .pipe(Effect.provideService(Principal.Service, other));
          yield* expect(otherOwner === "ok", "locks must be scoped by owner");
          yield* Deferred.succeed(gate, undefined);
          yield* Fiber.join(holder);
          const after = yield* storage.withLock("refresh:auth-1", Effect.succeed("free"));
          yield* expect(after === "free", "lock was not released");
          yield* storage
            .withLock("refresh:auth-1", Effect.fail(new Failure("inside")))
            .pipe(Effect.ignore);
          const afterFailure = yield* storage.withLock("refresh:auth-1", Effect.succeed("free"));
          yield* expect(afterFailure === "free", "lock was not released after a failure");
        }).pipe(Effect.provideService(Principal.Service, owner)),
      ),
    },
    {
      name: "creates a batch once per idempotency key and keeps it inside its owner",
      run: run(
        Effect.gen(function* () {
          const first = yield* connect(owner, "auth-batch-key");
          const second = yield* connect(owner, "auth-batch-key-2");
          const storage = first.storage;
          const attachmentIds = [first.attachment.id, second.attachment.id];
          const created = yield* storage.batches.create({
            kind: "provisioning",
            idempotencyKey: "batch-key-create",
            attachmentIds,
          });
          yield* expect(created.batch.status === "planning", "a new batch is not planning");
          yield* expect(
            created.items.map((item) => item.position).join(",") === "0,1",
            "batch items did not keep the order they were created in",
          );
          yield* expect(
            created.items.every((item) => item.attemptId === null && item.planFailure === null),
            "a new batch item already points at an attempt",
          );
          // A retried create is the same batch, whatever the second call asks for.
          const replay = yield* storage.batches.create({
            kind: "provisioning",
            idempotencyKey: "batch-key-create",
            attachmentIds: [first.attachment.id],
          });
          yield* expect(
            replay.batch.id === created.batch.id && replay.items.length === 2,
            "a replayed idempotency key did not return the stored batch",
          );
          yield* expectReason(
            storage.batches.create({
              kind: "provisioning",
              idempotencyKey: "batch-key-empty",
              attachmentIds: [],
            }),
            "InvalidInput",
            "batches.create with no attachments",
          );
          yield* expectReason(
            storage.batches.create({
              kind: "provisioning",
              idempotencyKey: "batch-key-duplicate",
              attachmentIds: [first.attachment.id, first.attachment.id],
            }),
            "InvalidInput",
            "batches.create with a repeated attachment",
          );
          const asOther = <A, E>(effect: Effect.Effect<A, E, Principal.Service>) =>
            effect.pipe(Effect.provideService(Principal.Service, other));
          yield* expectReason(
            asOther(storage.batches.get(created.batch.id)),
            "NotFound",
            "batches.get",
          );
          const foreign = yield* asOther(storage.batches.listUnfinished());
          yield* expect(
            !foreign.some(({ batch }) => batch.id === created.batch.id),
            "batches.listUnfinished leaked across owners",
          );
          const unfinished = yield* storage.batches.listUnfinished();
          yield* expect(
            unfinished.some(({ batch }) => batch.id === created.batch.id),
            "a planning batch is missing from the unfinished index",
          );
        }).pipe(Effect.provideService(Principal.Service, owner)),
      ),
    },
    {
      name: "recomputes batch status from its items and approves every attempt at once",
      run: run(
        Effect.gen(function* () {
          const first = yield* connect(owner, "auth-batch-plan");
          const second = yield* connect(owner, "auth-batch-plan-2");
          const storage = first.storage;
          const now = yield* DateTime.now;
          const planA = planRow(first.attachment.id, now, "batch-a");
          const planB = planRow(second.attachment.id, now, "batch-b");
          yield* storage.attempts.create(attemptRow(owner, planA));
          yield* storage.attempts.create(attemptRow(owner, planB));
          const { batch } = yield* storage.batches.create({
            kind: "provisioning",
            idempotencyKey: "batch-key-plan",
            attachmentIds: [first.attachment.id, second.attachment.id],
          });
          const approvalA = approvalRow(planA, "batch-a");
          const approvalB = approvalRow(planB, "batch-b");
          const approvals = [
            { attachmentId: first.attachment.id, approval: approvalA },
            { attachmentId: second.attachment.id, approval: approvalB },
          ];
          const digest = Plan.Digest.make("batch-digest-1");
          yield* expectReason(
            storage.batches.approve(batch.id, {
              digest,
              actorId: owner.actorId,
              approvals,
            }),
            "BatchStale",
            "batches.approve before every item is planned",
          );
          const failed = yield* storage.batches.recordItemPlanFailure(
            batch.id,
            first.attachment.id,
            "the provider was unavailable",
          );
          yield* expect(
            failed.batch.status === "planning" &&
              failed.items[0]?.planFailure === "the provider was unavailable",
            "a plan failure did not leave the batch planning",
          );
          const partiallyPlanned = yield* storage.batches.recordItemPlan(
            batch.id,
            first.attachment.id,
            planA.id,
          );
          yield* expect(
            partiallyPlanned.batch.status === "planning" &&
              partiallyPlanned.items[0]?.planFailure === null,
            "a landed plan did not clear the item's failure",
          );
          const planned = yield* storage.batches.recordItemPlan(
            batch.id,
            second.attachment.id,
            planB.id,
          );
          yield* expect(
            planned.batch.status === "planned",
            "a batch whose items are all planned is not planned",
          );
          const approved = yield* storage.batches.approve(batch.id, {
            digest,
            actorId: owner.actorId,
            approvals,
          });
          yield* expect(
            approved.batch.status === "approved" && approved.batch.digest === digest,
            "batches.approve did not bind the digest",
          );
          const attemptA = yield* storage.attempts.get(planA.id);
          const attemptB = yield* storage.attempts.get(planB.id);
          yield* expect(
            attemptA.approval?.id === approvalA.id && attemptB.approval?.id === approvalB.id,
            "batches.approve did not approve every item's attempt",
          );
          const again = yield* storage.batches.approve(batch.id, {
            digest,
            actorId: owner.actorId,
            approvals,
          });
          yield* expect(
            again.batch.status === "approved",
            "approving an approved batch under the same digest is not idempotent",
          );
          yield* expectReason(
            storage.batches.approve(batch.id, {
              digest: Plan.Digest.make("batch-digest-moved"),
              actorId: owner.actorId,
              approvals,
            }),
            "BatchStale",
            "batches.approve with a digest the batch does not hold",
          );
          yield* expectReason(
            storage.batches.reject(batch.id, { actorId: owner.actorId, reason: null }),
            "BatchStale",
            "batches.reject after approval",
          );
          const lease = DateTime.add(now, { minutes: 2 });
          yield* storage.attempts.claim(planA.id, lease);
          yield* storage.attempts.complete(planA.id, receiptRow(planA, approvalA, "batch-a"));
          const applying = yield* storage.batches.refresh(batch.id);
          yield* expect(
            applying.batch.status === "applying",
            "a batch with one item left is not applying",
          );
          yield* storage.attempts.claim(planB.id, lease);
          yield* storage.attempts.complete(planB.id, receiptRow(planB, approvalB, "batch-b"));
          const complete = yield* storage.batches.refresh(batch.id);
          yield* expect(
            complete.batch.status === "complete" && complete.batch.completedAt !== null,
            "a batch whose items all completed is not complete",
          );
          const unfinished = yield* storage.batches.listUnfinished();
          yield* expect(
            !unfinished.some((entry) => entry.batch.id === batch.id),
            "a complete batch is still in the unfinished index",
          );
        }).pipe(Effect.provideService(Principal.Service, owner)),
      ),
    },
    {
      name: "declines a batch with its planned attempts and fences a late planner",
      run: run(
        Effect.gen(function* () {
          const { storage, attachment } = yield* connect(owner, "auth-batch-reject");
          const now = yield* DateTime.now;
          const plan = planRow(attachment.id, now, "batch-reject");
          const late = planRow(attachment.id, now, "batch-reject-late");
          yield* storage.attempts.create(attemptRow(owner, plan));
          yield* storage.attempts.create(attemptRow(owner, late));
          const { batch } = yield* storage.batches.create({
            kind: "provisioning",
            idempotencyKey: "batch-key-reject",
            attachmentIds: [attachment.id],
          });
          yield* storage.batches.recordItemPlan(batch.id, attachment.id, plan.id);
          const rejected = yield* storage.batches.reject(batch.id, {
            actorId: owner.actorId,
            reason: "the customer changed their mind",
          });
          yield* expect(
            rejected.batch.status === "rejected" && rejected.batch.completedAt !== null,
            "batches.reject is not terminal",
          );
          const attempt = yield* storage.attempts.get(plan.id);
          yield* expect(
            attempt.status === "rejected",
            "batches.reject left a planned attempt open",
          );
          const twice = yield* storage.batches.reject(batch.id, {
            actorId: owner.actorId,
            reason: null,
          });
          yield* expect(
            twice.batch.rejection?.reason === "the customer changed their mind",
            "a second rejection overwrote the first",
          );
          // The fence: a planning pass still in flight must not land state on a declined batch.
          yield* expectReason(
            storage.batches.recordItemPlan(batch.id, attachment.id, late.id),
            "BatchStale",
            "batches.recordItemPlan on a rejected batch",
          );
          yield* expectReason(
            storage.batches.recordItemPlanFailure(batch.id, attachment.id, "too late"),
            "BatchStale",
            "batches.recordItemPlanFailure on a rejected batch",
          );
          const unfinished = yield* storage.batches.listUnfinished();
          yield* expect(
            !unfinished.some((entry) => entry.batch.id === batch.id),
            "a rejected batch is still in the unfinished index",
          );
        }).pipe(Effect.provideService(Principal.Service, owner)),
      ),
    },
    {
      name: "stores readiness per domain, with or without an attachment",
      run: run(
        Effect.gen(function* () {
          const { storage, attachment } = yield* connect(owner, "auth-ready");
          const now = yield* DateTime.now;
          const readiness = new Storage.Readiness({
            domain: attachment.domain,
            attachmentId: attachment.id,
            ownerId: owner.ownerId,
            overall: "pending",
            requirements: [
              {
                operationId: null,
                record: DnsRecord.txt({ name: "app.example.com", value: "v" }),
                status: "missing",
                evidence: [],
              },
            ],
            host: [],
            pendingSince: now,
            checkedAt: now,
            nextCheckAt: DateTime.add(now, { seconds: 15 }),
          });
          yield* storage.readiness.put(readiness);
          const stored = yield* storage.readiness.get(attachment.domain);
          yield* expect(
            Option.isSome(stored) && stored.value.overall === "pending",
            "readiness was not stored",
          );
          const foreign = yield* storage.readiness
            .get(attachment.domain)
            .pipe(Effect.provideService(Principal.Service, other));
          yield* expect(Option.isNone(foreign), "readiness leaked across owners");
          yield* storage.readiness.put(
            new Storage.Readiness({
              ...readiness,
              domain: "observe-only.example.com",
              attachmentId: null,
            }),
          );
          const observeOnly = yield* storage.readiness.get("observe-only.example.com");
          yield* expect(
            Option.isSome(observeOnly) && observeOnly.value.attachmentId === null,
            "readiness without an attachment was not stored",
          );
          yield* expectReason(
            storage.readiness.put(
              new Storage.Readiness({ ...readiness, attachmentId: "att-missing" }),
            ),
            "NotFound",
            "readiness with an unknown attachment",
          );
        }).pipe(Effect.provideService(Principal.Service, owner)),
      ),
    },
  ];
};

/** Registers every case with `options.it` when given; always returns the cases. */
export const storage = (
  layer: Layer.Layer<Storage.Service, unknown>,
  options: Options = {},
): ReadonlyArray<Case> => {
  const all = cases(layer);
  if (options.it !== undefined) {
    for (const item of all) options.it(item.name, () => Effect.runPromise(item.run));
  }
  return all;
};
