import { DateTime, Deferred, Effect, Fiber, Layer, Option } from "effect";

import * as Approval from "../../Approval.ts";
import * as DnsRecord from "../../DnsRecord.ts";
import * as DomainKitError from "../../DomainKitError.ts";
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
  tag: DomainKitError.Reason["_tag"],
  label: string,
): Effect.Effect<void, Failure, R> =>
  effect.pipe(
    Effect.flip,
    Effect.mapError(() => new Failure(`${label}: expected failure ${tag}, effect succeeded`)),
    Effect.flatMap((cause) =>
      expect(
        DomainKitError.isDomainKitError(cause) && cause.reason._tag === tag,
        `${label}: expected reason ${tag}, received ${DomainKitError.isDomainKitError(cause) ? cause.reason._tag : String(cause)}`,
      ),
    ),
  );

const authorizationRow = (principal: Principal.Shape, id: string, now: DateTime.Utc) =>
  new Storage.Authorization({
    id,
    ownerId: principal.ownerId,
    provider: "fake",
    method: "token",
    capabilities: ["dns:read"],
    context: { account: "acc" },
    revocation: "active",
    createdBy: principal.actorId,
    createdAt: now,
  });

const credentialRow = (now: DateTime.Utc, ciphertext = "sealed-1") =>
  new Storage.Credential({ ciphertext, expiresAt: null, rotatedAt: now });

const connect = (principal: Principal.Shape, id: string) =>
  Effect.gen(function* () {
    const storage = yield* Storage.Storage;
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
      target: { zoneId: `zone-${id}` },
    });
    return { storage, connection, attachment };
  }).pipe(Effect.provideService(Principal.Principal, principal));

const planRow = (attachmentId: string, now: DateTime.Utc, suffix: string) =>
  new Plan.Plan({
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

const attemptRow = (principal: Principal.Shape, plan: Plan.Plan) =>
  new Storage.Attempt({
    id: plan.id,
    ownerId: principal.ownerId,
    attachmentId: plan.attachmentId,
    kind: plan.kind,
    status: "planned",
    plan,
    approval: null,
    receipt: null,
    sourceReceiptId: null,
    leaseExpiresAt: null,
    failure: null,
    updatedAt: plan.createdAt,
  });

const approvalRow = (plan: Plan.Plan, suffix: string) =>
  new Approval.Approval({
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

const receiptRow = (plan: Plan.Plan, approval: Approval.Approval, suffix: string) =>
  new Receipt.Receipt({
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
export const cases = (layer: Layer.Layer<Storage.Storage, unknown>): ReadonlyArray<Case> => {
  const run = <E>(effect: Effect.Effect<void, E, Storage.Storage>): Effect.Effect<void, unknown> =>
    effect.pipe(Effect.provide(layer));
  return [
    {
      name: "scopes every row by the principal's owner",
      run: run(
        Effect.gen(function* () {
          const { storage, connection, attachment } = yield* connect(owner, "auth-a");
          const asOther = <A, E>(effect: Effect.Effect<A, E, Principal.Principal>) =>
            effect.pipe(Effect.provideService(Principal.Principal, other));
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
        }).pipe(Effect.provideService(Principal.Principal, owner)),
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
        }).pipe(Effect.provideService(Principal.Principal, owner)),
      ),
    },
    {
      name: "consumes continuations exactly once and rejects expired ones",
      run: run(
        Effect.gen(function* () {
          const storage = yield* Storage.Storage;
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
              .pipe(Effect.provideService(Principal.Principal, other)),
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
        }).pipe(Effect.provideService(Principal.Principal, owner)),
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
            storage.attempts.get(plan.id).pipe(Effect.provideService(Principal.Principal, other)),
            "NotFound",
            "attempts.get across owners",
          );
        }).pipe(Effect.provideService(Principal.Principal, owner)),
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
            .pipe(Effect.provideService(Principal.Principal, other));
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
        }).pipe(Effect.provideService(Principal.Principal, owner)),
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
        }).pipe(Effect.provideService(Principal.Principal, owner)),
      ),
    },
    {
      name: "fails Busy while a lock is held and releases it afterwards",
      run: run(
        Effect.gen(function* () {
          const storage = yield* Storage.Storage;
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
            .pipe(Effect.provideService(Principal.Principal, other));
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
        }).pipe(Effect.provideService(Principal.Principal, owner)),
      ),
    },
    {
      name: "stores readiness per attachment",
      run: run(
        Effect.gen(function* () {
          const { storage, attachment } = yield* connect(owner, "auth-ready");
          const now = yield* DateTime.now;
          const readiness = new Storage.Readiness({
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
          const stored = yield* storage.readiness.get(attachment.id);
          yield* expect(
            Option.isSome(stored) && stored.value.overall === "pending",
            "readiness was not stored",
          );
          const foreign = yield* storage.readiness
            .get(attachment.id)
            .pipe(Effect.provideService(Principal.Principal, other));
          yield* expect(Option.isNone(foreign), "readiness leaked across owners");
        }).pipe(Effect.provideService(Principal.Principal, owner)),
      ),
    },
  ];
};

/** Registers every case with `options.it` when given; always returns the cases. */
export const storage = (
  layer: Layer.Layer<Storage.Storage, unknown>,
  options: Options = {},
): ReadonlyArray<Case> => {
  const all = cases(layer);
  if (options.it !== undefined) {
    for (const item of all) options.it(item.name, () => Effect.runPromise(item.run));
  }
  return all;
};
